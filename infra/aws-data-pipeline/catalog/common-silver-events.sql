CREATE DATABASE IF NOT EXISTS common_silver;

CREATE OR REPLACE VIEW common_silver.tribe_event_envelope AS
SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  occurred_at,
  ingested_at,
  quality_status,
  quality_error,
  year,
  month,
  day,
  hour,
  raw_record
FROM bronze.tribe_events
WHERE quality_status = 'valid';
