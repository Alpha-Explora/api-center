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
)
SELECT
  physical_topic AS source_topic,
  CASE
    WHEN physical_topic LIKE 'test.%' THEN 'test'
    WHEN physical_topic LIKE 'prod.%' THEN 'prod'
    ELSE 'unknown'
  END AS environment,
  split_part(physical_topic, '.', 4) AS ops_stream,
  json_extract_scalar(event_json, '$.eventType') AS event_type,
  json_extract_scalar(event_json, '$.metadata.schemaVersion') AS schema_version,
  json_extract_scalar(event_json, '$.payload.status') AS status,
  json_extract_scalar(event_json, '$.payload.latencyMs') AS latency_ms,
  json_extract_scalar(event_json, '$.payload.occurredAt') AS occurred_at,
  year,
  month,
  day,
  hour,
  raw_line AS raw_record,
  CAST(current_timestamp AS varchar) AS ingested_at,
  CASE
    WHEN json_extract_scalar(event_json, '$.eventType') IS NULL THEN 'invalid'
    WHEN physical_topic NOT LIKE 'test.api-center.ops.%.events'
      AND physical_topic NOT LIKE 'prod.api-center.ops.%.events' THEN 'invalid'
    ELSE 'valid'
  END AS quality_status,
  CASE
    WHEN json_extract_scalar(event_json, '$.eventType') IS NULL THEN 'missing eventType'
    WHEN physical_topic NOT LIKE 'test.api-center.ops.%.events'
      AND physical_topic NOT LIKE 'prod.api-center.ops.%.events' THEN 'invalid APICenter ops export topic'
    ELSE NULL
  END AS quality_error
FROM parsed
WHERE physical_topic LIKE 'test.api-center.ops.%.events'
   OR physical_topic LIKE 'prod.api-center.ops.%.events';
