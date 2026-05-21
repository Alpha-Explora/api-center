SELECT
  environment,
  workgroup,
  result_purpose,
  event_day,
  query_count,
  bytes_scanned,
  estimated_cost_usd,
  latest_query_execution_id
FROM gold_platform.athena_query_cost_daily
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
ORDER BY bytes_scanned DESC
LIMIT 50;
