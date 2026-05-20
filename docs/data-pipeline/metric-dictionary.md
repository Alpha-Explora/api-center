# Data Pipeline Metric Dictionary

Gold metrics require an owner, formula, source tables, filters, and approval.

| Metric | Owner | Formula | Source | Required filters | Approval state |
| --- | --- | --- | --- | --- | --- |
| `event_count` | Platform data-platform owner | `COUNT(*)` grouped by environment, tribe, source service, event type, and day | `common_silver.tribe_event_envelope` | Production dashboards use `environment = 'prod'` and bounded date partitions | Draft |
| `latest_occurred_at` | Platform data-platform owner | `MAX(occurred_at)` | `common_silver.tribe_event_envelope` | Production dashboards use `environment = 'prod'` and bounded date partitions | Draft |
| `latest_ingested_at` | Platform data-platform owner | `MAX(ingested_at)` | `common_silver.tribe_event_envelope` | Production dashboards use `environment = 'prod'` and bounded date partitions | Draft |

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
```

## Production Pilot Approval

No production dashboard row is approved until:

| Requirement | Required value |
| --- | --- |
| Metric owner | Named platform or tribe owner |
| Formula | Recorded in this dictionary |
| Source | Gold or approved Tribe Silver only |
| Environment filter | `environment = 'prod'` |
| Raw S3 access | Not granted to BI users |
| Reader group | Named approved group |
| Review date | Recorded before dashboard refresh |
