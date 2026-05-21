# APICenter AWS Data Pipeline

This folder contains the first production-leaning analytics pipeline after
Confluent S3 Sink.

Execution order:

1. Validate S3 object arrival with `scripts/data-pipeline/validate-s3-prefix.ps1`.
2. Confirm the physical topic exists in `topic-projection-values.txt`.
3. Run `scripts/data-pipeline/check-topic-projection-drift.ps1` for the
   expected physical topic.
4. Generate `projection.physical_topic.values` with
   `scripts/data-pipeline/resolve-athena-topic-projection.js`.
5. Create or update Glue/Athena catalog objects in this order:
   raw topic table, Bronze tribe events, Bronze shared-service events, Bronze
   APICenter ops events, Common Silver, event schema registry, Gold platform
   health, shared-service Gold views, governance Gold views, and deterministic
   decision-signal Gold views.
6. Run `queries/validate-raw-topic.sql`.
7. Run `queries/validate-quality-thresholds.sql` through a bounded workgroup.
8. Query `queries/decision-signals-daily.sql` only after
   `gold_platform.decision_signals_daily` is applied.
9. Generate Tribe Silver/Gold SQL with
   `scripts/data-pipeline/generate-tribe-curated-sql.ps1 -DryRun` only after
   event semantics, schema status, and reader groups are approved.

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
ATHENA_WORKGROUP=api-center-platform-validation-test
ATHENA_DATABASE=api_center_raw
ATHENA_RESULTS_BUCKET=api-center-athena-results
ATHENA_OUTPUT_LOCATION is optional when using scripts/data-pipeline/run-athena-query.ps1.
Default output is resolved from ResultPurpose and Environment, for example:
s3://api-center-athena-results/athena-results/platform/validation/test/
API_CENTER_RAW_BUCKET=api-center-raw-data
```

Preview the ordered catalog apply without mutating Athena:

```powershell
.\scripts\data-pipeline\apply-athena-catalog.ps1 `
  -Environment test `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -DryRun
```

Raw S3 is not a BI source. Production dashboards must read curated Silver or
Gold outputs.

## Materialized Curated Outputs

Use materialization only after the view is stable or query telemetry proves the
view is too expensive to scan repeatedly. The dry-run entrypoint is:

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

The target layout is:

```text
s3://api-center-curated-data/<layer>/<dataset>/environment=<env>/year=YYYY/month=MM/day=DD/
```

See `docs/data-pipeline/materialization-strategy.md` before executing CTAS.
Use `-TribeId` for tribe-facing Common Silver materialization. Use `-Replace`
only with `-ConfirmReplaceCleanup` after reviewing the target curated prefix.

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
Sink, add it to `topic-projection-values.txt`, regenerate the comma-separated
enum, and update `projection.physical_topic.values` with the same physical topic.

Check projection drift before catalog apply:

```powershell
.\scripts\data-pipeline\check-topic-projection-drift.ps1 `
  -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt `
  -ExpectedTopic test.tribe.logistics.events
```

The CI-safe offline equivalent is:

```powershell
npm run check:data-pipeline-projection
```

When Confluent env vars are present, the PowerShell command also compares live
connector or Kafka REST topics against the projection file. Without credentials,
it still validates the tracked file and raw Athena SQL.

Queries against projected raw or Bronze views must include bounded time
partition filters (`year`, `month`, `day`, and preferably `hour`) unless the
caller intentionally wants a broad scan. Unbounded cross-topic scans can be slow
and expensive because Athena enumerates projected partition combinations.

Before scheduled dashboard refreshes, run catalog and quality validation in an
Athena workgroup with a bytes-scanned limit and a governed result location.

## Dedicated Athena Results Provisioning

Preview the dedicated result bucket and workgroups:

```powershell
.\scripts\data-pipeline\provision-athena-results-controls.ps1 `
  -Environment test `
  -TribeId codex-sdk-20260520041053 `
  -Profile apic `
  -DryRun
```

Apply only with a profile that has the permissions in
`infra/aws-data-pipeline/policies/athena-results-provisioner-policy.json`:

```powershell
.\scripts\data-pipeline\provision-athena-results-controls.ps1 `
  -Environment test `
  -TribeId codex-sdk-20260520041053 `
  -Profile apic-admi `
  -Apply
```

The target workgroups are environment-specific:

```text
api-center-platform-validation-test
api-center-platform-validation-prod
api-center-materialization-test
api-center-materialization-prod
api-center-management-test
api-center-management-prod
api-center-tribe-<tribe_id>-test
api-center-tribe-<tribe_id>-prod
```

Legacy workgroups without the environment suffix are retired. New catalog,
validation, management, and tribe-reader commands must use the
environment-specific names.

The validator role also needs
`infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json`
before it can read workgroups, run bounded Athena validation, or apply
materialized-table DDL in `materialized_platform`. Source databases such as
`api_center_raw`, `common_silver`, `governance`, and `gold_platform` stay
read-only for this role.

The deployed API Center runtime should not use the validator/admin profile.
Create a dedicated IAM user or role such as `api-center-athena-reader-gke` and
attach `infra/aws-data-pipeline/policies/api-center-athena-runtime-policy.json`.
That runtime policy can execute bounded Athena queries in the test/prod platform
validation workgroups, read Glue metadata needed by curated Gold views, read the
underlying raw S3 objects through Athena, and write only to platform-validation
Athena result prefixes. It must not delete result evidence; cleanup remains an
operator/provisioner responsibility.
