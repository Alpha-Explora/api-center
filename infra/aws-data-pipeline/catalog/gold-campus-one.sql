-- APICenter CampusOne curated data product.
-- Apply through the approved Athena catalog workflow after event semantics,
-- metric ownership, reader groups, and production approval are recorded.
--
-- Current test data is published through tribe.aping-api.events, while the
-- target CampusOne topic is tribe.campusone.events. This curated database
-- accepts both source tribe IDs and exposes the CampusOne BI surface as
-- gold_campus_one.

CREATE DATABASE IF NOT EXISTS silver_campus_one;
CREATE DATABASE IF NOT EXISTS gold_campus_one;

CREATE OR REPLACE VIEW silver_campus_one.lifecycle_events AS
WITH parsed AS (
  SELECT
    source_topic,
    environment,
    tribe_id,
    source_service_id,
    event_type,
    regexp_extract(event_type, '^([^.]+)', 1) AS lifecycle_domain,
    schema_version,
    schema_validation_status,
    schema_registry_version,
    schema_validation_error,
    occurred_at,
    ingested_at,
    quality_status,
    quality_error,
    year,
    month,
    day,
    hour,
    COALESCE(json_extract_scalar(raw_record, '$'), raw_record) AS event_json,
    raw_record
  FROM common_silver.tribe_event_envelope
  WHERE tribe_id IN ('campusone', 'aping-api')
    AND event_type IN (
      'admissions.inquiry.created',
      'admissions.application.started',
      'admissions.application.submitted',
      'admissions.document.missing',
      'admissions.decision.issued',
      'admissions.offer.accepted',
      'admissions.offer.declined',
      'enrollment.intent.confirmed',
      'enrollment.registration.started',
      'enrollment.registration.completed',
      'enrollment.section.dropped',
      'enrollment.student.withdrawn',
      'enrollment.risk.detected',
      'enrollment.intervention.created',
      'enrollment.intervention.resolved',
      'payment.invoice.created',
      'payment.invoice.dueSoon',
      'payment.payment.succeeded',
      'payment.payment.failed',
      'payment.balance.overdue',
      'payment.plan.created',
      'payment.refund.issued',
      'payment.revenueAtRisk.detected',
      'academic.grade.posted',
      'academic.attendance.recorded',
      'academic.assessment.failed',
      'academic.course.completed',
      'academic.progress.riskDetected',
      'academic.faculty.feedback.submitted',
      'academic.quality.issueDetected',
      'alumni.eligibility.confirmed',
      'alumni.clearance.started',
      'alumni.clearance.completed',
      'alumni.graduation.confirmed',
      'alumni.profile.created',
      'alumni.employment.updated',
      'security.login.succeeded',
      'security.login.failed',
      'security.role.changed',
      'security.suspiciousActivity.detected',
      'system.integration.failed',
      'system.api.error',
      'system.sla.breached'
    )
)
SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  event_type,
  lifecycle_domain,
  schema_version,
  schema_validation_status,
  schema_registry_version,
  schema_validation_error,
  occurred_at,
  ingested_at,
  quality_status,
  quality_error,
  year,
  month,
  day,
  hour,
  json_extract_scalar(event_json, '$.payload.studentId') AS student_id,
  json_extract_scalar(event_json, '$.payload.applicationId') AS application_id,
  json_extract_scalar(event_json, '$.payload.enrollmentId') AS enrollment_id,
  json_extract_scalar(event_json, '$.payload.invoiceId') AS invoice_id,
  json_extract_scalar(event_json, '$.payload.courseId') AS course_id,
  json_extract_scalar(event_json, '$.payload.programId') AS program_id,
  json_extract_scalar(event_json, '$.payload.campusId') AS campus_id,
  json_extract_scalar(event_json, '$.payload.termId') AS term_id,
  json_extract_scalar(event_json, '$.payload.status') AS status,
  json_extract_scalar(event_json, '$.payload.riskType') AS risk_type,
  json_extract_scalar(event_json, '$.payload.riskBand') AS risk_band,
  json_extract_scalar(event_json, '$.payload.priority') AS priority,
  json_extract_scalar(event_json, '$.payload.severity') AS severity,
  json_extract_scalar(event_json, '$.payload.reasonCode') AS reason_code,
  json_extract_scalar(event_json, '$.payload.recommendedAction') AS recommended_action,
  try_cast(json_extract_scalar(event_json, '$.payload.riskScore') AS double) AS risk_score,
  try_cast(json_extract_scalar(event_json, '$.payload.amount') AS double) AS amount,
  try_cast(json_extract_scalar(event_json, '$.payload.balanceAmount') AS double) AS balance_amount,
  json_extract_scalar(event_json, '$.payload.currency') AS currency,
  raw_record
FROM parsed;

CREATE OR REPLACE VIEW gold_campus_one.lifecycle_event_daily AS
SELECT
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS metric_day,
  environment,
  tribe_id,
  lifecycle_domain,
  event_type,
  program_id,
  campus_id,
  term_id,
  year,
  month,
  day,
  COUNT(*) AS event_count,
  COUNT(DISTINCT source_service_id) AS source_service_count,
  COUNT(DISTINCT student_id) AS student_count,
  MIN(occurred_at) AS first_occurred_at,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM silver_campus_one.lifecycle_events
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11;

CREATE OR REPLACE VIEW gold_campus_one.risk_priority_daily AS
SELECT
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS metric_day,
  environment,
  tribe_id,
  lifecycle_domain,
  event_type,
  program_id,
  campus_id,
  term_id,
  COALESCE(risk_type, 'unspecified') AS risk_type,
  COALESCE(risk_band, priority, severity, 'unspecified') AS risk_priority,
  year,
  month,
  day,
  COUNT(*) AS risk_event_count,
  COUNT(DISTINCT student_id) AS affected_student_count,
  AVG(risk_score) AS avg_risk_score,
  SUM(
    CASE
      WHEN lifecycle_domain = 'payment' THEN COALESCE(balance_amount, amount, 0)
      ELSE 0
    END
  ) AS payment_amount_at_risk,
  MIN(occurred_at) AS first_occurred_at,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM silver_campus_one.lifecycle_events
WHERE lower(event_type) LIKE '%risk%'
   OR risk_type IS NOT NULL
   OR risk_band IS NOT NULL
   OR priority IS NOT NULL
   OR severity IS NOT NULL
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13;

CREATE OR REPLACE VIEW gold_campus_one.northstar_daily AS
SELECT
  CAST(substr(coalesce(occurred_at, ingested_at), 1, 10) AS date) AS metric_day,
  environment,
  tribe_id,
  year,
  month,
  day,
  COUNT(*) AS total_event_count,
  SUM(CASE WHEN lifecycle_domain = 'admissions' THEN 1 ELSE 0 END) AS admissions_event_count,
  SUM(CASE WHEN lifecycle_domain = 'enrollment' THEN 1 ELSE 0 END) AS enrollment_event_count,
  SUM(CASE WHEN lifecycle_domain = 'payment' THEN 1 ELSE 0 END) AS payment_event_count,
  SUM(CASE WHEN lifecycle_domain = 'academic' THEN 1 ELSE 0 END) AS academic_event_count,
  SUM(CASE WHEN lifecycle_domain = 'alumni' THEN 1 ELSE 0 END) AS alumni_event_count,
  SUM(CASE WHEN lifecycle_domain IN ('security', 'system') THEN 1 ELSE 0 END) AS security_reliability_event_count,
  SUM(
    CASE
      WHEN lower(event_type) LIKE '%risk%'
        OR risk_type IS NOT NULL
        OR risk_band IS NOT NULL
        OR priority IS NOT NULL
        OR severity IS NOT NULL THEN 1
      ELSE 0
    END
  ) AS risk_event_count,
  SUM(
    CASE
      WHEN lower(COALESCE(risk_band, priority, severity, '')) IN ('high', 'critical') THEN 1
      ELSE 0
    END
  ) AS high_priority_risk_count,
  SUM(CASE WHEN event_type = 'admissions.offer.accepted' THEN 1 ELSE 0 END) AS offer_accepted_count,
  SUM(CASE WHEN event_type = 'enrollment.registration.completed' THEN 1 ELSE 0 END) AS registration_completed_count,
  SUM(CASE WHEN event_type = 'payment.payment.succeeded' THEN COALESCE(amount, 0) ELSE 0 END) AS payment_succeeded_amount,
  SUM(CASE WHEN event_type IN ('payment.balance.overdue', 'payment.revenueAtRisk.detected') THEN COALESCE(balance_amount, amount, 0) ELSE 0 END) AS revenue_at_risk_amount,
  COUNT(DISTINCT source_service_id) AS source_service_count,
  COUNT(DISTINCT student_id) AS student_count,
  MAX(ingested_at) AS latest_ingested_at
FROM silver_campus_one.lifecycle_events
GROUP BY 1, 2, 3, 4, 5, 6;

-- Bounded validation query to run after applying the views:
--
-- SELECT *
-- FROM gold_campus_one.northstar_daily
-- WHERE environment = 'prod'
--   AND year = '2026'
--   AND month = '05'
--   AND day = '23'
--   AND metric_day = DATE '2026-05-23'
-- LIMIT 50;
