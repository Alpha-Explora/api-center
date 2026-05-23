import { Inject, Injectable, Optional } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { ValidationError } from "../shared/errors";
import { AthenaQueryRunner } from "./athena-query-runner";
import {
  AthenaQueryTelemetryInput,
  AthenaQueryTelemetryService,
} from "./athena-query-telemetry.service";
import {
  PipelineDecisionSignalRow,
  PipelineDecisionSignalSeverity,
  PipelineDecisionSignalStatus,
  PipelineDecisionSignalType,
  PipelineHealthEnvironment,
  PipelineHealthResponseSource,
  PipelinePartitionDate,
} from "./pipeline-health.dto";

type DecisionSignalsSource = "fixture" | "athena";
type RawDecisionSignalRow = Record<string, unknown>;
type PipelineAthenaRunner = Pick<AthenaQueryRunner, "run">;
type PipelineAthenaTelemetry = Pick<
  AthenaQueryTelemetryService,
  "emitQueryCompleted"
>;

export interface DecisionSignalsServiceOptions {
  source?: DecisionSignalsSource;
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

export const DECISION_SIGNALS_SERVICE_OPTIONS =
  "DECISION_SIGNALS_SERVICE_OPTIONS";

@Injectable()
export class DecisionSignalsService {
  constructor(
    @Optional()
    @Inject(DECISION_SIGNALS_SERVICE_OPTIONS)
    private readonly options: DecisionSignalsServiceOptions = {},
  ) {}

  async listSignals(
    environment: PipelineHealthEnvironment,
    partitionDate?: PipelinePartitionDate,
    windowDays?: number,
  ): Promise<PipelineDecisionSignalRow[]> {
    const rows =
      this.resolveSource() === "athena"
        ? await this.readAthenaRows(environment, partitionDate, windowDays)
        : await this.readFixtureRows();

    return rows
      .map((row) => this.normalizeRow(row))
      .filter((row) => row.environment === environment);
  }

  getResponseSource(): PipelineHealthResponseSource {
    return this.resolveSource() === "athena" ? "athena-proxy" : "evidence-file";
  }

  private async readFixtureRows(): Promise<RawDecisionSignalRow[]> {
    const filePath =
      this.options.fixtureFilePath ??
      process.env.PIPELINE_DECISION_SIGNALS_FIXTURE_FILE;
    if (!filePath) return [];

    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rows = parsed.decisionSignalRows;
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
    partitionDate: PipelinePartitionDate | undefined,
    windowDays: number | undefined,
  ): Promise<RawDecisionSignalRow[]> {
    const database = this.resolveAthenaDatabase();
    const workgroup = this.resolveAthenaWorkgroup(environment);
    const result = await this.resolveAthenaRunner().run({
      query: this.buildAthenaQuery(environment, partitionDate, windowDays),
      database,
      workgroup,
    });

    this.emitAthenaTelemetry({
      environment,
      database,
      workgroup,
      resultPurpose: "pipeline-decision-signals",
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

  private buildAthenaQuery(
    environment: PipelineHealthEnvironment,
    partitionDate: PipelinePartitionDate | undefined,
    windowDays: number | undefined,
  ): string {
    const partition = this.resolvePartitionDate(partitionDate);
    return `
SELECT
  signal_id,
  environment,
  tribe_id,
  source_service_id,
  signal_type,
  severity,
  metric_name,
  observed_value,
  expected_value,
  recommendation,
  evidence_query_id,
  CAST(evidence_window_start AS varchar) AS evidence_window_start,
  CAST(evidence_window_end AS varchar) AS evidence_window_end,
  CAST(created_at AS varchar) AS created_at,
  status
FROM gold_platform.decision_signals_daily
WHERE environment = '${environment}'
  AND year = '${partition.year}'
  AND month = '${partition.month}'
  AND day = '${partition.day}'
  ${this.buildEvidenceWindowPredicate(partition, windowDays)}
ORDER BY
  CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  created_at DESC,
  tribe_id ASC,
  signal_type ASC
LIMIT ${this.resolveQueryLimit(windowDays)}
`.trim();
  }

  private buildEvidenceWindowPredicate(
    partition: PipelinePartitionDate,
    windowDays: number | undefined,
  ): string {
    if (!windowDays || windowDays <= 1) return "";
    const endDate = `${partition.year}-${partition.month}-${partition.day}`;
    return [
      "AND CAST(evidence_window_start AS date) BETWEEN",
      `date_add('day', -${windowDays - 1}, DATE '${endDate}')`,
      `AND DATE '${endDate}'`,
    ].join(" ");
  }

  private resolveSource(): DecisionSignalsSource {
    const source =
      this.options.source ??
      process.env.PIPELINE_DECISION_SIGNALS_SOURCE ??
      process.env.PIPELINE_GOVERNANCE_SOURCE ??
      process.env.PIPELINE_HEALTH_SOURCE ??
      "fixture";
    if (source === "fixture" || source === "athena") return source;
    throw new ValidationError(
      "PIPELINE_DECISION_SIGNALS_SOURCE must be fixture or athena.",
    );
  }

  private resolveAthenaDatabase(): string {
    return (
      this.options.athenaDatabase ??
      process.env.PIPELINE_DECISION_SIGNALS_ATHENA_DATABASE ??
      process.env.PIPELINE_GOVERNANCE_ATHENA_DATABASE ??
      "gold_platform"
    );
  }

  private resolveAthenaWorkgroup(environment: PipelineHealthEnvironment): string {
    return (
      this.options.athenaWorkgroup ??
      process.env.PIPELINE_DECISION_SIGNALS_ATHENA_WORKGROUP ??
      process.env.PIPELINE_GOVERNANCE_ATHENA_WORKGROUP ??
      `api-center-platform-validation-${environment}`
    );
  }

  private resolveQueryLimit(windowDays?: number): number {
    const configured =
      this.options.queryLimit ??
      (process.env.PIPELINE_DECISION_SIGNALS_QUERY_LIMIT
        ? Number.parseInt(process.env.PIPELINE_DECISION_SIGNALS_QUERY_LIMIT, 10)
        : undefined);
    if (
      typeof configured === "number" &&
      Number.isFinite(configured) &&
      configured > 0
    ) {
      return configured;
    }

    const value = windowDays && windowDays > 1 ? 500 : 100;
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
        process.env.PIPELINE_DECISION_SIGNALS_YEAR ??
        process.env.PIPELINE_GOVERNANCE_YEAR ??
        String(now.getUTCFullYear()),
      month:
        this.options.month ??
        process.env.PIPELINE_DECISION_SIGNALS_MONTH ??
        process.env.PIPELINE_GOVERNANCE_MONTH ??
        String(now.getUTCMonth() + 1).padStart(2, "0"),
      day:
        this.options.day ??
        process.env.PIPELINE_DECISION_SIGNALS_DAY ??
        process.env.PIPELINE_GOVERNANCE_DAY ??
        String(now.getUTCDate()).padStart(2, "0"),
    };
  }

  private normalizeRow(row: RawDecisionSignalRow): PipelineDecisionSignalRow {
    return {
      signalId: this.readRequiredString(row.signalId ?? row.signal_id, "signal_id"),
      environment: this.readEnvironment(row.environment),
      tribeId: this.readRequiredString(row.tribeId ?? row.tribe_id, "tribe_id"),
      sourceServiceId: this.readOptionalString(
        row.sourceServiceId ?? row.source_service_id,
      ),
      signalType: this.readSignalType(row.signalType ?? row.signal_type),
      severity: this.readSeverity(row.severity),
      metricName: this.readRequiredString(
        row.metricName ?? row.metric_name,
        "metric_name",
      ),
      observedValue: this.readNumber(
        row.observedValue ?? row.observed_value,
        "observed_value",
      ),
      expectedValue: this.readNumber(
        row.expectedValue ?? row.expected_value,
        "expected_value",
      ),
      recommendation: this.readRequiredString(
        row.recommendation,
        "recommendation",
      ),
      evidenceQueryId: this.readOptionalString(
        row.evidenceQueryId ?? row.evidence_query_id,
      ),
      evidenceWindowStart: this.readRequiredString(
        row.evidenceWindowStart ?? row.evidence_window_start,
        "evidence_window_start",
      ),
      evidenceWindowEnd: this.readRequiredString(
        row.evidenceWindowEnd ?? row.evidence_window_end,
        "evidence_window_end",
      ),
      createdAt: this.readRequiredString(row.createdAt ?? row.created_at, "created_at"),
      status: this.readStatus(row.status),
    };
  }

  private readEnvironment(value: unknown): PipelineHealthEnvironment {
    if (value === "test" || value === "prod") return value;
    throw new ValidationError("environment must be one of: test, prod");
  }

  private readSignalType(value: unknown): PipelineDecisionSignalType {
    if (
      value === "pipeline_stale" ||
      value === "bronze_quality_regression" ||
      value === "athena_cost_spike" ||
      value === "gateway_denial_spike" ||
      value === "shared_service_error_spike"
    ) {
      return value;
    }
    throw new Error("signal_type is not supported");
  }

  private readSeverity(value: unknown): PipelineDecisionSignalSeverity {
    if (value === "low" || value === "medium" || value === "high") return value;
    throw new Error("severity must be low, medium, or high");
  }

  private readStatus(value: unknown): PipelineDecisionSignalStatus {
    if (
      value === "open" ||
      value === "acknowledged" ||
      value === "false_positive" ||
      value === "action_requested" ||
      value === "blocked"
    ) {
      return value;
    }
    throw new Error("status is not supported");
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

  private readRawRow(value: unknown): RawDecisionSignalRow {
    if (value && typeof value === "object") {
      return value as RawDecisionSignalRow;
    }
    throw new Error("Pipeline decision signal row must be an object.");
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
