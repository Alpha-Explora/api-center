WITH combined AS (
  SELECT
    environment,
    tribe_id,
    source_service_id,
    quality_status
  FROM bronze.tribe_events
  WHERE environment = '${environment}'
    AND year = '${year}'
    AND month = '${month}'
    AND day = '${day}'
)
SELECT
  SUM(CASE WHEN quality_status <> 'valid' THEN 1 ELSE 0 END) AS invalid_quality_count,
  SUM(CASE WHEN tribe_id IS NULL OR tribe_id = '' THEN 1 ELSE 0 END) AS missing_tribe_id_count,
  SUM(CASE WHEN source_service_id IS NULL OR source_service_id = '' THEN 1 ELSE 0 END) AS missing_source_service_id_count,
  SUM(CASE WHEN environment <> '${environment}' THEN 1 ELSE 0 END) AS unexpected_environment_count,
  COUNT(*) AS checked_record_count
FROM combined;
