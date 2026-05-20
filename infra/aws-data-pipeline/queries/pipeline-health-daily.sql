SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  event_day,
  event_count,
  latest_occurred_at,
  latest_ingested_at
FROM gold_platform.pipeline_health_daily
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
ORDER BY event_day DESC, tribe_id, source_service_id, event_type;
