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
ATHENA_OUTPUT_LOCATION
API_CENTER_RAW_BUCKET
```

Current test defaults:

```text
AWS_PROFILE=apic
ATHENA_WORKGROUP=primary
ATHENA_DATABASE=api_center_raw
ATHENA_OUTPUT_LOCATION=s3://api-center-raw-data/athena-results/
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
