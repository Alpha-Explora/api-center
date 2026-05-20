-- Replace <tribe_id>, <metric_name>, <domain_event_type>, and grouping logic after Production Metrics Approval.
CREATE DATABASE IF NOT EXISTS gold_<tribe_id>;

CREATE OR REPLACE VIEW gold_<tribe_id>.<metric_name> AS
SELECT
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS metric_day,
  COUNT(*) AS event_count
FROM silver_<tribe_id>.<domain_event_type>
GROUP BY 1;
