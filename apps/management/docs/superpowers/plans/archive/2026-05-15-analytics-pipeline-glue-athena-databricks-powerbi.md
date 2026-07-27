# Analytics Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the downstream analytics pipeline after shared-service and tribe events are landing in S3.

**Architecture:** S3 remains the raw landing zone from Confluent S3 Sink. AWS Glue catalogs raw and curated data, Athena provides SQL access, Databricks performs Bronze/Silver/Gold transformations, and PowerBI reads curated tables or Athena views. This plan starts only after the shared-service topics/S3 export plan is complete.

**Tech Stack:** AWS S3, AWS Glue Data Catalog, AWS Glue Crawlers, Amazon Athena, Databricks Delta Lake, PowerBI.

---

## Dependency

Follow the ownership model in
`api-center/docs/superpowers/plans/2026-05-19-tribe-data-pipeline-ownership.md`
before implementing downstream analytics. Tribes that are not in S3 yet should
be onboarded through APICenter-governed publishing and the managed S3 Sink
connector, not by creating unmanaged tribe-owned pipelines by default.

Do not start this plan until these topics are exporting to S3:

```text
api-center.audit.log
api-center.shared.sms.events
api-center.shared.email.events
api-center.shared.payment.events
api-center.shared.otp.events
api-center.shared.geo.events
api-center.shared.gauth.events
tribe.<tribeId>.events
```

For tribe-owned microservices, use the owner tribe topic
`tribe.<ownerTribeId>.events` and retain producer attribution with
`sourceServiceId`. Do not create a downstream topic, Bronze job, or dashboard
state per microservice by default.

Expected raw location:

```text
s3://api-center-raw-data/topics/<topic-name>/
```

## Phase 1: Raw S3 Layout Review

**Files:**

- Create: `api-center/docs/data-pipeline/raw-s3-layout.md`

- [ ] Document the actual S3 connector output shape.

Capture:

```text
bucket
topics directory
topic folder naming
partition folder naming
file format
compression
flush size
timestamp partition behavior
```

- [ ] Record sample paths for audit, shared-service, and tribe topics.

- [ ] Decide whether raw files stay JSON or move to Avro/Parquet later.

Recommended first decision:

```text
Keep Confluent raw output as-is first.
Use Databricks to convert to Delta/Parquet in Bronze and Silver.
```

## Phase 2: Glue Data Catalog Foundation

**Files:**

- Create: `api-center/docs/data-pipeline/glue-catalog-plan.md`

- [ ] Create a Glue database for raw API Center data.

Recommended name:

```text
api_center_raw
```

- [ ] Create one crawler for raw Confluent S3 topics.

Recommended crawler name:

```text
api-center-raw-topics-crawler
```

- [ ] Configure crawler target:

```text
s3://api-center-raw-data/topics/
```

- [ ] Configure crawler schedule.

Recommended first schedule:

```text
Manual while testing.
Hourly after stable exports.
```

- [ ] Verify Glue tables are created for topic folders.

## Phase 3: Athena Validation Layer

**Files:**

- Create: `api-center/docs/data-pipeline/athena-validation-queries.md`

- [ ] Create Athena query result bucket or prefix.

Recommended path:

```text
s3://api-center-raw-data/athena-results/
```

- [ ] Validate raw event counts.

Example query shape:

```sql
SELECT count(*) AS events
FROM api_center_raw.api_center_shared_sms_events;
```

- [ ] Validate per-tribe shared-service usage.

Example query shape:

```sql
SELECT tribeId, sharedServiceId, count(*) AS calls
FROM api_center_raw.api_center_shared_sms_events
GROUP BY tribeId, sharedServiceId;
```

- [ ] Validate redaction.

Example checks:

```sql
SELECT *
FROM api_center_raw.api_center_shared_otp_events
WHERE json_extract_scalar(request, '$.code') IS NOT NULL;
```

Expected:

```text
0 rows
```

## Phase 4: Databricks Bronze Layer

**Files:**

- Create: `api-center/docs/data-pipeline/databricks-medallion-plan.md`

- [ ] Mount or connect Databricks to the S3 raw bucket using the approved AWS auth model.

- [ ] Create Bronze tables that preserve raw event content.

Recommended tables:

```text
bronze.api_center_audit_log
bronze.shared_sms_events
bronze.shared_email_events
bronze.shared_payment_events
bronze.shared_otp_events
bronze.shared_geo_events
bronze.shared_gauth_events
bronze.tribe_events
```

- [ ] Add ingestion metadata:

```text
source_topic
source_file
ingested_at
event_date
```

- [ ] Use `eventId` where present for dedupe.

## Phase 5: Databricks Silver Layer

**Files:**

- Modify: `api-center/docs/data-pipeline/databricks-medallion-plan.md`

- [ ] Create normalized shared-service tables.

Recommended Silver tables:

```text
silver.shared_service_calls
silver.sms_events
silver.email_events
silver.payment_events
silver.otp_events
silver.geo_events
silver.gauth_events
silver.tribe_events
```

- [ ] Normalize common columns:

```text
event_id
event_type
tribe_id
shared_service_id
status_code
ok
latency_ms
correlation_id
event_timestamp
event_date
```

- [ ] Deduplicate by `event_id`.

- [ ] Enforce no raw PII columns.

- [ ] Join registry metadata if available:

```text
tribe owner
tribe contact
service tier
cost center
declared consumes
```

## Phase 6: Databricks Gold Layer

**Files:**

- Modify: `api-center/docs/data-pipeline/databricks-medallion-plan.md`

- [ ] Create BI-ready aggregate tables.

Recommended Gold tables:

```text
gold.tribe_shared_service_usage_daily
gold.shared_service_reliability_daily
gold.payment_summary_daily
gold.sms_delivery_summary_daily
gold.otp_usage_daily
gold.geo_usage_daily
gold.api_center_export_health_daily
```

- [ ] Add metrics:

```text
total_calls
success_calls
failed_calls
error_rate
avg_latency_ms
p95_latency_ms
estimated_provider_cost
last_event_at
```

- [ ] Partition Gold tables by `event_date`.

## Phase 7: PowerBI Access

**Files:**

- Create: `api-center/docs/data-pipeline/powerbi-access-plan.md`

- [ ] Choose PowerBI connection mode.

Recommended options:

```text
Option A: PowerBI -> Athena -> Glue tables
Option B: PowerBI -> Databricks SQL Warehouse -> Gold Delta tables
```

Recommended first choice:

```text
Use Athena for early validation.
Use Databricks SQL Warehouse for curated Gold analytics once Silver/Gold is stable.
```

- [ ] Define dataset owners and refresh schedule.

- [ ] Build initial report pages:

```text
Tribe usage
Shared-service reliability
Payment activity
SMS/email/OTP activity
Export pipeline health
Cost signals
```

## Phase 8: Governance And Cost Controls

**Files:**

- Create: `api-center/docs/data-pipeline/governance-and-cost-controls.md`

- [ ] Add S3 lifecycle policy recommendation.

Suggested first policy:

```text
Raw S3: keep 90 days hot, then transition to infrequent access if needed.
Curated Gold: keep according to reporting requirements.
Athena results: expire after 7 to 30 days.
```

- [ ] Add Lake Formation or IAM access plan for analysts.

- [ ] Add cost guardrails:

```text
Athena query result location
Athena workgroup query limits
Databricks cluster/job schedule
Crawler frequency
Small-file compaction schedule
```

## Acceptance Criteria

- Raw S3 topic data is cataloged in Glue.
- Athena can query raw event counts by topic and tribe.
- Databricks Bronze keeps raw data with ingestion metadata.
- Databricks Silver normalizes and deduplicates sanitized event data.
- Databricks Gold exposes BI-ready tables.
- PowerBI reads curated data without touching raw S3 JSON directly.
- Governance docs define retention, redaction, and access boundaries.

## Commit Plan

1. `docs: plan raw s3 and glue catalog layer`
2. `docs: plan athena validation queries`
3. `docs: plan databricks medallion pipeline`
4. `docs: plan powerbi access and governance`
