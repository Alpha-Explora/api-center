import { Inject, Injectable, Optional } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { ValidationError } from "../shared/errors";
import { AthenaQueryRunner } from "./athena-query-runner";
import {
  AthenaQueryTelemetryInput,
  AthenaQueryTelemetryService,
} from "./athena-query-telemetry.service";
import {
  PipelineAthenaCostRow,
  PipelineGatewayDecisionRow,
  PipelineHealthEnvironment,
  PipelinePartitionDate,
  PipelineHealthResponseSource,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
} from "./pipeline-health.dto";

type PipelineGovernanceSource = "fixture" | "athena";
type RawMetricRow = Record<string, unknown>;
type MetricKind =
  | "qualityRows"
  | "sharedServiceUsageRows"
  | "gatewayDecisionRows"
  | "costRows";

type PipelineAthenaRunner = Pick<AthenaQueryRunner, "run">;
type PipelineAthenaTelemetry = Pick<
  AthenaQueryTelemetryService,
  "emitQueryCompleted"
>;

export interface PipelineGovernanceServiceOptions {
  source?: PipelineGovernanceSource;
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

export const PIPELINE_GOVERNANCE_SERVICE_OPTIONS =
  "PIPELINE_GOVERNANCE_SERVICE_OPTIONS";

@Injectable()
export class PipelineGovernanceService {
  constructor(
    @Optional()
    @Inject(PIPELINE_GOVERNANCE_SERVICE_OPTIONS)
    private readonly options: PipelineGovernanceServiceOptions = {},
  ) {}

  async listQuality(
    environment: PipelineHealthEnvironment,
    partitionDate?: PipelinePartitionDate,
  ): Promise<PipelineQualityRow[]> {
    const rows = await this.listRows(
      environment,
      "qualityRows",
      this.buildQualityQuery(environment, partitionDate),
    );
    return rows.map((row) => this.normalizeQualityRow(row));
  }

  async listSharedServiceUsage(
    environment: PipelineHealthEnvironment,
    partitionDate?: PipelinePartitionDate,
  ): Promise<PipelineSharedServiceUsageRow[]> {
    const rows = await this.listRows(
      environment,
      "sharedServiceUsageRows",
      this.buildSharedServiceUsageQuery(environment, partitionDate),
    );
    return rows.map((row) => this.normalizeSharedServiceUsageRow(row));
  }

  async listGatewayDecisions(
    environment: PipelineHealthEnvironment,
    partitionDate?: PipelinePartitionDate,
  ): Promise<PipelineGatewayDecisionRow[]> {
    const rows = await this.listRows(
      environment,
      "gatewayDecisionRows",
      this.buildGatewayDecisionQuery(environment, partitionDate),
    );
    return rows.map((row) => this.normalizeGatewayDecisionRow(row));
  }

  async listCost(
    environment: PipelineHealthEnvironment,
    partitionDate?: PipelinePartitionDate,
  ): Promise<PipelineAthenaCostRow[]> {
    const rows = await this.listRows(
      environment,
      "costRows",
      this.buildCostQuery(environment, partitionDate),
    );
    return rows.map((row) => this.normalizeCostRow(row));
  }

  getResponseSource(): PipelineHealthResponseSource {
    return this.resolveSource() === "athena" ? "athena-proxy" : "evidence-file";
  }

  private async listRows(
    environment: PipelineHealthEnvironment,
    kind: MetricKind,
    query: string,
  ): Promise<RawMetricRow[]> {
    const rows =
      this.resolveSource() === "athena"
        ? await this.readAthenaRows(environment, kind, query)
        : await this.readFixtureRows(kind);
    return rows.filter((row) => row.environment === environment);
  }

  private async readFixtureRows(kind: MetricKind): Promise<RawMetricRow[]> {
    const filePath =
      this.options.fixtureFilePath ??
      process.env.PIPELINE_GOVERNANCE_FIXTURE_FILE;
    if (!filePath) return [];

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rows = parsed[kind];
      return Array.isArray(rows)
        ? rows.map((row) => this.readRawRow(row))
        : [];
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  private async readAthenaRows(
    environment: PipelineHealthEnvironment,
    kind: MetricKind,
    query: string,
  ): Promise<RawMetricRow[]> {
    const database = this.resolveAthenaDatabase();
    const workgroup = this.resolveAthenaWorkgroup(environment);
    const result = await this.resolveAthenaRunner().run({
      query,
      database,
      workgroup,
    });
    this.emitAthenaTelemetry({
      environment,
      database,
      workgroup,
      resultPurpose: this.resolveResultPurpose(kind),
      queryExecutionId: result.queryExecutionId,
      bytesScanned: result.bytesScanned,
      outputLocation: result.outputLocation,
      completedAt: result.completedAt,
    });
    return result.rows;
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

  private resolveResultPurpose(kind: MetricKind): string {
    switch (kind) {
      case "qualityRows":
        return "pipeline-quality";
      case "sharedServiceUsageRows":
        return "pipeline-shared-service-usage";
      case "gatewayDecisionRows":
        return "pipeline-gateway-decisions";
      case "costRows":
        return "pipeline-cost";
    }
  }

  private buildQualityQuery(
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
  valid_event_count,
  invalid_event_count,
  quality_error_count,
  latest_quality_error,
  CAST(latest_observed_at AS varchar) AS latest_observed_at
FROM gold_platform.event_quality_daily
WHERE environment = '${environment}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
ORDER BY quality_error_count DESC, tribe_id ASC, source_service_id ASC, event_type ASC
LIMIT ${this.resolveQueryLimit()}
`.trim();
  }

  private buildSharedServiceUsageQuery(
    environment: PipelineHealthEnvironment,
    partitionDate: PipelinePartitionDate | undefined,
  ): string {
    const partition = this.resolvePartitionDate(partitionDate);
    return `
SELECT
  environment,
  tribe_id,
  shared_service_id,
  provider,
  provider_status,
  CAST(event_day AS varchar) AS event_day,
  event_count,
  success_count,
  failure_count,
  CAST(latest_occurred_at AS varchar) AS latest_occurred_at,
  CAST(latest_ingested_at AS varchar) AS latest_ingested_at
FROM gold_platform.shared_service_usage_daily
WHERE environment = '${environment}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
ORDER BY event_count DESC, tribe_id ASC, shared_service_id ASC
LIMIT ${this.resolveQueryLimit()}
`.trim();
  }

  private buildGatewayDecisionQuery(
    environment: PipelineHealthEnvironment,
    partitionDate: PipelinePartitionDate | undefined,
  ): string {
    const partition = this.resolvePartitionDate(partitionDate);
    return `
SELECT
  environment,
  tribe_id,
  source_service_id,
  target_service_id,
  scope,
  decision,
  CAST(event_day AS varchar) AS event_day,
  decision_count,
  allowed_count,
  denied_count,
  avg_latency_ms,
  CAST(latest_occurred_at AS varchar) AS latest_occurred_at,
  CAST(latest_ingested_at AS varchar) AS latest_ingested_at
FROM gold_platform.gateway_decision_daily
WHERE environment = '${environment}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
ORDER BY denied_count DESC, decision_count DESC, tribe_id ASC, source_service_id ASC
LIMIT ${this.resolveQueryLimit()}
`.trim();
  }

  private buildCostQuery(
    environment: PipelineHealthEnvironment,
    partitionDate: PipelinePartitionDate | undefined,
  ): string {
    const partition = this.resolvePartitionDate(partitionDate);
    return `
SELECT
  environment,
  workgroup,
  result_purpose,
  CAST(event_day AS varchar) AS event_day,
  query_count,
  bytes_scanned,
  estimated_cost_usd,
  max_bytes_scanned,
  latest_query_execution_id,
  CAST(latest_completed_at AS varchar) AS latest_completed_at
FROM gold_platform.athena_query_cost_daily
WHERE environment = '${environment}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
ORDER BY bytes_scanned DESC, workgroup ASC, result_purpose ASC
LIMIT ${this.resolveQueryLimit()}
`.trim();
  }

  private resolveSource(): PipelineGovernanceSource {
    const source =
      this.options.source ?? process.env.PIPELINE_GOVERNANCE_SOURCE ?? "fixture";
    if (source === "fixture" || source === "athena") return source;
    throw new ValidationError(
      "PIPELINE_GOVERNANCE_SOURCE must be fixture or athena.",
    );
  }

  private resolveAthenaDatabase(): string {
    return (
      this.options.athenaDatabase ??
      process.env.PIPELINE_GOVERNANCE_ATHENA_DATABASE ??
      "gold_platform"
    );
  }

  private resolveAthenaWorkgroup(environment: PipelineHealthEnvironment): string {
    return (
      this.options.athenaWorkgroup ??
      process.env.PIPELINE_GOVERNANCE_ATHENA_WORKGROUP ??
      `api-center-platform-validation-${environment}`
    );
  }

  private resolveQueryLimit(): number {
    const value =
      this.options.queryLimit ??
      Number.parseInt(process.env.PIPELINE_GOVERNANCE_QUERY_LIMIT ?? "100", 10);
    return Number.isFinite(value) && value > 0 ? value : 100;
  }

  private resolvePartitionDate(
    partitionDate: PipelinePartitionDate | undefined,
  ): PipelinePartitionDate {
    if (partitionDate) return partitionDate;
    const now = new Date();
    return {
      year:
        this.options.year ??
        process.env.PIPELINE_GOVERNANCE_YEAR ??
        String(now.getUTCFullYear()),
      month:
        this.options.month ??
        process.env.PIPELINE_GOVERNANCE_MONTH ??
        String(now.getUTCMonth() + 1).padStart(2, "0"),
      day:
        this.options.day ??
        process.env.PIPELINE_GOVERNANCE_DAY ??
        String(now.getUTCDate()).padStart(2, "0"),
    };
  }

  private normalizeQualityRow(row: RawMetricRow): PipelineQualityRow {
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
      eventDay: this.readRequiredString(row.eventDay ?? row.event_day, "event_day"),
      eventCount: this.readNumber(row.eventCount ?? row.event_count, "event_count"),
      validEventCount: this.readNumber(
        row.validEventCount ?? row.valid_event_count,
        "valid_event_count",
      ),
      invalidEventCount: this.readNumber(
        row.invalidEventCount ?? row.invalid_event_count,
        "invalid_event_count",
      ),
      qualityErrorCount: this.readNumber(
        row.qualityErrorCount ?? row.quality_error_count,
        "quality_error_count",
      ),
      latestQualityError: this.readOptionalString(
        row.latestQualityError ?? row.latest_quality_error,
      ),
      latestObservedAt: this.readOptionalString(
        row.latestObservedAt ?? row.latest_observed_at,
      ),
    };
  }

  private normalizeSharedServiceUsageRow(
    row: RawMetricRow,
  ): PipelineSharedServiceUsageRow {
    return {
      environment: this.readEnvironment(row.environment),
      tribeId: this.readRequiredString(row.tribeId ?? row.tribe_id, "tribe_id"),
      sharedServiceId: this.readRequiredString(
        row.sharedServiceId ?? row.shared_service_id,
        "shared_service_id",
      ),
      provider: this.readRequiredString(row.provider, "provider"),
      providerStatus: this.readRequiredString(
        row.providerStatus ?? row.provider_status,
        "provider_status",
      ),
      eventDay: this.readRequiredString(row.eventDay ?? row.event_day, "event_day"),
      eventCount: this.readNumber(row.eventCount ?? row.event_count, "event_count"),
      successCount: this.readNumber(
        row.successCount ?? row.success_count,
        "success_count",
      ),
      failureCount: this.readNumber(
        row.failureCount ?? row.failure_count,
        "failure_count",
      ),
      latestOccurredAt: this.readOptionalString(
        row.latestOccurredAt ?? row.latest_occurred_at,
      ),
      latestIngestedAt: this.readOptionalString(
        row.latestIngestedAt ?? row.latest_ingested_at,
      ),
    };
  }

  private normalizeGatewayDecisionRow(
    row: RawMetricRow,
  ): PipelineGatewayDecisionRow {
    const decision = this.readRequiredString(row.decision, "decision");
    if (decision !== "allowed" && decision !== "denied" && decision !== "unknown") {
      throw new Error("decision must be allowed, denied, or unknown");
    }

    return {
      environment: this.readEnvironment(row.environment),
      tribeId: this.readRequiredString(row.tribeId ?? row.tribe_id, "tribe_id"),
      sourceServiceId: this.readOptionalString(
        row.sourceServiceId ?? row.source_service_id,
      ),
      targetServiceId: this.readOptionalString(
        row.targetServiceId ?? row.target_service_id,
      ),
      scope: this.readOptionalString(row.scope),
      decision,
      eventDay: this.readRequiredString(row.eventDay ?? row.event_day, "event_day"),
      decisionCount: this.readNumber(
        row.decisionCount ?? row.decision_count,
        "decision_count",
      ),
      allowedCount: this.readNumber(
        row.allowedCount ?? row.allowed_count,
        "allowed_count",
      ),
      deniedCount: this.readNumber(
        row.deniedCount ?? row.denied_count,
        "denied_count",
      ),
      avgLatencyMs: this.readOptionalNumber(
        row.avgLatencyMs ?? row.avg_latency_ms,
      ),
      latestOccurredAt: this.readOptionalString(
        row.latestOccurredAt ?? row.latest_occurred_at,
      ),
      latestIngestedAt: this.readOptionalString(
        row.latestIngestedAt ?? row.latest_ingested_at,
      ),
    };
  }

  private normalizeCostRow(row: RawMetricRow): PipelineAthenaCostRow {
    return {
      environment: this.readEnvironment(row.environment),
      workgroup: this.readRequiredString(row.workgroup, "workgroup"),
      resultPurpose: this.readRequiredString(
        row.resultPurpose ?? row.result_purpose,
        "result_purpose",
      ),
      eventDay: this.readRequiredString(row.eventDay ?? row.event_day, "event_day"),
      queryCount: this.readNumber(row.queryCount ?? row.query_count, "query_count"),
      bytesScanned: this.readNumber(
        row.bytesScanned ?? row.bytes_scanned,
        "bytes_scanned",
      ),
      estimatedCostUsd: this.readNumber(
        row.estimatedCostUsd ?? row.estimated_cost_usd,
        "estimated_cost_usd",
      ),
      maxBytesScanned: this.readOptionalNumber(
        row.maxBytesScanned ?? row.max_bytes_scanned,
      ),
      latestQueryExecutionId: this.readOptionalString(
        row.latestQueryExecutionId ?? row.latest_query_execution_id,
      ),
      latestCompletedAt: this.readOptionalString(
        row.latestCompletedAt ?? row.latest_completed_at,
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

  private readRawRow(value: unknown): RawMetricRow {
    if (value && typeof value === "object") {
      return value as RawMetricRow;
    }
    throw new Error("Pipeline governance row must be an object.");
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
