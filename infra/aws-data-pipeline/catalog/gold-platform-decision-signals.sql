-- Phase 11 v1 decision signals are deterministic threshold checks over Gold
-- rows. Rolling baselines and rate/window comparisons are intentionally deferred
-- until enough stable Gold history exists for each metric.
CREATE OR REPLACE VIEW gold_platform.decision_signals_daily AS
SELECT
  concat(environment, ':pipeline_stale:', tribe_id, ':', coalesce(source_service_id, 'unknown'), ':', year, month, day) AS signal_id,
  environment,
  tribe_id,
  source_service_id,
  'pipeline_stale' AS signal_type,
  'high' AS severity,
  'latest_ingested_at_age_hours' AS metric_name,
  CAST(25 AS double) AS observed_value,
  CAST(24 AS double) AS expected_value,
  'check connector lag, S3 sink delivery, and latest raw-to-gold refresh' AS recommendation,
  CAST(NULL AS varchar) AS evidence_query_id,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 00:00:00'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_start,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 23:59:59'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_end,
  CAST(current_timestamp AS timestamp) AS created_at,
  year,
  month,
  day,
  'open' AS status
FROM gold_platform.pipeline_health_daily
WHERE latest_ingested_at IS NULL

UNION ALL

SELECT
  concat(environment, ':bronze_quality_regression:', tribe_id, ':', coalesce(source_service_id, 'unknown'), ':', event_type, ':', year, month, day) AS signal_id,
  environment,
  tribe_id,
  source_service_id,
  'bronze_quality_regression' AS signal_type,
  CASE WHEN quality_error_count >= 10 THEN 'high' ELSE 'medium' END AS severity,
  'quality_error_count' AS metric_name,
  CAST(quality_error_count AS double) AS observed_value,
  CAST(0 AS double) AS expected_value,
  'request tribe schema or publisher fix before promotion' AS recommendation,
  CAST(NULL AS varchar) AS evidence_query_id,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 00:00:00'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_start,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 23:59:59'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_end,
  CAST(current_timestamp AS timestamp) AS created_at,
  year,
  month,
  day,
  'open' AS status
FROM gold_platform.event_quality_daily
WHERE quality_error_count > 0

UNION ALL

SELECT
  concat(environment, ':athena_cost_spike:', workgroup, ':', result_purpose, ':', year, month, day) AS signal_id,
  environment,
  'api-center-platform' AS tribe_id,
  CAST(NULL AS varchar) AS source_service_id,
  'athena_cost_spike' AS signal_type,
  CASE WHEN max_bytes_scanned >= 10737418240 THEN 'high' ELSE 'medium' END AS severity,
  'max_bytes_scanned' AS metric_name,
  CAST(max_bytes_scanned AS double) AS observed_value,
  CAST(1073741824 AS double) AS expected_value,
  'narrow the query, lower refresh cadence, or materialize the curated dataset' AS recommendation,
  latest_query_execution_id AS evidence_query_id,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 00:00:00'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_start,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 23:59:59'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_end,
  CAST(current_timestamp AS timestamp) AS created_at,
  year,
  month,
  day,
  'open' AS status
FROM gold_platform.athena_query_cost_daily
WHERE max_bytes_scanned > 1073741824

UNION ALL

SELECT
  concat(environment, ':gateway_denial_spike:', tribe_id, ':', coalesce(source_service_id, 'unknown'), ':', coalesce(target_service_id, 'unknown'), ':', year, month, day) AS signal_id,
  environment,
  tribe_id,
  source_service_id,
  'gateway_denial_spike' AS signal_type,
  CASE WHEN denied_count >= 10 THEN 'high' ELSE 'medium' END AS severity,
  'denied_count' AS metric_name,
  CAST(denied_count AS double) AS observed_value,
  CAST(0 AS double) AS expected_value,
  'review gateway policy, requested scope, and target service ownership' AS recommendation,
  CAST(NULL AS varchar) AS evidence_query_id,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 00:00:00'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_start,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 23:59:59'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_end,
  CAST(current_timestamp AS timestamp) AS created_at,
  year,
  month,
  day,
  'open' AS status
FROM gold_platform.gateway_decision_daily
WHERE denied_count > 0

UNION ALL

SELECT
  concat(environment, ':shared_service_error_spike:', tribe_id, ':', shared_service_id, ':', provider, ':', year, month, day) AS signal_id,
  environment,
  tribe_id,
  shared_service_id AS source_service_id,
  'shared_service_error_spike' AS signal_type,
  CASE WHEN failure_count >= 10 THEN 'high' ELSE 'medium' END AS severity,
  'failure_count' AS metric_name,
  CAST(failure_count AS double) AS observed_value,
  CAST(0 AS double) AS expected_value,
  'review provider health, retry behavior, and tribe integration error handling' AS recommendation,
  CAST(NULL AS varchar) AS evidence_query_id,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 00:00:00'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_start,
  CAST(date_parse(concat(year, '-', month, '-', day, ' 23:59:59'), '%Y-%m-%d %H:%i:%s') AS timestamp) AS evidence_window_end,
  CAST(current_timestamp AS timestamp) AS created_at,
  year,
  month,
  day,
  'open' AS status
FROM gold_platform.shared_service_usage_daily
WHERE failure_count > 0;
