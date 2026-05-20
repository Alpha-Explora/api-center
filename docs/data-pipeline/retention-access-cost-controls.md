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
workgroup: primary during pilot; dedicated api-center-curated before broad BI use
bytes_scanned_limit: set before scheduled dashboard refresh
query_result_location:
  platform validation test: s3://api-center-raw-data/athena-results/platform/validation/test/
  platform validation prod: s3://api-center-raw-data/athena-results/platform/validation/prod/
  management test: s3://api-center-raw-data/athena-results/management/test/
  management prod: s3://api-center-raw-data/athena-results/management/prod/
  tribe results: s3://api-center-raw-data/athena-results/tribe/<tribe_id>/<environment>/
query_result_retention_days: 7-30
owner: platform-data-platform-owner
alert_threshold: notify on failed queries, repeated broad scans, and spend drift
```

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
| `api-center-platform-validation` | `s3://api-center-athena-results/platform/validation/<environment>/` | Platform data operators |
| `api-center-management` | `s3://api-center-athena-results/management/<environment>/` | Management service role/operators |
| `api-center-tribe-<tribe_id>` | `s3://api-center-athena-results/tribe/<tribe_id>/<environment>/` | Approved tribe readers |

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
