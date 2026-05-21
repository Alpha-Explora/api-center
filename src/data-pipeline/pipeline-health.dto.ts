import { ValidationError } from "../shared/errors";

export const PIPELINE_HEALTH_ENVIRONMENTS = ["test", "prod"] as const;

export type PipelineHealthEnvironment =
  (typeof PIPELINE_HEALTH_ENVIRONMENTS)[number];

export type PipelineHealthResponseSource = "evidence-file" | "athena-proxy";

export interface PipelinePartitionDate {
  year: string;
  month: string;
  day: string;
}

export interface PipelineHealthRow {
  environment: PipelineHealthEnvironment;
  tribeId: string;
  sourceServiceId?: string;
  eventType: string;
  eventDay: string;
  eventCount: number;
  latestOccurredAt?: string;
  latestIngestedAt?: string;
  connectorName?: string;
  connectorState?: string;
  s3Prefix?: string;
  latestS3ObjectKey?: string;
  latestS3ObjectAt?: string;
  latestBronzeObservedAt?: string;
  latestCommonSilverObservedAt?: string;
  latestGoldObservedAt?: string;
  qualityErrorCount?: number;
  athenaResultLocation?: string;
  bytesScanned?: number;
  lastRefreshedAt?: string;
}

export interface PipelineQualityRow {
  environment: PipelineHealthEnvironment;
  tribeId: string;
  sourceServiceId?: string;
  eventType: string;
  eventDay: string;
  eventCount: number;
  validEventCount: number;
  invalidEventCount: number;
  qualityErrorCount: number;
  latestQualityError?: string;
  latestObservedAt?: string;
}

export interface PipelineSharedServiceUsageRow {
  environment: PipelineHealthEnvironment;
  tribeId: string;
  sharedServiceId: string;
  provider: string;
  providerStatus: string;
  eventDay: string;
  eventCount: number;
  successCount: number;
  failureCount: number;
  latestOccurredAt?: string;
  latestIngestedAt?: string;
}

export interface PipelineGatewayDecisionRow {
  environment: PipelineHealthEnvironment;
  tribeId: string;
  sourceServiceId?: string;
  targetServiceId?: string;
  scope?: string;
  decision: "allowed" | "denied" | "unknown";
  eventDay: string;
  decisionCount: number;
  allowedCount: number;
  deniedCount: number;
  avgLatencyMs?: number;
  latestOccurredAt?: string;
  latestIngestedAt?: string;
}

export interface PipelineAthenaCostRow {
  environment: PipelineHealthEnvironment;
  workgroup: string;
  resultPurpose: string;
  eventDay: string;
  queryCount: number;
  bytesScanned: number;
  estimatedCostUsd: number;
  maxBytesScanned?: number;
  latestQueryExecutionId?: string;
  latestCompletedAt?: string;
}

export type PipelineDecisionSignalType =
  | "pipeline_stale"
  | "bronze_quality_regression"
  | "athena_cost_spike"
  | "gateway_denial_spike"
  | "shared_service_error_spike";

export type PipelineDecisionSignalSeverity = "low" | "medium" | "high";
export type PipelineDecisionSignalStatus =
  | "open"
  | "acknowledged"
  | "false_positive"
  | "action_requested"
  | "blocked";

export interface PipelineDecisionSignalRow {
  signalId: string;
  environment: PipelineHealthEnvironment;
  tribeId: string;
  sourceServiceId?: string;
  signalType: PipelineDecisionSignalType;
  severity: PipelineDecisionSignalSeverity;
  metricName: string;
  observedValue: number;
  expectedValue: number;
  recommendation: string;
  evidenceQueryId?: string;
  evidenceWindowStart: string;
  evidenceWindowEnd: string;
  createdAt: string;
  status: PipelineDecisionSignalStatus;
}

export function parsePipelineHealthEnvironment(
  value: string | undefined,
): PipelineHealthEnvironment {
  const environment = value ?? "test";
  if (
    PIPELINE_HEALTH_ENVIRONMENTS.includes(
      environment as PipelineHealthEnvironment,
    )
  ) {
    return environment as PipelineHealthEnvironment;
  }

  throw new ValidationError("environment must be one of: test, prod");
}

export function parsePipelinePartitionDate(
  year: string | undefined,
  month: string | undefined,
  day: string | undefined,
): PipelinePartitionDate | undefined {
  const values = [year, month, day].filter((value) => value !== undefined);
  if (values.length === 0) return undefined;
  if (values.length !== 3) {
    throw new ValidationError("year, month, and day must be provided together");
  }

  const normalized = {
    year: normalizeDatePart(year, "year", 4),
    month: normalizeDatePart(month, "month", 2),
    day: normalizeDatePart(day, "day", 2),
  };

  const monthNumber = Number(normalized.month);
  const dayNumber = Number(normalized.day);
  if (monthNumber < 1 || monthNumber > 12) {
    throw new ValidationError("month must be between 01 and 12");
  }
  if (dayNumber < 1 || dayNumber > 31) {
    throw new ValidationError("day must be between 01 and 31");
  }

  return normalized;
}

function normalizeDatePart(
  value: string | undefined,
  fieldName: string,
  length: number,
): string {
  const trimmed = value?.trim() ?? "";
  const pattern = new RegExp(`^\\d{${length}}$`);
  if (!pattern.test(trimmed)) {
    throw new ValidationError(`${fieldName} must be ${length} digits`);
  }
  return trimmed;
}
