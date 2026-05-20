# Actual Data Pipeline Runbook

## Raw S3 Evidence

Record this for every topic before cataloging:

```text
owner_tribe_id:
source_service_ids:
environment:
physical_topic:
s3_prefix:
latest_s3_object_key:
latest_s3_object_at:
object_count:
validator_command:
validator_output_link:
operator:
checked_at:
```

Do not mark a topic `Raw observed` until at least one object appears under the
exact physical topic prefix.

## Initial Test Evidence, 2026-05-20

```text
owner_tribe_id: codex-sdk-20260520041053
source_service_ids: codex-sdk-20260520041053-api
environment: test
physical_topic: test.tribe.codex-sdk-20260520041053.events
s3_prefix: s3://api-center-raw-data/topics/test.tribe.codex-sdk-20260520041053.events/
latest_s3_object_key: topics/test.tribe.codex-sdk-20260520041053.events/year=2026/month=05/day=20/hour=09/test.tribe.codex-sdk-20260520041053.events+0+0000000001.json
latest_s3_object_at: 2026-05-20T09:41:51+00:00
object_count: 2
validator_command: .\scripts\data-pipeline\validate-s3-prefix.ps1 -Bucket api-center-raw-data -PhysicalTopic test.tribe.codex-sdk-20260520041053.events -Profile apic
operator: codex
checked_at: 2026-05-20T09:42:00Z
```

Notes:

- `api-center-test-s3-sink` did not initially include the temporary SDK smoke topic.
- The connector config was updated to include `test.tribe.codex-sdk-20260520041053.events`.
- Connector status after update: connector `RUNNING`, task `0:RUNNING`.
- The connector uses `flush.size=1000` and `time.interval=HOURLY`; a 1000-record flush run was produced to the test topic.
- The sampled S3 object is line-delimited JSON string values. Bronze parsing must unwrap the JSON string before extracting event fields.

## Operating Guardrails

Before a topic is promoted from validation to scheduled dashboard or BI use,
record these controls:

```text
workgroup:
bytes_scanned_limit:
query_result_location:
query_result_retention_days:
raw_test_retention_days:
raw_prod_retention_days:
bronze_retention_days:
curated_retention_days:
raw_s3_readers:
bronze_readers:
common_silver_readers:
tribe_silver_readers:
gold_readers:
owner:
alert_threshold:
```

Required defaults:

| Control | Default |
| --- | --- |
| Raw S3 | Platform data operators only. |
| Bronze | Platform data operators and controlled jobs. |
| Common Silver | Approved tenant-filtered readers only. |
| Tribe Silver | Owning tribe plus platform data operators. |
| Gold | Approved BI groups. |
| Test raw retention | `30-90` days. |
| Prod raw retention | `180-365` days. |
| Bronze retention | `365` days. |
| Curated retention | Metric-specific. |

Do not connect a production dashboard directly to Raw S3. Production dashboards
must read approved Gold or Tribe Silver outputs with an `environment = 'prod'`
filter.
