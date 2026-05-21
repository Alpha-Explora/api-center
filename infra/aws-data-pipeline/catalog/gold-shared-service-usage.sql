CREATE DATABASE IF NOT EXISTS gold_platform;

CREATE OR REPLACE VIEW gold_platform.shared_service_usage_daily AS
SELECT
  environment,
  tribe_id,
  shared_service_id,
  provider,
  provider_status,
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS event_day,
  year,
  month,
  day,
  COUNT(*) AS event_count,
  SUM(
    CASE
      WHEN ok = true OR status_code BETWEEN 200 AND 399 THEN 1
      ELSE 0
    END
  ) AS success_count,
  SUM(
    CASE
      WHEN ok = false OR status_code >= 400 THEN 1
      ELSE 0
    END
  ) AS failure_count,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM common_silver.shared_service_event_envelope
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

CREATE OR REPLACE VIEW gold_platform.shared_service_provider_health_daily AS
SELECT
  environment,
  shared_service_id,
  provider,
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS event_day,
  year,
  month,
  day,
  COUNT(*) AS event_count,
  SUM(
    CASE
      WHEN ok = true OR status_code BETWEEN 200 AND 399 THEN 1
      ELSE 0
    END
  ) AS success_count,
  SUM(
    CASE
      WHEN ok = false OR status_code >= 400 THEN 1
      ELSE 0
    END
  ) AS failure_count,
  CAST(
    SUM(
      CASE
        WHEN ok = true OR status_code BETWEEN 200 AND 399 THEN 1
        ELSE 0
      END
    ) AS double
  ) / CAST(COUNT(*) AS double) AS success_rate,
  CAST(
    SUM(
      CASE
        WHEN ok = false OR status_code >= 400 THEN 1
        ELSE 0
      END
    ) AS double
  ) / CAST(COUNT(*) AS double) AS failure_rate,
  AVG(latency_ms) AS avg_latency_ms,
  MAX(latency_ms) AS max_latency_ms,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM common_silver.shared_service_event_envelope
GROUP BY 1, 2, 3, 4, 5, 6, 7;
