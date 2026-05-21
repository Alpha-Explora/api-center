CREATE DATABASE IF NOT EXISTS bronze;

CREATE OR REPLACE VIEW bronze.shared_service_events AS
WITH parsed AS (
  SELECT
    physical_topic,
    year,
    month,
    day,
    hour,
    COALESCE(json_extract_scalar(raw_line, '$'), raw_line) AS event_json,
    raw_line
  FROM api_center_raw.topic_records
),
enriched AS (
  SELECT
    physical_topic,
    year,
    month,
    day,
    hour,
    event_json,
    raw_line,
    CASE
      WHEN physical_topic LIKE 'test.%' THEN 'test'
      WHEN physical_topic LIKE 'prod.%' THEN 'prod'
      ELSE 'unknown'
    END AS environment,
    COALESCE(
      json_extract_scalar(event_json, '$.sharedServiceId'),
      json_extract_scalar(event_json, '$.payload.sharedServiceId'),
      split_part(physical_topic, '.', 4)
    ) AS shared_service_id,
    COALESCE(
      json_extract_scalar(event_json, '$.eventType'),
      json_extract_scalar(event_json, '$.payload.eventType')
    ) AS event_type,
    COALESCE(
      json_extract_scalar(event_json, '$.metadata.schemaVersion'),
      json_extract_scalar(event_json, '$.schemaVersion'),
      json_extract_scalar(event_json, '$.payload.schemaVersion')
    ) AS schema_version,
    COALESCE(
      json_extract_scalar(event_json, '$.tribeId'),
      json_extract_scalar(event_json, '$.payload.tribeId')
    ) AS tribe_id,
    COALESCE(
      json_extract_scalar(event_json, '$.response.provider'),
      json_extract_scalar(event_json, '$.lifecycle.provider'),
      json_extract_scalar(event_json, '$.payload.provider'),
      json_extract_scalar(event_json, '$.provider')
    ) AS provider,
    COALESCE(
      json_extract_scalar(event_json, '$.response.status'),
      json_extract_scalar(event_json, '$.lifecycle.status'),
      json_extract_scalar(event_json, '$.payload.status')
    ) AS explicit_provider_status,
    COALESCE(
      json_extract_scalar(event_json, '$.timestamp'),
      json_extract_scalar(event_json, '$._meta.timestamp'),
      json_extract_scalar(event_json, '$.payload.occurredAt')
    ) AS occurred_at,
    json_extract_scalar(event_json, '$.route') AS route,
    json_extract_scalar(event_json, '$.method') AS method,
    TRY_CAST(json_extract_scalar(event_json, '$.statusCode') AS integer) AS status_code,
    TRY_CAST(json_extract_scalar(event_json, '$.ok') AS boolean) AS ok,
    TRY_CAST(json_extract_scalar(event_json, '$.latencyMs') AS double) AS latency_ms,
    json_extract_scalar(event_json, '$.correlationId') AS correlation_id
  FROM parsed
)
SELECT
  physical_topic AS source_topic,
  environment,
  shared_service_id,
  tribe_id,
  event_type,
  schema_version,
  provider,
  COALESCE(
    explicit_provider_status,
    CASE
      WHEN ok = true THEN 'success'
      WHEN ok = false THEN 'failure'
      WHEN status_code BETWEEN 200 AND 399 THEN 'success'
      WHEN status_code >= 400 THEN 'failure'
      ELSE NULL
    END
  ) AS provider_status,
  route,
  method,
  status_code,
  ok,
  latency_ms,
  correlation_id,
  occurred_at,
  year,
  month,
  day,
  hour,
  raw_line AS raw_record,
  CAST(current_timestamp AS varchar) AS ingested_at,
  CASE
    WHEN event_type IS NULL THEN 'invalid'
    WHEN physical_topic NOT LIKE 'test.api-center.shared.%.events'
      AND physical_topic NOT LIKE 'prod.api-center.shared.%.events' THEN 'invalid'
    WHEN shared_service_id <> split_part(physical_topic, '.', 4) THEN 'invalid'
    WHEN tribe_id IS NULL THEN 'invalid'
    ELSE 'valid'
  END AS quality_status,
  CASE
    WHEN event_type IS NULL THEN 'missing eventType'
    WHEN physical_topic NOT LIKE 'test.api-center.shared.%.events'
      AND physical_topic NOT LIKE 'prod.api-center.shared.%.events' THEN 'invalid shared-service export topic'
    WHEN shared_service_id <> split_part(physical_topic, '.', 4) THEN 'sharedServiceId does not match topic service id'
    WHEN tribe_id IS NULL THEN 'missing tribeId'
    ELSE NULL
  END AS quality_error
FROM enriched
WHERE physical_topic LIKE 'test.api-center.shared.%.events'
   OR physical_topic LIKE 'prod.api-center.shared.%.events';
