SELECT
  'usage' AS dataset,
  environment,
  tribe_id,
  shared_service_id,
  provider,
  provider_status,
  CAST(event_day AS varchar) AS event_day,
  event_count,
  success_count,
  failure_count,
  latest_occurred_at,
  latest_ingested_at
FROM gold_platform.shared_service_usage_daily
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
ORDER BY event_day DESC, tribe_id, shared_service_id, provider, provider_status;

SELECT
  'provider_health' AS dataset,
  environment,
  shared_service_id,
  provider,
  CAST(event_day AS varchar) AS event_day,
  event_count,
  success_count,
  failure_count,
  success_rate,
  failure_rate,
  avg_latency_ms,
  max_latency_ms,
  latest_occurred_at,
  latest_ingested_at
FROM gold_platform.shared_service_provider_health_daily
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
ORDER BY event_day DESC, shared_service_id, provider;
