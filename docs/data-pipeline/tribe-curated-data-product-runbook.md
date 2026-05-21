# Tribe Curated Data Product Runbook

Date: 2026-05-21

Status: dry-run generator implemented. Live Athena apply remains an operator-reviewed step.

## Purpose

This runbook creates repeatable Tribe Silver and Tribe Gold SQL from the common APICenter event envelope.

It exists so each tribe can get curated data products without rewriting the raw, Bronze, or Common Silver pipeline.

## Required Inputs

```text
tribe_id
environment
domain_event_type
metric_name
owner
steward
approved_reader_group
year
month
day
```

`year`, `month`, and `day` are for the generated validation query. They must point at a bounded partition with known data.

## Dry-Run Generation

Example:

```powershell
.\scripts\data-pipeline\generate-tribe-curated-sql.ps1 `
  -TribeId logistics `
  -Environment test `
  -EventType order.created `
  -MetricName order_created_daily `
  -Owner logistics-platform `
  -Steward logistics-data-steward `
  -ApprovedReaderGroup logistics-bi-readers `
  -Year 2026 `
  -Month 05 `
  -Day 21 `
  -DryRun
```

The command prints JSON with:

```text
metadata
silver_sql
gold_sql
validation_sql
```

The generated objects for the example are:

```text
silver_logistics.order_created
gold_logistics.order_created_daily
```

## Approval Metadata

Every generated SQL block includes:

```text
owner
steward
approved_reader_group
environment
tribe_id
domain_event_type
source common_silver view
```

This metadata ties a data product to an accountable owner, a steward, and a permitted reader group.

## Silver Output

The Silver view reads from:

```text
common_silver.tribe_event_envelope
```

It filters by:

```text
environment
tribe_id
event_type
```

It carries schema governance evidence forward:

```text
schema_version
schema_validation_status
schema_registry_version
schema_validation_error
```

## Gold Output

The generated Gold view starts with a basic daily event volume metric:

```text
metric_day
environment
tribe_id
event_type
event_count
source_service_count
first_occurred_at
latest_occurred_at
latest_ingested_at
```

The first metric is intentionally simple. More specific tribe metrics should be added only after the metric dictionary records the business definition, formula, owner, and approved reader groups.

## Validation Query

The generated validation SQL must remain bounded:

```text
environment
tribe_id
event_type
year
month
day
```

Do not use broad scans for routine validation. The raw and Bronze layers use partition projection, so broad unbounded queries can enumerate too many partitions.

## Pilot Test Dry-Run

Use the current test pilot event:

```powershell
.\scripts\data-pipeline\generate-tribe-curated-sql.ps1 `
  -TribeId codex-sdk-20260520041053 `
  -Environment test `
  -EventType codex.pipeline.flush `
  -MetricName pipeline_flush_daily `
  -Owner api-center-platform `
  -Steward api-center-data-steward `
  -ApprovedReaderGroup api-center-platform-validation-readers `
  -Year 2026 `
  -Month 05 `
  -Day 20 `
  -DryRun
```

Expected object names:

```text
silver_codex_sdk_20260520041053.codex_pipeline_flush
gold_codex_sdk_20260520041053.pipeline_flush_daily
```

## Live Apply Gate

The generator does not apply SQL to Athena. Before applying generated SQL:

1. Confirm event schema approval status for the target environment.
2. Confirm the metric dictionary row exists.
3. Confirm the tribe data governance checklist is complete.
4. Review generated SQL for the correct owner, steward, reader group, and environment.
5. Apply only through the approved Athena workgroup and result prefix.
6. Run the generated bounded validation query and record the query id.

Production data products require `environment = 'prod'`, approved production schemas, and approved reader groups. Test dry-run evidence does not approve production dashboards.
