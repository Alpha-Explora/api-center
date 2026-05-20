SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  event_type,
  quality_status,
  COUNT(*) AS bronze_record_count,
  MAX(occurred_at) AS latest_occurred_at
FROM bronze.tribe_events
WHERE source_topic = '${physical_topic}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
  AND hour = '${hour}'
GROUP BY 1, 2, 3, 4, 5, 6;
