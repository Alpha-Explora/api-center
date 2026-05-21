SELECT
  signal_id,
  environment,
  tribe_id,
  source_service_id,
  signal_type,
  severity,
  metric_name,
  observed_value,
  expected_value,
  recommendation,
  evidence_query_id,
  CAST(evidence_window_start AS varchar) AS evidence_window_start,
  CAST(evidence_window_end AS varchar) AS evidence_window_end,
  CAST(created_at AS varchar) AS created_at,
  status
FROM gold_platform.decision_signals_daily
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
ORDER BY
  CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  created_at DESC,
  tribe_id ASC,
  signal_type ASC;
