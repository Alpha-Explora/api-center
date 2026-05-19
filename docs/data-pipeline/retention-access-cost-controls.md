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

## Read Access

| Layer | Default access |
| --- | --- |
| Raw S3 | Platform data operators only |
| Bronze | Platform data operators and controlled jobs |
| Common Silver | Platform plus approved tenant-filtered readers |
| Tribe Silver | Owning tribe plus platform data operators |
| Gold | Approved BI groups only |
| BI dashboards | Named groups with access review |

Approved access fields:

```text
approved_reader_groups:
last_access_review_at:
next_access_review_date:
data_owner:
data_steward:
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
