# Silver And Gold Ownership Runbook

This runbook defines the curated data ownership boundary after records reach
Bronze.

## Layer Path

```text
Raw S3
  -> bronze.tribe_events
  -> silver.common_tribe_events
  -> silver_<tribe>.<domain_tables>
  -> gold_<tribe>.<business_metrics>
  -> <Tribe> dashboard / BI dataset
```

Per-tribe ownership starts at semantic Silver and Gold, not at raw ingestion.
Do not create `bronze_<tribe>` by default.

## Common Silver

Platform-owned standardization table:

```text
silver.common_tribe_events
```

Required columns:

```text
event_id
event_type
tribe_id
source_service_id
source_system
environment
source_topic
correlation_id
event_timestamp
event_date
ingested_at
payload
metadata
schema_version
quality_status
quality_error
```

Common Silver accepts new tribes through `source_topic`, `environment`,
`tribe_id`, and `source_service_id`. It must not require a job rewrite for each
new tribe or microservice.

## Tribe Silver

Tribe-owned semantic models:

```text
silver_logistics.order_events
silver_campusone.enrollment_events
silver_servease.booking_events
```

The tribe owns the business rules that turn common events into domain facts.
Platform provides templates, review, and data quality guardrails.

Late-provisioned tribes enter Raw, Bronze, and Common Silver first. Tribe
Silver starts only after event semantics are documented and approved.

## Gold

Platform-owned Gold examples:

```text
gold.api_center_export_health_daily
gold.tribe_event_volume_daily
gold.shared_service_reliability_daily
```

Tribe-owned Gold examples:

```text
gold_logistics.order_fulfillment_daily
gold_campusone.enrollment_funnel_daily
```

Gold metrics require a metric dictionary and Production Metrics Approval before
they are labeled production reporting.

## Metric Dictionary Template

```text
metric_name:
business_definition:
formula:
source_tables:
filters:
environment_filter:
refresh_cadence:
accountable_owner:
validation_query:
dashboard_url:
signoff_date:
review_date:
```

## Production Metrics Approval

```text
metric_name:
tribe_id:
domain_owner:
platform_bi_owner:
source_tables:
validation_query:
validation_result:
approved_reader_groups:
dashboard_url:
signoff_at:
next_review_date:
```

No production dashboard should depend on a tribe Gold metric before this
sign-off is complete.

## Validation Query Shape

```sql
SELECT
  tribe_id,
  source_service_id,
  event_type,
  COUNT(*) AS event_count,
  MIN(event_timestamp) AS first_event_at,
  MAX(event_timestamp) AS latest_event_at
FROM silver.common_tribe_events
WHERE environment = 'prod'
  AND tribe_id = '$owner_tribe_id'
GROUP BY 1, 2, 3;
```

## Dashboard Rules

- Production dashboards filter to `environment = 'prod'`.
- Tribe dashboards filter to one `tribe_id` unless cross-tribe access is
  explicitly approved.
- `source_service_id` is available for microservice drill-down.
- Approved reader groups must be recorded before sharing BI content.
