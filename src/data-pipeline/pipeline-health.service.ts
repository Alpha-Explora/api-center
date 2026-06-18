import { Inject, Injectable, Optional } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { ValidationError } from "../shared/errors";
import { AthenaQueryRunner } from "./athena-query-runner";
import {
  AthenaQueryTelemetryInput,
  AthenaQueryTelemetryService,
} from "./athena-query-telemetry.service";
import {
  PipelineHealthEnvironment,
  PipelinePartitionDate,
  PipelineHealthResponseSource,
  PipelineHealthRow,
} from "./pipeline-health.dto";
import { resolvePartitionDate as resolveAthenaPartitionDate } from "./athena-partition-config";
import {
  resolvePipelineDatasetSource,
  resolvePositiveQueryLimit,
} from "./pipeline-dataset-provider";

type PipelineHealthSource = "fixture" | "athena";

type PipelineAthenaRunner = Pick<AthenaQueryRunner, "run">;
type PipelineAthenaTelemetry = Pick<
  AthenaQueryTelemetryService,
  "emitQueryCompleted"
>;

export interface PipelineHealthServiceOptions {
  source?: PipelineHealthSource;
  fixtureFilePath?: string;
  athenaDatabase?: string;
  athenaWorkgroup?: string;
  year?: string;
  month?: string;
  day?: string;
  queryLimit?: number;
  pollSeconds?: number;
  timeoutSeconds?: number;
  athenaRunner?: PipelineAthenaRunner;
  athenaTelemetry?: PipelineAthenaTelemetry;
}

type RawPipelineHealthRow = Record<string, unknown>;

export const PIPELINE_HEALTH_SERVICE_OPTIONS =
  "PIPELINE_HEALTH_SERVICE_OPTIONS";

@Injectable()
export class PipelineHealthService {
  constructor(
    @Optional()
    @Inject(PIPELINE_HEALTH_SERVICE_OPTIONS)
    private readonly options: PipelineHealthServiceOptions = {},
  ) {}

  async listHealth(
    environment: PipelineHealthEnvironment,
    partitionDate?: PipelinePartitionDate,
  ): Promise<PipelineHealthRow[]> {
    const source = this.resolveSource();
    const rows =
      source === "athena"
        ? await this.readAthenaRows(environment, partitionDate)
        : await this.readFixtureRows();

    return rows.filter((row) => row.environment === environment);
  }

  getResponseSource(): PipelineHealthResponseSource {
    return this.resolveSource() === "athena" ? "athena-proxy" : "evidence-file";
  }

  private async readFixtureRows(): Promise<PipelineHealthRow[]> {
    const filePath =
      this.options.fixtureFilePath ?? process.env.PIPELINE_HEALTH_FIXTURE_FILE;
    if (!filePath) return [];

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { rows?: unknown[] } | unknown[];
      const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
      return rows.map((row) => this.normalizeRow(this.readRawRow(row)));
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  private async readAthenaRows(
    environment: PipelineHealthEnvironment,
    partitionDate: PipelinePartitionDate | undefined,
  ): Promise<PipelineHealthRow[]> {
    const database = this.resolveAthenaDatabase();
    const workgroup = this.resolveAthenaWorkgroup(environment);
    const result = await this.resolveAthenaRunner().run({
      query: this.buildAthenaQuery(environment, partitionDate),
      database,
      workgroup,
    });
    this.emitAthenaTelemetry({
      environment,
      database,
      workgroup,
      resultPurpose: "pipeline-health",
      queryExecutionId: result.queryExecutionId,
      bytesScanned: result.bytesScanned,
      outputLocation: result.outputLocation,
      completedAt: result.completedAt,
    });

    return result.rows.map((raw) => {
      if (result.outputLocation && raw.athena_result_location === undefined) {
        raw.athena_result_location = result.outputLocation;
      }
      if (
        result.bytesScanned !== undefined &&
        raw.bytes_scanned === undefined
      ) {
        raw.bytes_scanned = String(result.bytesScanned);
      }
      if (raw.last_refreshed_at === undefined) {
        raw.last_refreshed_at = new Date().toISOString();
      }
      return this.normalizeRow(raw);
    });
  }

  private resolveAthenaRunner(): PipelineAthenaRunner {
    return (
      this.options.athenaRunner ??
      new AthenaQueryRunner({
        pollSeconds: this.options.pollSeconds,
        timeoutSeconds: this.options.timeoutSeconds,
      })
    );
  }

  private emitAthenaTelemetry(input: AthenaQueryTelemetryInput): void {
    try {
      void this.options.athenaTelemetry
        ?.emitQueryCompleted(input)
        .catch(() => undefined);
    } catch {
      // Telemetry must never break the dashboard read path.
    }
  }

  private buildAthenaQuery(
    environment: PipelineHealthEnvironment,
    partitionDate: PipelinePartitionDate | undefined,
  ): string {
    const partition = this.resolvePartitionDate(partitionDate);

    return `
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  CAST(event_day AS varchar) AS event_day,
  event_count,
  CAST(latest_occurred_at AS varchar) AS latest_occurred_at,
  CAST(latest_ingested_at AS varchar) AS latest_ingested_at
FROM gold_platform.pipeline_health_daily
WHERE environment = '${environment}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
ORDER BY event_day DESC, tribe_id ASC, source_service_id ASC, event_type ASC
LIMIT ${this.resolveQueryLimit()}
`.trim();
  }

  private resolveSource(): PipelineHealthSource {
    return resolvePipelineDatasetSource(
      [this.options.source, process.env.PIPELINE_HEALTH_SOURCE],
      "PIPELINE_HEALTH_SOURCE must be fixture or athena.",
    );
  }

  private resolveAthenaDatabase(): string {
    return (
      this.options.athenaDatabase ??
      process.env.PIPELINE_HEALTH_ATHENA_DATABASE ??
      "gold_platform"
    );
  }

  private resolveAthenaWorkgroup(
    environment: PipelineHealthEnvironment,
  ): string {
    return (
      this.options.athenaWorkgroup ??
      process.env.PIPELINE_HEALTH_ATHENA_WORKGROUP ??
      `api-center-platform-validation-${environment}`
    );
  }

  private resolveQueryLimit(): number {
    return resolvePositiveQueryLimit(
      this.options.queryLimit ??
        Number.parseInt(process.env.PIPELINE_HEALTH_QUERY_LIMIT ?? "100", 10),
      100,
    );
  }

  private resolvePartitionDate(
    partitionDate: PipelinePartitionDate | undefined,
  ): PipelinePartitionDate {
    return resolveAthenaPartitionDate({
      partitionDate,
      options: this.options,
      prefixes: ["PIPELINE_HEALTH"],
    });
  }

  private normalizeRow(row: RawPipelineHealthRow): PipelineHealthRow {
    return {
      environment: this.readEnvironment(row.environment),
      tribeId: this.readRequiredString(row.tribeId ?? row.tribe_id, "tribe_id"),
      sourceServiceId: this.readOptionalString(
        row.sourceServiceId ?? row.source_service_id,
      ),
      eventType: this.readRequiredString(
        row.eventType ?? row.event_type,
        "event_type",
      ),
      eventDay: this.readRequiredString(
        row.eventDay ?? row.event_day,
        "event_day",
      ),
      eventCount: this.readNumber(
        row.eventCount ?? row.event_count,
        "event_count",
      ),
      latestOccurredAt: this.readOptionalString(
        row.latestOccurredAt ?? row.latest_occurred_at,
      ),
      latestIngestedAt: this.readOptionalString(
        row.latestIngestedAt ?? row.latest_ingested_at,
      ),
      connectorName: this.readOptionalString(
        row.connectorName ?? row.connector_name,
      ),
      connectorState: this.readOptionalString(
        row.connectorState ?? row.connector_state,
      ),
      s3Prefix: this.readOptionalString(row.s3Prefix ?? row.s3_prefix),
      latestS3ObjectKey: this.readOptionalString(
        row.latestS3ObjectKey ?? row.latest_s3_object_key,
      ),
      latestS3ObjectAt: this.readOptionalString(
        row.latestS3ObjectAt ?? row.latest_s3_object_at,
      ),
      latestBronzeObservedAt: this.readOptionalString(
        row.latestBronzeObservedAt ?? row.latest_bronze_observed_at,
      ),
      latestCommonSilverObservedAt: this.readOptionalString(
        row.latestCommonSilverObservedAt ??
          row.latest_common_silver_observed_at,
      ),
      latestGoldObservedAt: this.readOptionalString(
        row.latestGoldObservedAt ?? row.latest_gold_observed_at,
      ),
      qualityErrorCount: this.readOptionalNumber(
        row.qualityErrorCount ?? row.quality_error_count,
      ),
      athenaResultLocation: this.readOptionalString(
        row.athenaResultLocation ?? row.athena_result_location,
      ),
      bytesScanned: this.readOptionalNumber(
        row.bytesScanned ?? row.bytes_scanned,
      ),
      lastRefreshedAt: this.readOptionalString(
        row.lastRefreshedAt ?? row.last_refreshed_at,
      ),
    };
  }

  private readEnvironment(value: unknown): PipelineHealthEnvironment {
    if (value === "test" || value === "prod") return value;
    throw new ValidationError("environment must be one of: test, prod");
  }

  private readRequiredString(value: unknown, fieldName: string): string {
    if (typeof value === "string" && value.trim()) return value;
    throw new Error(`${fieldName} is required`);
  }

  private readOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
  }

  private readNumber(value: unknown, fieldName: string): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    throw new Error(`${fieldName} must be a number`);
  }

  private readOptionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private readRawRow(value: unknown): RawPipelineHealthRow {
    if (value && typeof value === "object") {
      return value as RawPipelineHealthRow;
    }
    throw new Error("Pipeline health row must be an object.");
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
