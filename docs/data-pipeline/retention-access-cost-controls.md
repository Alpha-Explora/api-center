# Retention, Access, And Cost Controls

These controls keep the shared tribe analytics pipeline governed and affordable.

## Retention Defaults

| Layer | Test default | Prod default | Notes |
| --- | ---: | ---: | --- |
| Kafka topic | 7 days | 7 days | S3 is durable replay storage. |
| Raw S3 | 30-90 days | 180-365 days | Longer only with approval. |
| Bronze | 30-90 days | 365 days | Keep enough for replay/debugging. |
| Common Silver | 30-90 days | 365 days | Tenant-filtered access only. |
| Tribe Silver | Tribe decision | Tribe decision | Must match classification approval. |
| Gold | Tribe/platform decision | Tribe/platform decision | Keep metric history per business need. |

## S3 Lifecycle Targets

Raw S3 is the replay and audit source, but it is not the dashboard source. Apply
these lifecycle targets before onboarding many tribes:

```text
raw_test_retention_days: 30-90
raw_prod_retention_days: 180-365
bronze_retention_days: 365
curated_retention_days: metric-specific
```

| Prefix or layer | Target action |
| --- | --- |
| `topics/test.*` raw prefixes | Expire after the approved test retention window. |
| `topics/prod.*` raw prefixes | Retain through the approved production replay window. |
| Athena query results | Expire through the workgroup result bucket lifecycle rule. |
| Bronze and curated exports | Keep according to classification, metric approval, and access review. |

## Materialized Curated Outputs

Use `docs/data-pipeline/materialization-strategy.md` before creating any
materialized Silver or Gold output. Materialized datasets write to
`api-center-curated-data`, not to the raw topic bucket:

```text
s3://api-center-curated-data/<layer>/<dataset>/environment=<env>/year=YYYY/month=MM/day=DD/
```

Materialize only when a dashboard is scheduled, repeated query telemetry shows
broad or expensive scans, BI needs a stable extract, or a production-facing
tribe metric has owner/steward approval. The first operator entrypoint is:

```powershell
.\scripts\data-pipeline\materialize-silver-gold.ps1 -DryRun
```

Dry-run output must be reviewed before running CTAS. Production BI readers
should consume approved Gold views or curated Parquet under
`api-center-curated-data`; they must not read `api-center-raw-data/topics/*`.

## Read Access

| Layer | Default access | Enforcement |
| --- | --- | --- |
| Raw S3 | Platform data operators only | Bucket policy/IAM role; no BI principals. |
| Bronze | Platform data operators and controlled jobs | Athena/Glue grants for operators and jobs. |
| Common Silver | Approved tenant-filtered readers | Views must preserve `environment` and `tribe_id` filters. |
| Tribe Silver | Owning tribe plus platform data operators | Tribe-specific schema grants. |
| Gold | Approved BI groups | Metric dictionary approval plus BI group mapping. |
| BI dashboards | Named groups with access review | Dashboard/workspace permissions and review dates. |

Approved access fields:

```text
approved_reader_groups:
last_access_review_at:
next_access_review_date:
data_owner:
data_steward:
```

Access review defaults:

```text
raw_s3_readers: platform-data-operators
bronze_readers: platform-data-operators, controlled-pipeline-jobs
common_silver_readers: approved-tenant-filtered-readers
tribe_silver_readers: owning-tribe, platform-data-operators
gold_readers: approved-bi-groups
review_cadence: monthly during pilot, quarterly after stable production
```

## Cost Controls

| Control | Default |
| --- | --- |
| publish quota | Set per owner tribe before production. |
| max event size | Reject oversized events before Kafka publish. |
| topic partitions | Start with 1 partition; increase only for lag/throughput. |
| S3 Sink tasks | Start with 1 task; increase only when connector lag proves need. |
| Athena workgroup | Use workgroup limits and query result lifecycle cleanup. |
| Databricks job cluster | Use job clusters or serverless with auto-stop; no always-on warehouse by default. |
| BI refresh | Start daily or manual; raise after Production Metrics Approval. |
| alert thresholds | Alert on connector failure, publish failure, S3 flush lag, and query spend. |

## Athena Workgroup Guardrails

Every Athena validation, management-console query, and BI query must run through
an owned workgroup with scan limits and a managed result location.

```text
workgroup: environment-specific api-center-* workgroups before broad BI use
bytes_scanned_limit: set before scheduled dashboard refresh
query_result_location:
  platform validation test: s3://api-center-athena-results/athena-results/platform/validation/test/
  platform validation prod: s3://api-center-athena-results/athena-results/platform/validation/prod/
  platform materialization test: s3://api-center-athena-results/athena-results/platform/materialization/test/
  platform materialization prod: s3://api-center-athena-results/athena-results/platform/materialization/prod/
  management test: s3://api-center-athena-results/athena-results/management/test/
  management prod: s3://api-center-athena-results/athena-results/management/prod/
  tribe results: s3://api-center-athena-results/athena-results/tribe/<tribe_id>/<environment>/
query_result_retention_days: 7-30
owner: platform-data-platform-owner
alert_threshold: notify on failed queries, repeated broad scans, and spend drift
```

Quality gates must run before scheduled dashboard refresh:

```text
invalid_quality_count: 0
missing_tribe_id_count: 0
missing_source_service_id_count: 0
unexpected_environment_count: 0
```

Use `infra/aws-data-pipeline/queries/validate-quality-thresholds.sql` with
bounded `year`, `month`, and `day` parameters. If any threshold is non-zero,
pause the refresh and fix Bronze parsing or event publisher behavior first.

Operator rules:

- Use bounded `year`, `month`, `day`, and `hour` filters for raw or Bronze
  validation queries.
- Production dashboards read Gold or approved Tribe Silver, not Raw S3.
- Pause scheduled refreshes before changing raw partition projection or Bronze
  view logic.
- Treat repeated broad scans as an incident until the query is narrowed or the
  data is compacted.

## Athena Workgroup Split Target

| Workgroup | Output prefix | Readers |
| --- | --- | --- |
| `api-center-platform-validation-test` | `s3://api-center-athena-results/athena-results/platform/validation/test/` | Platform data operators |
| `api-center-platform-validation-prod` | `s3://api-center-athena-results/athena-results/platform/validation/prod/` | Platform data operators |
| `api-center-materialization-test` | `s3://api-center-athena-results/athena-results/platform/materialization/test/` | Platform data operators |
| `api-center-materialization-prod` | `s3://api-center-athena-results/athena-results/platform/materialization/prod/` | Platform data operators |
| `api-center-management-test` | `s3://api-center-athena-results/athena-results/management/test/` | Management service role/operators |
| `api-center-management-prod` | `s3://api-center-athena-results/athena-results/management/prod/` | Management service role/operators |
| `api-center-tribe-<tribe_id>-test` | `s3://api-center-athena-results/athena-results/tribe/<tribe_id>/test/` | Approved tribe readers |
| `api-center-tribe-<tribe_id>-prod` | `s3://api-center-athena-results/athena-results/tribe/<tribe_id>/prod/` | Approved tribe readers |

Legacy workgroups without the environment suffix are retired. New validation,
management, and tribe-reader work must use the environment-specific names.

## Operator Guardrails

- Keep Kafka retention short because Raw S3 is the archive.
- Partition and convert curated data to Parquet/Delta before broad Athena or BI
  use.
- Cap Athena bytes scanned per query through workgroups.
- Keep Databricks Free Edition in prototype mode only.
- Do not add a new connector per microservice. Microservices share the owner
  tribe topic and use `source_service_id`.
- Review spend monthly across GCP, Confluent, AWS, Databricks, and BI licenses.

## Monthly Review

```text
owner_tribe_id:
physical_topic:
monthly_event_count:
monthly_raw_gb:
athena_tb_scanned:
databricks_job_hours:
bi_refresh_count:
connector_lag_incidents:
budget_owner:
next_action:
```
