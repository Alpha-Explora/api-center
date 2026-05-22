SELECT
  source_topic,
  environment,
  ops_stream,
  event_type,
  quality_status,
  quality_error,
  COUNT(*) AS event_count
FROM bronze.apicenter_ops_events
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY source_topic, ops_stream, event_type;
