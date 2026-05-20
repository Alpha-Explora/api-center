CREATE DATABASE IF NOT EXISTS gold_platform;

CREATE OR REPLACE VIEW gold_platform.pipeline_health_daily AS
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS event_day,
  year,
  month,
  day,
  COUNT(*) AS event_count,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM common_silver.tribe_event_envelope
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;
