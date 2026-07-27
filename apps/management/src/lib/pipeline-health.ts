import {
  pipelineHealthEnvironmentSchema,
  type PipelineHealthEnvironment,
  type PipelineHealthRow,
} from "@/lib/schemas";

type RawPipelineHealthRow = {
  environment?: unknown;
  tribe_id?: unknown;
  tribeId?: unknown;
  source_service_id?: unknown;
  sourceServiceId?: unknown;
  event_type?: unknown;
  eventType?: unknown;
  event_day?: unknown;
  eventDay?: unknown;
  event_count?: unknown;
  eventCount?: unknown;
  latest_occurred_at?: unknown;
  latestOccurredAt?: unknown;
  latest_ingested_at?: unknown;
  latestIngestedAt?: unknown;
  connector_name?: unknown;
  connectorName?: unknown;
  connector_state?: unknown;
  connectorState?: unknown;
  s3_prefix?: unknown;
  s3Prefix?: unknown;
  latest_s3_object_key?: unknown;
  latestS3ObjectKey?: unknown;
  latest_s3_object_at?: unknown;
  latestS3ObjectAt?: unknown;
  latest_bronze_observed_at?: unknown;
  latestBronzeObservedAt?: unknown;
  latest_common_silver_observed_at?: unknown;
  latestCommonSilverObservedAt?: unknown;
  latest_gold_observed_at?: unknown;
  latestGoldObservedAt?: unknown;
  quality_error_count?: unknown;
  qualityErrorCount?: unknown;
  athena_result_location?: unknown;
  athenaResultLocation?: unknown;
  bytes_scanned?: unknown;
  bytesScanned?: unknown;
  last_refreshed_at?: unknown;
  lastRefreshedAt?: unknown;
};

export function normalizePipelineHealthRows(
  rows: unknown[],
): PipelineHealthRow[] {
  return rows.map((rawRow) => {
    const row = readRawPipelineHealthRow(rawRow);

    return {
    environment: pipelineHealthEnvironmentSchema.parse(row.environment),
    tribeId: readRequiredString(row.tribeId ?? row.tribe_id, "tribe_id"),
    sourceServiceId: readOptionalString(
      row.sourceServiceId ?? row.source_service_id,
    ),
    eventType: readRequiredString(row.eventType ?? row.event_type, "event_type"),
    eventDay: readRequiredString(row.eventDay ?? row.event_day, "event_day"),
    eventCount: readNumber(row.eventCount ?? row.event_count, "event_count"),
    latestOccurredAt: readOptionalString(
      row.latestOccurredAt ?? row.latest_occurred_at,
    ),
    latestIngestedAt: readOptionalString(
      row.latestIngestedAt ?? row.latest_ingested_at,
    ),
    connectorName: readOptionalString(row.connectorName ?? row.connector_name),
    connectorState: readOptionalString(
      row.connectorState ?? row.connector_state,
    ),
    s3Prefix: readOptionalString(row.s3Prefix ?? row.s3_prefix),
    latestS3ObjectKey: readOptionalString(
      row.latestS3ObjectKey ?? row.latest_s3_object_key,
    ),
    latestS3ObjectAt: readOptionalString(
      row.latestS3ObjectAt ?? row.latest_s3_object_at,
    ),
    latestBronzeObservedAt: readOptionalString(
      row.latestBronzeObservedAt ?? row.latest_bronze_observed_at,
    ),
    latestCommonSilverObservedAt: readOptionalString(
      row.latestCommonSilverObservedAt ??
        row.latest_common_silver_observed_at,
    ),
    latestGoldObservedAt: readOptionalString(
      row.latestGoldObservedAt ?? row.latest_gold_observed_at,
    ),
    qualityErrorCount: readOptionalNumber(
      row.qualityErrorCount ?? row.quality_error_count,
    ),
    athenaResultLocation: readOptionalString(
      row.athenaResultLocation ?? row.athena_result_location,
    ),
    bytesScanned: readOptionalNumber(row.bytesScanned ?? row.bytes_scanned),
    lastRefreshedAt: readOptionalString(
      row.lastRefreshedAt ?? row.last_refreshed_at,
    ),
    };
  });
}

export function filterPipelineHealthRows(
  rows: PipelineHealthRow[],
  environment: PipelineHealthEnvironment,
) {
  return rows.filter((row) => row.environment === environment);
}

function readRequiredString(value: unknown, fieldName: string) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`${fieldName} is required`);
}

function readRawPipelineHealthRow(value: unknown): RawPipelineHealthRow {
  if (value && typeof value === "object") {
    return value as RawPipelineHealthRow;
  }

  throw new Error("Pipeline health row must be an object");
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown, fieldName: string) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new Error(`${fieldName} must be a number`);
}

function readOptionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
