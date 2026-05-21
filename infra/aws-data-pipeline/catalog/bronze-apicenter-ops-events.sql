CREATE DATABASE IF NOT EXISTS bronze;

CREATE OR REPLACE VIEW bronze.apicenter_ops_events AS
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
classified AS (
  SELECT
    physical_topic,
    year,
    month,
    day,
    hour,
    event_json,
    raw_line,
    CASE
      WHEN physical_topic LIKE 'test.api-center.ops.%.events'
        OR physical_topic LIKE 'prod.api-center.ops.%.events'
        THEN regexp_extract(physical_topic, '^(?:test|prod)[.]api-center[.]ops[.](.*)[.]events$', 1)
      WHEN (physical_topic LIKE 'test.api-center.%.%'
        OR physical_topic LIKE 'prod.api-center.%.%')
        AND physical_topic NOT LIKE 'test.api-center.shared.%.events'
        AND physical_topic NOT LIKE 'prod.api-center.shared.%.events'
        THEN regexp_extract(physical_topic, '^(?:test|prod)[.]api-center[.](.*)$', 1)
      ELSE NULL
    END AS ops_stream
  FROM parsed
)
SELECT
  physical_topic AS source_topic,
  CASE
    WHEN physical_topic LIKE 'test.%' THEN 'test'
    WHEN physical_topic LIKE 'prod.%' THEN 'prod'
    ELSE 'unknown'
  END AS environment,
  ops_stream,
  COALESCE(json_extract_scalar(event_json, '$.eventType'), ops_stream) AS event_type,
  json_extract_scalar(event_json, '$.metadata.schemaVersion') AS schema_version,
  COALESCE(
    json_extract_scalar(event_json, '$.payload.status'),
    json_extract_scalar(event_json, '$.status'),
    json_extract_scalar(event_json, '$.statusCode')
  ) AS status,
  COALESCE(
    json_extract_scalar(event_json, '$.payload.latencyMs'),
    json_extract_scalar(event_json, '$.latencyMs'),
    json_extract_scalar(event_json, '$.durationMs')
  ) AS latency_ms,
  COALESCE(
    json_extract_scalar(event_json, '$.payload.occurredAt'),
    json_extract_scalar(event_json, '$._meta.timestamp'),
    json_extract_scalar(event_json, '$.timestamp')
  ) AS occurred_at,
  year,
  month,
  day,
  hour,
  raw_line AS raw_record,
  CAST(current_timestamp AS varchar) AS ingested_at,
  CASE
    WHEN ops_stream IS NULL THEN 'invalid'
    ELSE 'valid'
  END AS quality_status,
  CASE
    WHEN ops_stream IS NULL THEN 'invalid APICenter ops export topic'
    ELSE NULL
  END AS quality_error
FROM classified
WHERE ops_stream IS NOT NULL;
