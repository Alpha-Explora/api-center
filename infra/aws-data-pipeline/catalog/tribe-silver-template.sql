-- APICenter generated tribe curated data product template.
-- Replace placeholders only through scripts/data-pipeline/generate-tribe-curated-sql.ps1
-- after data classification and semantic approval.
-- owner: <owner>
-- steward: <steward>
-- approved_reader_group: <approved_reader_group>
-- environment: <environment>
-- tribe_id: <tribe_id>
-- domain_event_type: <domain_event_type>
-- source common_silver view: common_silver.tribe_event_envelope
CREATE DATABASE IF NOT EXISTS silver_<tribe_id>;

CREATE OR REPLACE VIEW silver_<tribe_id>.<domain_event_type> AS
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
FROM common_silver.tribe_event_envelope
WHERE environment = '<environment>'
  AND tribe_id = '<tribe_id>'
  AND event_type = '<domain_event_type>';
