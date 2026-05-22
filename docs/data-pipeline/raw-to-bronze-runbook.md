# Raw To Bronze Runbook

This runbook defines how platform operators promote Confluent S3 Sink output to
the shared Bronze layer.

## Raw Contract

Raw S3 path:

```text
s3://api-center-raw-data/topics/<physical-topic-name>/...
```

Examples:

```text
s3://api-center-raw-data/topics/test.tribe.logistics.events/
s3://api-center-raw-data/topics/prod.tribe.logistics.events/
s3://api-center-raw-data/topics/prod.api-center.shared.payment.events/
```

Raw is replay storage. BI tools must not use raw S3 directly for production
dashboards.

## Observed Raw File Format

The current Confluent S3 Sink writes line-delimited JSON string values under
hour partitions:

```text
s3://api-center-raw-data/topics/<physical-topic-name>/year=YYYY/month=MM/day=DD/hour=HH/*.json
```

Each line is a JSON string containing the event JSON body, for example:

```text
"{\"sourceServiceId\":\"codex-sdk-20260520041053-api\", ... }"
```

Bronze must unwrap the string value before extracting event fields:

```sql
COALESCE(json_extract_scalar(raw_line, '$'), raw_line)
```

## Metadata Refresh

The crawler or metadata refresh must cover the shared raw root:

```text
s3://api-center-raw-data/topics/
```

New topic folders must be picked up by crawler or registry refresh, not by code
changes. Record:

```text
physical_topic
s3_prefix
glue_database
glue_table
refresh_started_at
refresh_finished_at
object_count
latest_object_at
```

## Bronze Ingestion Rule

Bronze reads from the shared raw root or a configurable topic registry:

```text
bronze.tribe_events reads s3://api-center-raw-data/topics/*/
```

Do not compile a fixed list of tribe topics into the job. Late-provisioned
topics must be included through topic state/configuration.

## Bronze Lanes

The raw root feeds three approved Bronze lanes:

| Bronze view | Topic pattern |
| --- | --- |
| `bronze.tribe_events` | `<env>.tribe.<ownerTribeId>.events` |
| `bronze.shared_service_events` | `<env>.api-center.shared.<serviceId>.events` |
| `bronze.apicenter_ops_events` | Current `<env>.api-center.<stream>` topics such as `<env>.api-center.gateway.request`, plus legacy `<env>.api-center.ops.<stream>.events` if present |

APICenter request/response, audit, auth, registry, external, and system topics
are platform-owned ops streams. They are included only when the physical topic
is explicitly present in `infra/aws-data-pipeline/topic-projection-values.txt`.

Because raw topics use Athena partition projection, validation and dashboard
queries must include bounded partition filters:

```sql
WHERE year = '2026'
  AND month = '05'
  AND day = '20'
  AND hour = '09'
```

Use broader scans only when the Athena workgroup limit and expected cost are
explicitly acceptable.

If an operator passes `-OutputLocation`, that explicit path wins. Use explicit
paths only for break-glass diagnostics or migration testing. Normal validation
uses `-ResultPurpose` and `-Environment`.

## Required Bronze Columns

```text
source_topic
source_system
environment
source_file
source_partition
ingested_at
event_date
raw_record
event_id_or_key
event_type
tribe_id
source_service_id
schema_version
quality_status
quality_error
```

Derivation rules:

| Column | Rule |
| --- | --- |
| `source_topic` | Use the partition-projected `physical_topic` under `topics/`. |
| `environment` | Parse prefix such as `test` or `prod`. |
| `tribe_id` | Parse `tribe.<ownerTribeId>.events` or use governance metadata. |
| `source_service_id` | Use governance `sourceServiceId` when present. |
| `event_type` | Use SDK `eventType`. |
| `event_date` | Date from payload `occurredAt`; otherwise ingestion date with quality flag. |
| `raw_record` | Preserve the original line, including the escaped JSON string if that is what S3 stored. |

Malformed records are quarantined or marked with `quality_status`, not allowed
to fail the whole job.

## Test And Prod Filtering

Production Bronze and downstream production dashboards must filter to:

```sql
environment = 'prod'
```

Test topics such as `test.tribe.<ownerTribeId>.events` may be available for
validation but must not appear in production Silver, Gold, or BI outputs.

## Athena Validation Query

```sql
SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  COUNT(*) AS record_count,
  MAX(event_date) AS latest_event_date
FROM bronze.tribe_events
WHERE source_topic = '$physical_topic'
GROUP BY 1, 2, 3, 4;
```

Run validation through the governed result prefix resolver:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-bronze-topic.sql `
  -Database bronze `
  -Workgroup primary `
  -Profile apic `
  -Environment test `
  -ResultPurpose platform-validation `
  -Parameters @{ physical_topic = "<environment>.tribe.<ownerTribeId>.events" } `
  -Wait
```

## Bronze Evidence

```text
physical_topic:
bronze_table:
latest_bronze_observed_at:
latest_bronze_count:
environment_filter:
source_service_id_present:
quality_error_count:
evidence_link:
```

## Databricks Free Edition Boundary

Databricks Free Edition may validate a prototype notebook or sample Bronze
table. It is not the production shared tribe analytics platform. Production
reporting needs a production-grade transform layer: paid Databricks, or an
AWS-native path such as Glue/Athena/PowerBI over curated tables.
