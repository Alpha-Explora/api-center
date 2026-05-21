# Platform Team North-Star BI Plan

Date: 2026-05-22

Audience: APICenter platform team members with AWS IAM access.

This plan explains what we need to do to answer the APICenter north-star
question through Athena and BI.

## North-Star Question

For APICenter, the question we need to answer is:

```text
From tribe request to gateway decision to event export to visualization,
can we trace who called what, whether it was allowed, what happened,
how much it cost, and where the data landed?
```

Our BI work is not just about making charts. The goal is to prove that the
APICenter data pipeline is traceable, governed, separated by environment, and
usable by platform and tribe stakeholders.

## What We Are Proving

By the end of the work, we should be able to show:

| Proof area | Question we must answer | Main source |
| --- | --- | --- |
| Tribe ownership | Which tribe produced the event? | Gold / Common Silver |
| Service attribution | Which service produced or consumed it? | Gold / Common Silver |
| Environment separation | Is the data test or prod, and are they separated? | Gold / Common Silver |
| Event arrival | Did events land in APICenter's analytics flow? | Common Silver / Raw validation |
| Pipeline health | How many valid events arrived per tribe, service, event type, and day? | `gold_platform.pipeline_health_daily` |
| Quality | Are records valid, rejected, or missing required fields? | `gold_platform.event_quality_daily` |
| Gateway governance | What was allowed or denied by the gateway? | `gold_platform.gateway_decision_daily` |
| Shared-service usage | Which shared services are being used, succeeding, or failing? | `gold_platform.shared_service_usage_daily` |
| Cost visibility | Which Athena queries are expensive or need optimization? | `gold_platform.athena_query_cost_daily` |
| BI readiness | Can Power BI refresh from governed curated outputs, not raw S3? | `materialized_platform.*` |

## Rules We Must Follow

- Use `ap-southeast-2`.
- Use your own IAM user only.
- Use `api-center-platform-validation-prod` for read validation.
- Use `api-center-materialization-prod` only when approved to create BI-ready
  materialized outputs.
- Do not use raw S3 as a BI source.
- Do not run broad unbounded Athena queries.
- Gold views must be filtered by `environment`, `year`, `month`, and `day`.
- Power BI should use materialized tables when refreshes are repeated.
- Raw S3 is for validation and troubleshooting only.

## Data Layer Map

Use this map before deciding what to query:

```text
Raw S3
  -> api_center_raw.topic_records
  -> bronze.* parsed views
  -> common_silver.* governed event envelope
  -> tribe silver / platform silver
  -> gold_platform.* metrics
  -> materialized_platform.* BI-ready Parquet snapshots
  -> Power BI / dashboard
```

| Layer | What it means | When we use it |
| --- | --- | --- |
| Raw S3 | Exact exported topic records, still as raw lines | Only to prove data landed |
| Bronze | Parsed raw events plus quality status | Troubleshooting parsing or rejected records |
| Common Silver | Standard event envelope across tribes | Event-level validation and mapping |
| Gold | Aggregated platform and governance metrics | Primary analytics source |
| Materialized Platform | Gold/Silver snapshot written as Parquet | Power BI and repeated dashboard refreshes |

## Phase 0: Account And Console Setup

Goal: Each member can log in and open the right Athena environment.

Steps:

1. Go to:

   ```text
   https://688717565427.signin.aws.amazon.com/console
   ```

2. Use the AWS account ID:

   ```text
   688717565427
   ```

3. Use your own UST email as the IAM username.
4. Enter your temporary password.
5. Set your new password when AWS asks.
6. Change the AWS region to:

   ```text
   ap-southeast-2
   ```

7. Open Athena.
8. Select this workgroup:

   ```text
   api-center-platform-validation-prod
   ```

Done when:

- You can open Athena.
- You can see databases such as `gold_platform`, `common_silver`, and
  `materialized_platform`.
- You can run a small bounded query without an access denied error.

## Phase 1: Start From Gold, Not Raw

Goal: Confirm the current platform Gold layer can answer the first part of the
north-star question: what happened, by tribe, service, event type, and day.

Use this query pattern:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  event_day,
  event_count,
  latest_occurred_at,
  latest_ingested_at
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY event_day DESC, tribe_id, source_service_id, event_type
LIMIT 100;
```

What to look for:

- `tribe_id` identifies the owning tribe.
- `source_service_id` identifies the producing service.
- `event_type` identifies what business or platform event happened.
- `event_count` shows volume for that day.
- `latest_occurred_at` and `latest_ingested_at` show freshness.

Do not run:

```sql
SELECT *
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod';
```

That query is too broad because Gold is currently a view over Silver, Bronze,
and raw S3 partitions.

Deliverable:

```text
List of visible prod tribes, source services, event types, and event counts for the selected date.
```

## Phase 2: Validate The Event-Level Mapping In Common Silver

Goal: Prove that Gold metrics can be traced back to governed event rows.

Use Common Silver when we need event-level detail:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  schema_validation_status,
  occurred_at,
  ingested_at,
  year,
  month,
  day,
  hour
FROM common_silver.tribe_event_envelope
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY tribe_id, source_service_id, event_type, occurred_at
LIMIT 100;
```

What to check:

- The same `tribe_id` values from Gold exist in Common Silver.
- The same `source_service_id` values from Gold exist in Common Silver.
- The same `event_type` values from Gold exist in Common Silver.
- `schema_validation_status` is understandable.
- `occurred_at` and `ingested_at` make sense for the selected day.

Deliverable:

```text
Mapping table: tribe_id -> source_service_id -> event_type -> sample event timestamp.
```

## Phase 3: Use Raw S3 Only To Prove Landing

Goal: Prove that data landed in the raw topic folder when there is a specific
debugging or traceability question.

Raw S3 is not the dashboard source. It still contains `raw_line` because it is
the exact exported record from the S3 Sink.

Use raw only with topic and date filters:

```sql
SELECT
  physical_topic,
  year,
  month,
  day,
  hour,
  COUNT(*) AS raw_record_count
FROM api_center_raw.topic_records
WHERE physical_topic = 'prod.tribe.logistics.events'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
GROUP BY 1, 2, 3, 4, 5
ORDER BY hour;
```

Use this only when we need to answer:

- Did the S3 Sink write records for this topic?
- Which hour did the records land?
- Does raw volume roughly match Silver/Gold volume?

Deliverable:

```text
Evidence that the selected topic has raw records for the selected date and hour range.
```

## Phase 4: Check Quality And Governance Metrics

Goal: Answer whether APICenter accepted, rejected, allowed, denied, or flagged
records.

Quality:

```sql
SELECT *
FROM gold_platform.event_quality_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY event_day DESC
LIMIT 100;
```

Gateway decisions:

```sql
SELECT *
FROM gold_platform.gateway_decision_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY event_day DESC
LIMIT 100;
```

Shared-service usage:

```sql
SELECT *
FROM gold_platform.shared_service_usage_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY event_day DESC
LIMIT 100;
```

What to check:

- Are there invalid or rejected records?
- Are gateway denials visible?
- Are shared-service failures visible?
- Are the metrics grouped by the right platform dimensions?

Deliverable:

```text
Quality and governance summary for the selected production date.
```

## Phase 5: Decide Whether BI Should Use Gold View Or Materialized Table

Goal: Decide whether Power BI can query Gold directly or needs a materialized
snapshot.

Use direct Gold queries when:

- the query is one-time or exploratory;
- the query is bounded to one day or a small date range;
- refresh speed is acceptable;
- the query scans a small amount of data.

Use `materialized_platform` when:

- the dashboard refreshes repeatedly;
- Power BI needs a stable source;
- broad scans are unavoidable;
- the Gold view is slow because it still reads raw-backed views;
- the same daily dataset will be reused by several people.

Decision rule:

```text
Exploration = Gold with strict filters.
Dashboard refresh = materialized_platform.
```

Deliverable:

```text
Decision record stating whether the first dashboard reads Gold directly or a materialized table.
```

## Phase 6: Materialize BI-Ready Tables When Needed

Goal: Create a fast Parquet-backed snapshot for Power BI.

This is an operator task. If you do not have CLI/operator access, ask the
platform owner to run it.

Preview first:

```powershell
cd C:\Codes\apic\api-center

.\scripts\data-pipeline\materialize-silver-gold.ps1 `
  -Dataset gold_platform.pipeline_health_daily `
  -Environment prod `
  -Year 2026 `
  -Month 05 `
  -Day 20 `
  -Workgroup api-center-materialization-prod `
  -Profile apic-admi `
  -DryRun
```

Execute after review:

```powershell
.\scripts\data-pipeline\materialize-silver-gold.ps1 `
  -Dataset gold_platform.pipeline_health_daily `
  -Environment prod `
  -Year 2026 `
  -Month 05 `
  -Day 20 `
  -Workgroup api-center-materialization-prod `
  -Profile apic-admi `
  -Wait
```

Expected table:

```text
materialized_platform.gold_platform_pipeline_health_daily_prod_20260520
```

Power BI/Athena query:

```sql
SELECT *
FROM materialized_platform.gold_platform_pipeline_health_daily_prod_20260520
ORDER BY event_day DESC, tribe_id, source_service_id, event_type;
```

Deliverable:

```text
Materialized table name, S3 curated path, row count, and source Gold query used.
```

## Phase 7: Build The First Power BI Model

Goal: Turn the governed data into a dashboard model that answers the north-star
question.

Recommended first dataset:

```text
materialized_platform.gold_platform_pipeline_health_daily_prod_YYYYMMDD
```

Minimum fields:

| Field | Use |
| --- | --- |
| `event_day` | Date axis |
| `environment` | Environment filter |
| `tribe_id` | Tribe owner filter |
| `source_service_id` | Service producer filter |
| `event_type` | Event category filter |
| `event_count` | Main volume measure |
| `latest_occurred_at` | Freshness signal |
| `latest_ingested_at` | Pipeline arrival signal |

Suggested visuals:

- Event count by tribe.
- Event count by event type.
- Event count by source service.
- Latest ingestion timestamp by tribe.
- Table of tribe, service, event type, event count, and latest timestamp.
- Filter slicers for environment, tribe, service, and event type.

Recommended first measures:

```text
Total Events = SUM(event_count)
Active Tribes = DISTINCTCOUNT(tribe_id)
Active Services = DISTINCTCOUNT(source_service_id)
Active Event Types = DISTINCTCOUNT(event_type)
```

Deliverable:

```text
Power BI dashboard page showing platform pipeline health for the selected production date.
```

## Phase 8: Add Governance And Reliability Pages

Goal: Expand from "what happened" to "was it allowed, valid, successful, and
healthy?"

Add pages in this order:

| Page | Source |
| --- | --- |
| Pipeline Health | `gold_platform.pipeline_health_daily` or materialized equivalent |
| Data Quality | `gold_platform.event_quality_daily` or materialized equivalent |
| Gateway Governance | `gold_platform.gateway_decision_daily` or materialized equivalent |
| Shared Services | `gold_platform.shared_service_usage_daily` or materialized equivalent |
| Query Cost | `gold_platform.athena_query_cost_daily` or materialized equivalent |

Each page should answer one plain question:

| Page | Question |
| --- | --- |
| Pipeline Health | Are tribes publishing events and are they arriving? |
| Data Quality | Are events valid and schema-governed? |
| Gateway Governance | What was allowed or denied? |
| Shared Services | Which shared services are used and are they succeeding? |
| Query Cost | Which queries are expensive and should be optimized or materialized? |

Deliverable:

```text
Dashboard pages mapped to Gold sources and north-star proof areas.
```

## Phase 9: Validate The Dashboard Against Athena

Goal: Make sure Power BI numbers match Athena.

For every visual, keep a matching Athena validation query.

Example:

```sql
SELECT
  tribe_id,
  SUM(event_count) AS total_events
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
GROUP BY tribe_id
ORDER BY total_events DESC;
```

Validation checklist:

- Power BI total equals Athena total.
- Tribe counts match.
- Service counts match.
- Event type counts match.
- The selected date is clear in the dashboard.
- Test data is not mixed into prod visuals.
- Raw S3 is not used as a dashboard source.

Deliverable:

```text
Validation notes with Athena query IDs and matching Power BI screenshots or exported values.
```

## Phase 10: Final Answer To The North-Star Question

Goal: Prepare the conclusion we can present.

Use this answer structure:

```text
For the selected production date, APICenter can trace events from tribe-owned
topics through governed Silver/Gold datasets into BI-ready outputs.

We can identify the owning tribe, source service, event type, event volume,
latest event time, and latest ingestion time.

For dashboard use, we do not rely on raw S3. We use Gold for governed metrics
and materialized_platform for repeatable Power BI refreshes.

Raw S3 remains available only as audit/debug evidence to prove records landed
from the S3 Sink.
```

Evidence to include:

- Gold query result.
- Common Silver sample.
- Optional raw S3 landing proof.
- Materialized table name if BI uses one.
- Power BI visual totals.
- Athena validation query IDs.
- Known gaps or missing metrics.

Deliverable:

```text
One-page final evidence summary answering the north-star question.
```

## Suggested Team Split

All four members have the same AWS access. The work can be split by outcome:

| Member | Suggested focus | Main deliverable |
| --- | --- | --- |
| Member 1 | Gold pipeline health | Tribe/service/event mapping and event counts |
| Member 2 | Silver and raw traceability | Evidence that Gold can be traced to event rows and raw landing |
| Member 3 | BI model and visuals | Power BI dataset, model, measures, and first dashboard page |
| Member 4 | Governance and validation | Quality/gateway/shared-service/cost checks and final evidence notes |

Even with this split, everyone should use the same rules:

- Gold first.
- Silver for event-level mapping.
- Raw only for landing proof.
- Materialized Platform for repeatable BI.
- Always use environment and date filters.

## Common Mistakes To Avoid

Do not:

- connect Power BI to raw S3;
- run `SELECT *` against Gold without date filters;
- treat `LIMIT 50` as a performance fix;
- mix test and prod data in one visual;
- use a personal IAM user as a scheduled refresh service account;
- manually download CSV files as the normal BI pipeline;
- change Glue tables, S3 folders, IAM, or Athena workgroups from member accounts.

## Quick Reference Queries

Daily pipeline health:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  event_day,
  event_count,
  latest_occurred_at,
  latest_ingested_at
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY event_day DESC, tribe_id, source_service_id, event_type
LIMIT 100;
```

Daily totals by tribe:

```sql
SELECT
  tribe_id,
  SUM(event_count) AS total_events
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
GROUP BY tribe_id
ORDER BY total_events DESC;
```

Event-level sample:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  occurred_at,
  ingested_at
FROM common_silver.tribe_event_envelope
WHERE environment = 'prod'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
ORDER BY tribe_id, source_service_id, event_type
LIMIT 100;
```

Raw landing proof:

```sql
SELECT
  physical_topic,
  year,
  month,
  day,
  hour,
  COUNT(*) AS raw_record_count
FROM api_center_raw.topic_records
WHERE physical_topic = 'prod.tribe.logistics.events'
  AND year = '2026'
  AND month = '05'
  AND day = '20'
GROUP BY 1, 2, 3, 4, 5
ORDER BY hour;
```

Materialized table read:

```sql
SELECT *
FROM materialized_platform.gold_platform_pipeline_health_daily_prod_20260520
ORDER BY event_day DESC, tribe_id, source_service_id, event_type;
```

## Final Success Criteria

We are done when we can say:

```text
The platform team can answer the north-star question from governed Gold and
materialized data, with traceability back to Silver and optional raw landing
proof, without using raw S3 as the BI source.
```
