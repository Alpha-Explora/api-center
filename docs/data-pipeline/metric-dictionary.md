# Data Pipeline Metric Dictionary

Gold metrics require an owner, formula, source tables, filters, and approval.

| Metric                          | Owner                          | Formula                                                                                                | Source                                                                        | Required filters                                                                                                                                               | Approval state |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `event_count`                   | Platform data-platform owner   | `COUNT(*)` grouped by environment, tribe, source service, event type, and day                          | `common_silver.tribe_event_envelope`                                          | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `latest_occurred_at`            | Platform data-platform owner   | `MAX(occurred_at)`                                                                                     | `common_silver.tribe_event_envelope`                                          | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `latest_ingested_at`            | Platform data-platform owner   | `MAX(ingested_at)`                                                                                     | `common_silver.tribe_event_envelope`                                          | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `shared_service_event_count`    | Platform shared-services owner | `COUNT(*)` grouped by environment, consuming tribe, shared service, provider, provider status, and day | `common_silver.shared_service_event_envelope`                                 | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `shared_service_success_count`  | Platform shared-services owner | `SUM(1)` when `ok = true` or `status_code BETWEEN 200 AND 399`                                         | `common_silver.shared_service_event_envelope`                                 | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `shared_service_failure_count`  | Platform shared-services owner | `SUM(1)` when `ok = false` or `status_code >= 400`                                                     | `common_silver.shared_service_event_envelope`                                 | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `shared_service_success_rate`   | Platform shared-services owner | `success_count / event_count` grouped by environment, shared service, provider, and day                | `gold_platform.shared_service_provider_health_daily`                          | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `shared_service_failure_rate`   | Platform shared-services owner | `failure_count / event_count` grouped by environment, shared service, provider, and day                | `gold_platform.shared_service_provider_health_daily`                          | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `shared_service_avg_latency_ms` | Platform shared-services owner | `AVG(latency_ms)` grouped by environment, shared service, provider, and day                            | `common_silver.shared_service_event_envelope`                                 | Production dashboards use `environment = 'prod'` and bounded date partitions                                                                                   | Draft          |
| `tribe_event_daily`             | Tribe data product owner       | `COUNT(*)` grouped by metric day, environment, tribe, and event type                                   | `gold_<tribe_id>.<metric_name>` generated by `generate-tribe-curated-sql.ps1` | Generated Silver filters `environment`, `tribe_id`, and `event_type`; validation query also filters `year`, `month`, and `day`                                 | Template       |
| `order_created_daily`           | Logistics data product owner   | `COUNT(*)` for `order.created` events by metric day in the logistics prod pilot lane                   | `gold_logistics.order_created_daily` after operator apply                     | Production validation uses `environment = 'prod'`, `tribe_id = 'logistics'`, `event_type = 'order.created'`, and bounded `year/month/day`                      | Pilot approved |
| `pipeline_flush_daily`          | API Center platform owner      | `COUNT(*)` for `codex.pipeline.flush` by metric day in the pilot test lane                             | `gold_codex_sdk_20260520041053.pipeline_flush_daily` after operator apply     | Test-only validation uses `environment = 'test'`, `tribe_id = 'codex-sdk-20260520041053'`, `event_type = 'codex.pipeline.flush'`, and bounded `year/month/day` | Test draft     |

## Required Approval Fields

```text
metric_name:
owner:
business_definition:
formula:
source_tables:
required_filters:
approved_reader_groups:
approval_state:
approved_at:
next_review_at:
validation_query:
```

## Production Pilot Approval

No production dashboard row is approved until:

| Requirement        | Required value                     |
| ------------------ | ---------------------------------- |
| Metric owner       | Named platform or tribe owner      |
| Formula            | Recorded in this dictionary        |
| Source             | Gold or approved Tribe Silver only |
| Environment filter | `environment = 'prod'`             |
| Raw S3 access      | Not granted to BI users            |
| Reader group       | Named approved group               |
| Review date        | Recorded before dashboard refresh  |
