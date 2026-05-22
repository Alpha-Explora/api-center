SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  COUNT(*) AS event_count,
  MAX(occurred_at) AS latest_occurred_at
FROM common_silver.tribe_event_envelope
WHERE source_topic = '${physical_topic}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
  AND hour = '${hour}'
GROUP BY 1, 2, 3, 4;
