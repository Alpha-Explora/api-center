CREATE DATABASE IF NOT EXISTS governance;

CREATE EXTERNAL TABLE IF NOT EXISTS governance.event_schema_registry (
  tribe_id string,
  event_type string,
  schema_version string,
  environment string,
  owner string,
  steward string,
  json_schema string,
  compatibility_mode string,
  status string,
  approved_by string,
  approved_at string,
  registry_version string,
  created_at string,
  updated_at string
)
STORED AS PARQUET
LOCATION 's3://api-center-raw-data/governance/event-schema-registry/';

CREATE OR REPLACE VIEW governance.approved_event_schema_registry AS
SELECT
  tribe_id,
  event_type,
  schema_version,
  environment,
  owner,
  steward,
  json_schema,
  compatibility_mode,
  status,
  approved_by,
  approved_at,
  registry_version,
  created_at,
  updated_at
FROM governance.event_schema_registry
WHERE status = 'approved'
  AND compatibility_mode IN ('backward', 'forward', 'full', 'none-for-test-only')
  AND (
    environment = 'test'
    OR compatibility_mode <> 'none-for-test-only'
  );
