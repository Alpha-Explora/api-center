CREATE DATABASE IF NOT EXISTS common_silver;

CREATE OR REPLACE VIEW common_silver.tribe_event_envelope AS
SELECT
  source_topic,
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
FROM bronze.tribe_events
WHERE quality_status = 'valid';

CREATE OR REPLACE VIEW common_silver.shared_service_event_envelope AS
SELECT
  source_topic,
  environment,
  tribe_id,
  shared_service_id,
  event_type,
  COALESCE(schema_version, 'unknown') AS schema_version,
  COALESCE(provider, shared_service_id) AS provider,
  COALESCE(provider_status, 'unknown') AS provider_status,
  route,
  method,
  status_code,
  ok,
  latency_ms,
  correlation_id,
  occurred_at,
  ingested_at,
  quality_status,
  quality_error,
  year,
  month,
  day,
  hour,
  raw_record
FROM bronze.shared_service_events
WHERE quality_status = 'valid';
