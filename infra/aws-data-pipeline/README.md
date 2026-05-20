# APICenter AWS Data Pipeline

This folder contains the first production-leaning analytics pipeline after
Confluent S3 Sink.

Execution order:

1. Validate S3 object arrival with `scripts/data-pipeline/validate-s3-prefix.ps1`.
2. Create or update Glue/Athena raw catalog objects from `catalog/raw-topic-tables.sql`.
3. Run `queries/validate-raw-topic.sql`.
4. Create Bronze from `catalog/bronze-tribe-events.sql`.
5. Create Common Silver from `catalog/common-silver-events.sql`.
6. Create Gold metrics after approval from `catalog/gold-platform-health.sql`.

Required environment:

```text
AWS_PROFILE
ATHENA_WORKGROUP
ATHENA_DATABASE
ATHENA_RESULTS_BUCKET
ATHENA_OUTPUT_LOCATION
API_CENTER_RAW_BUCKET
```

Current test defaults:

```text
AWS_PROFILE=apic
ATHENA_WORKGROUP=primary
ATHENA_DATABASE=api_center_raw
ATHENA_RESULTS_BUCKET=api-center-raw-data
ATHENA_OUTPUT_LOCATION is optional when using scripts/data-pipeline/run-athena-query.ps1.
Default output is resolved from ResultPurpose and Environment, for example:
s3://api-center-raw-data/athena-results/platform/validation/test/
API_CENTER_RAW_BUCKET=api-center-raw-data
```

Raw S3 is not a BI source. Production dashboards must read curated Silver or
Gold outputs.

## Observed Raw Layout

The current Confluent S3 Sink writes records under this layout:

```text
s3://api-center-raw-data/topics/<physical_topic>/year=YYYY/month=MM/day=DD/hour=HH/*.json
```

The observed test object contains line-delimited JSON string values, for example
a line starts with a quoted and escaped JSON event body. Bronze views must unwrap
the string value before extracting event fields.

`api_center_raw.topic_records` uses Athena partition projection. The
`physical_topic` projection is an enum of approved exported topics so curated
views can scan across lanes. When a late-provisioned topic is added to the S3
Sink, update `projection.physical_topic.values` with the same physical topic.

Queries against projected raw or Bronze views must include bounded time
partition filters (`year`, `month`, `day`, and preferably `hour`) unless the
caller intentionally wants a broad scan. Unbounded cross-topic scans can be slow
and expensive because Athena enumerates projected partition combinations.
