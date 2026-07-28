export type TribeCuratedEnvironment = "test" | "prod";

export interface GenerateTribeCuratedSqlOptions {
  tribeId: string;
  environment: TribeCuratedEnvironment;
  eventType: string;
  metricName: string;
  owner: string;
  steward: string;
  approvedReaderGroup: string;
  year: string;
  month: string;
  day: string;
}

export interface TribeCuratedSqlOutput {
  mode: "dry-run";
  metadata: Record<string, string>;
  silver_sql: string;
  gold_sql: string;
  validation_sql: string;
}

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;
const SOURCE_COMMON_SILVER_VIEW = "common_silver.tribe_event_envelope";

export function generateTribeCuratedSql(
  options: GenerateTribeCuratedSqlOptions,
): TribeCuratedSqlOutput {
  const normalizedOptions = normalizeOptions(options);
  const tribeIdentifier = normalizeIdentifier(
    normalizedOptions.tribeId,
    "TribeId",
  );
  const eventIdentifier = normalizeIdentifier(
    normalizedOptions.eventType,
    "EventType",
  );
  const metricIdentifier = normalizeIdentifier(
    normalizedOptions.metricName,
    "MetricName",
  );
  const silverDatabase = `silver_${tribeIdentifier}`;
  const goldDatabase = `gold_${tribeIdentifier}`;
  const silverView = `${silverDatabase}.${eventIdentifier}`;
  const goldView = `${goldDatabase}.${metricIdentifier}`;
  const metadata = {
    tribe_id: normalizedOptions.tribeId,
    environment: normalizedOptions.environment,
    domain_event_type: normalizedOptions.eventType,
    metric_name: normalizedOptions.metricName,
    owner: normalizedOptions.owner,
    steward: normalizedOptions.steward,
    approved_reader_group: normalizedOptions.approvedReaderGroup,
    source_common_silver_view: SOURCE_COMMON_SILVER_VIEW,
    silver_view: silverView,
    gold_view: goldView,
  };
  const header = buildHeader(metadata);

  return {
    mode: "dry-run",
    metadata,
    silver_sql: buildSilverSql({
      header,
      silverDatabase,
      silverView,
      environment: normalizedOptions.environment,
      tribeId: normalizedOptions.tribeId,
      eventType: normalizedOptions.eventType,
    }),
    gold_sql: buildGoldSql({
      header,
      goldDatabase,
      goldView,
      silverView,
    }),
    validation_sql: buildValidationSql({
      header,
      environment: normalizedOptions.environment,
      tribeId: normalizedOptions.tribeId,
      eventType: normalizedOptions.eventType,
      year: normalizedOptions.year,
      month: normalizedOptions.month,
      day: normalizedOptions.day,
    }),
  };
}

export function normalizeIdentifier(value: string, label: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(
      `${label} must produce a SQL identifier starting with a letter: ${value}`,
    );
  }

  return normalized;
}

function normalizeOptions(
  options: GenerateTribeCuratedSqlOptions,
): GenerateTribeCuratedSqlOptions {
  if (options.environment !== "test" && options.environment !== "prod") {
    throw new Error("Environment must be one of: test, prod.");
  }

  const requiredFields: Array<keyof GenerateTribeCuratedSqlOptions> = [
    "tribeId",
    "eventType",
    "metricName",
    "owner",
    "steward",
    "approvedReaderGroup",
  ];

  for (const field of requiredFields) {
    assertRequired(options[field], field);
  }

  return {
    tribeId: options.tribeId.trim().toLowerCase(),
    environment: options.environment,
    eventType: options.eventType.trim(),
    metricName: options.metricName.trim(),
    owner: options.owner.trim(),
    steward: options.steward.trim(),
    approvedReaderGroup: options.approvedReaderGroup.trim(),
    year: normalizeDatePart(options.year, "Year", 4),
    month: normalizeDatePart(options.month, "Month", 2),
    day: normalizeDatePart(options.day, "Day", 2),
  };
}

function assertRequired(value: string, label: string): void {
  if (String(value ?? "").trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
}

function normalizeDatePart(
  value: string,
  label: string,
  length: number,
): string {
  assertRequired(value, label);
  const normalized = String(value).padStart(length, "0");
  if (!new RegExp(`^\\d{${length}}$`).test(normalized)) {
    throw new Error(`${label} must be ${length} digits.`);
  }
  return normalized;
}

function sqlString(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildHeader(metadata: Record<string, string>): string {
  return [
    "-- APICenter generated tribe curated data product",
    `-- owner: ${metadata.owner}`,
    `-- steward: ${metadata.steward}`,
    `-- approved_reader_group: ${metadata.approved_reader_group}`,
    `-- environment: ${metadata.environment}`,
    `-- tribe_id: ${metadata.tribe_id}`,
    `-- domain_event_type: ${metadata.domain_event_type}`,
    `-- source common_silver view: ${metadata.source_common_silver_view}`,
  ].join("\n");
}

function buildSilverSql(input: {
  header: string;
  silverDatabase: string;
  silverView: string;
  environment: TribeCuratedEnvironment;
  tribeId: string;
  eventType: string;
}): string {
  return `${input.header}
CREATE DATABASE IF NOT EXISTS ${input.silverDatabase};

CREATE OR REPLACE VIEW ${input.silverView} AS
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  schema_validation_status,
  schema_registry_version,
  schema_validation_error,
  occurred_at,
  ingested_at,
  quality_status,
  quality_error,
  year,
  month,
  day,
  hour,
  raw_record
FROM ${SOURCE_COMMON_SILVER_VIEW}
WHERE environment = ${sqlString(input.environment)}
  AND tribe_id = ${sqlString(input.tribeId)}
  AND event_type = ${sqlString(input.eventType)};`;
}

function buildGoldSql(input: {
  header: string;
  goldDatabase: string;
  goldView: string;
  silverView: string;
}): string {
  return `${input.header}
CREATE DATABASE IF NOT EXISTS ${input.goldDatabase};

CREATE OR REPLACE VIEW ${input.goldView} AS
SELECT
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS metric_day,
  environment,
  tribe_id,
  event_type,
  COUNT(*) AS event_count,
  COUNT(DISTINCT source_service_id) AS source_service_count,
  MIN(occurred_at) AS first_occurred_at,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM ${input.silverView}
GROUP BY 1, 2, 3, 4;`;
}

function buildValidationSql(input: {
  header: string;
  environment: TribeCuratedEnvironment;
  tribeId: string;
  eventType: string;
  year: string;
  month: string;
  day: string;
}): string {
  return `${input.header}
SELECT
  environment,
  tribe_id,
  event_type,
  COUNT(*) AS event_count,
  COUNT(DISTINCT source_service_id) AS source_service_count,
  MIN(occurred_at) AS first_occurred_at,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM ${SOURCE_COMMON_SILVER_VIEW}
WHERE environment = ${sqlString(input.environment)}
  AND tribe_id = ${sqlString(input.tribeId)}
  AND event_type = ${sqlString(input.eventType)}
  AND year = ${sqlString(input.year)}
  AND month = ${sqlString(input.month)}
  AND day = ${sqlString(input.day)}
GROUP BY 1, 2, 3;`;
}
