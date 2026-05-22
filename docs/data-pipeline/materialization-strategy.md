# Materialization Strategy

APICenter starts with governed Athena views because they are fast to evolve.
Materialization begins only when a curated dataset is stable enough and repeated
queries make raw/Bronze-backed scans wasteful.

## Decision Gate

Materialize a dataset when any condition is true:

| Trigger | Required evidence |
| --- | --- |
| Scheduled dashboard query | Dashboard owner, refresh cadence, and approved reader group. |
| Repeated broad scan | Athena query telemetry shows repeated scans above the approved workgroup threshold. |
| Broad partition reads | Query cannot stay bounded to one day or a small date range. |
| BI stable extract required | BI group needs a stable Parquet handoff rather than direct Gold view reads. |
| Production-facing tribe metric | Data owner and steward approve the metric dictionary row. |

Do not materialize raw S3 directly for BI. Materialized outputs must come from
Common Silver, Tribe Silver, or Gold sources that preserve `environment`,
`tribe_id`, and `source_service_id` where applicable.

For `common_silver.tribe_event_envelope`, platform operators may create a
cross-tribe central snapshot. Tribe-facing exports must pass `-TribeId` so the
CTAS output is filtered and written under a tribe-scoped curated prefix.

## First Candidates

| Dataset | Layer | Why |
| --- | --- | --- |
| `common_silver.tribe_event_envelope` | Silver | Shared governed envelope for high-volume tribe events. |
| `gold_platform.pipeline_health_daily` | Gold | Main platform health dashboard. |
| `gold_platform.event_quality_daily` | Gold | Quality gate and schema-fix workflow input. |
| `gold_platform.shared_service_usage_daily` | Gold | Shared-service chargeback and adoption dashboards. |
| `gold_platform.gateway_decision_daily` | Gold | Gateway allow/deny governance review. |
| `gold_platform.athena_query_cost_daily` | Gold | Query-cost telemetry and materialization trigger evidence. |

## Output Layout

Materialized outputs use the curated-data bucket, not the raw topic bucket:

```text
s3://api-center-curated-data/<layer>/<dataset>/environment=<env>/year=YYYY/month=MM/day=DD/
```

Examples:

```text
s3://api-center-curated-data/gold/platform/pipeline_health_daily/environment=prod/year=2026/month=05/day=20/
s3://api-center-curated-data/silver/common_silver/tribe_event_envelope/environment=test/year=2026/month=05/day=20/
s3://api-center-curated-data/silver/common_silver/tribe_event_envelope/tribe_id=logistics/environment=prod/year=2026/month=05/day=20/
```

Athena snapshot tables live in `materialized_platform` and are named with the
source dataset, environment, and day:

```text
materialized_platform.gold_platform_pipeline_health_daily_prod_20260520
```

## Workgroup

Materialization uses a dedicated Athena workgroup:

```text
api-center-materialization-test
api-center-materialization-prod
```

This workgroup keeps bytes-scanned limits and managed query result output, but
does not enforce the workgroup result location. Athena CTAS requires that
freedom so the query can write Parquet into the approved
`api-center-curated-data` external location. Do not run CTAS in
`api-center-platform-validation-*`; those workgroups intentionally enforce
centralized output and reject CTAS `external_location`.

## Operator Flow

Preview first:

```powershell
.\scripts\data-pipeline\materialize-silver-gold.ps1 `
  -Dataset gold_platform.pipeline_health_daily `
  -Environment test `
  -Year 2026 `
  -Month 05 `
  -Day 20 `
  -Workgroup api-center-materialization-test `
  -Profile apic-admi `
  -DryRun
```

Execute only after the dry-run SQL is reviewed:

```powershell
.\scripts\data-pipeline\materialize-silver-gold.ps1 `
  -Dataset gold_platform.pipeline_health_daily `
  -Environment test `
  -Year 2026 `
  -Month 05 `
  -Day 20 `
  -Workgroup api-center-materialization-test `
  -Profile apic-admi `
  -Wait
```

Use `-Replace` only for a controlled rerun of the same
dataset/environment/day. `-Replace` requires `-ConfirmReplaceCleanup` because
Athena CTAS expects an empty external location. The script deletes existing
objects under the target curated prefix before recreating the table. Normal
production materialization should create a new day snapshot instead of rewriting
prior evidence.

Tribe-scoped Common Silver example:

```powershell
.\scripts\data-pipeline\materialize-silver-gold.ps1 `
  -Dataset common_silver.tribe_event_envelope `
  -TribeId logistics `
  -Environment prod `
  -Year 2026 `
  -Month 05 `
  -Day 20 `
  -Workgroup api-center-materialization-prod `
  -Profile apic-admi `
  -DryRun
```

## Validation

Before materialization:

```text
quality gate passed
source query bounded by environment/year/month/day
workgroup bytes-scanned limit enabled
approved reader group recorded
retention class selected
```

After materialization:

```text
target table exists in materialized_platform
external location is under api-center-curated-data
row count matches the bounded source query
tribe-facing Common Silver materialization includes a tribe_id filter
no raw S3 paths are exposed to BI users
dataset is listed in the metric dictionary or platform runbook
```

## Retention

| Layer | Default |
| --- | --- |
| Bronze materialized | 365 days unless exception. |
| Common Silver materialized | 365 days for prod, 30-90 days for test. |
| Tribe Silver materialized | Tribe-owned retention with platform approval. |
| Gold materialized | Metric-specific, approved by owner/steward. |
| Athena query results | 7-30 days in the dedicated results bucket. |

Materialized Parquet is an optimization and BI handoff layer. Raw S3 remains
the replay/audit source, but dashboards should not query Raw directly.
