SELECT
  SUM(CASE WHEN environment <> '${environment}' THEN 1 ELSE 0 END) AS leaked_environment_count,
  COUNT(*) AS checked_record_count
FROM common_silver.tribe_event_envelope
WHERE source_topic = '${physical_topic}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
  AND hour = '${hour}';
