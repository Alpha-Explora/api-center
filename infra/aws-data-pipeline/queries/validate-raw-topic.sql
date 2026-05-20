SELECT
  physical_topic,
  year,
  month,
  day,
  hour,
  COUNT(*) AS raw_record_count
FROM api_center_raw.topic_records
WHERE physical_topic = '${physical_topic}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
  AND hour = '${hour}'
GROUP BY physical_topic, year, month, day, hour;
