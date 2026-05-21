-- APICenter generated tribe curated data product template.
-- Replace placeholders only through scripts/data-pipeline/generate-tribe-curated-sql.ps1
-- after Production Metrics Approval.
-- owner: <owner>
-- steward: <steward>
-- approved_reader_group: <approved_reader_group>
-- environment: <environment>
-- tribe_id: <tribe_id>
-- domain_event_type: <domain_event_type>
-- metric_name: <metric_name>
-- source silver view: silver_<tribe_id>.<domain_event_type>
CREATE DATABASE IF NOT EXISTS gold_<tribe_id>;

CREATE OR REPLACE VIEW gold_<tribe_id>.<metric_name> AS
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
FROM silver_<tribe_id>.<domain_event_type>
GROUP BY 1, 2, 3, 4;
