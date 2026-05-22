CREATE DATABASE IF NOT EXISTS gold_platform;

CREATE OR REPLACE VIEW gold_platform.event_quality_daily AS
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS event_day,
  year,
  month,
  day,
  COUNT(*) AS event_count,
  SUM(CASE WHEN quality_status = 'valid' THEN 1 ELSE 0 END) AS valid_event_count,
  SUM(CASE WHEN quality_status <> 'valid' THEN 1 ELSE 0 END) AS invalid_event_count,
  SUM(CASE WHEN quality_error IS NOT NULL THEN 1 ELSE 0 END) AS quality_error_count,
  MAX(quality_error) AS latest_quality_error,
  MAX(coalesce(occurred_at, ingested_at)) AS latest_observed_at
FROM bronze.tribe_events
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;

CREATE OR REPLACE VIEW gold_platform.gateway_decision_daily AS
WITH gateway_events AS (
  SELECT
    source_topic,
    environment,
    ops_stream,
    event_type,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.tribeId'),
      json_extract_scalar(raw_record, '$.payload.ownerTribeId'),
      json_extract_scalar(raw_record, '$.payload.callerTribeId'),
      json_extract_scalar(raw_record, '$.tribeId'),
      json_extract_scalar(raw_record, '$.ownerTribeId'),
      'unknown'
    ) AS tribe_id,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.sourceServiceId'),
      json_extract_scalar(raw_record, '$.payload.serviceId'),
      json_extract_scalar(raw_record, '$.sourceServiceId'),
      json_extract_scalar(raw_record, '$.serviceId')
    ) AS source_service_id,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.targetServiceId'),
      json_extract_scalar(raw_record, '$.payload.sharedServiceId'),
      json_extract_scalar(raw_record, '$.payload.targetService'),
      json_extract_scalar(raw_record, '$.targetServiceId'),
      json_extract_scalar(raw_record, '$.sharedServiceId')
    ) AS target_service_id,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.scope'),
      json_extract_scalar(raw_record, '$.payload.requiredScope'),
      json_extract_scalar(raw_record, '$.scope'),
      json_extract_scalar(raw_record, '$.requiredScope')
    ) AS scope,
    lower(COALESCE(
      json_extract_scalar(raw_record, '$.payload.decision'),
      json_extract_scalar(raw_record, '$.payload.policyDecision'),
      json_extract_scalar(raw_record, '$.decision'),
      json_extract_scalar(raw_record, '$.policyDecision')
    )) AS explicit_decision,
    TRY_CAST(status AS integer) AS status_code,
    TRY_CAST(latency_ms AS double) AS latency_ms_number,
    occurred_at,
    ingested_at,
    year,
    month,
    day
  FROM bronze.apicenter_ops_events
  WHERE ops_stream LIKE 'gateway.%'
),
classified AS (
  SELECT
    *,
    CASE
      WHEN explicit_decision IN ('allow', 'allowed', 'pass', 'approved') THEN 'allowed'
      WHEN explicit_decision IN ('deny', 'denied', 'block', 'blocked', 'rejected') THEN 'denied'
      WHEN status_code BETWEEN 200 AND 399 THEN 'allowed'
      WHEN status_code >= 400 THEN 'denied'
      ELSE 'unknown'
    END AS decision
  FROM gateway_events
)
SELECT
  environment,
  tribe_id,
  source_service_id,
  target_service_id,
  scope,
  decision,
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS event_day,
  year,
  month,
  day,
  COUNT(*) AS decision_count,
  SUM(CASE WHEN decision = 'allowed' THEN 1 ELSE 0 END) AS allowed_count,
  SUM(CASE WHEN decision = 'denied' THEN 1 ELSE 0 END) AS denied_count,
  AVG(latency_ms_number) AS avg_latency_ms,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM classified
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10;

CREATE OR REPLACE VIEW gold_platform.athena_query_cost_daily AS
WITH query_events AS (
  SELECT
    environment,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.workgroup'),
      json_extract_scalar(raw_record, '$.payload.workGroup'),
      json_extract_scalar(raw_record, '$.workgroup'),
      json_extract_scalar(raw_record, '$.workGroup'),
      'unknown'
    ) AS workgroup,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.resultPurpose'),
      json_extract_scalar(raw_record, '$.payload.result_purpose'),
      json_extract_scalar(raw_record, '$.resultPurpose'),
      json_extract_scalar(raw_record, '$.result_purpose'),
      'unknown'
    ) AS result_purpose,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.queryExecutionId'),
      json_extract_scalar(raw_record, '$.payload.query_execution_id'),
      json_extract_scalar(raw_record, '$.queryExecutionId'),
      json_extract_scalar(raw_record, '$.query_execution_id')
    ) AS query_execution_id,
    TRY_CAST(COALESCE(
      json_extract_scalar(raw_record, '$.payload.bytesScanned'),
      json_extract_scalar(raw_record, '$.payload.bytes_scanned'),
      json_extract_scalar(raw_record, '$.bytesScanned'),
      json_extract_scalar(raw_record, '$.bytes_scanned')
    ) AS bigint) AS bytes_scanned,
    COALESCE(
      json_extract_scalar(raw_record, '$.payload.completedAt'),
      json_extract_scalar(raw_record, '$.payload.completed_at'),
      json_extract_scalar(raw_record, '$.payload.occurredAt'),
      json_extract_scalar(raw_record, '$.completedAt'),
      json_extract_scalar(raw_record, '$.completed_at'),
      occurred_at,
      ingested_at
    ) AS completed_at,
    year,
    month,
    day
  FROM bronze.apicenter_ops_events
  WHERE event_type IN ('athena.query-executed', 'athena.query.completed')
    OR ops_stream IN ('athena.query-executed', 'athena.query.completed', 'pipeline.athena-query-execution')
)
SELECT
  environment,
  workgroup,
  result_purpose,
  CAST(substr(completed_at, 1, 10) AS date) AS event_day,
  year,
  month,
  day,
  COUNT(*) AS query_count,
  SUM(COALESCE(bytes_scanned, 0)) AS bytes_scanned,
  CAST(SUM(COALESCE(bytes_scanned, 0)) AS double) / POWER(1024, 4) * 5.0 AS estimated_cost_usd,
  MAX(COALESCE(bytes_scanned, 0)) AS max_bytes_scanned,
  MAX(query_execution_id) AS latest_query_execution_id,
  MAX(completed_at) AS latest_completed_at
FROM query_events
GROUP BY 1, 2, 3, 4, 5, 6, 7;
