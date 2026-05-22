# Athena Results Runbook

Athena query results are not raw lake data. They are query artifacts and may
contain filtered tribe or BI-visible rows. Keep them separated by purpose,
environment, and tribe where needed.

## Prefixes

| Purpose | Output prefix |
| --- | --- |
| Test platform validation | `s3://api-center-athena-results/athena-results/platform/validation/test/` |
| Prod platform validation | `s3://api-center-athena-results/athena-results/platform/validation/prod/` |
| Test platform materialization | `s3://api-center-athena-results/athena-results/platform/materialization/test/` |
| Prod platform materialization | `s3://api-center-athena-results/athena-results/platform/materialization/prod/` |
| Test management UI/API | `s3://api-center-athena-results/athena-results/management/test/` |
| Prod management UI/API | `s3://api-center-athena-results/athena-results/management/prod/` |
| Test tribe-facing result | `s3://api-center-athena-results/athena-results/tribe/<tribe_id>/test/` |
| Prod tribe-facing result | `s3://api-center-athena-results/athena-results/tribe/<tribe_id>/prod/` |
| Legacy quarantine | `s3://api-center-athena-results/athena-results/legacy-unclassified/<yyyy-mm-dd>/` |

Before broad BI or tribe access, use the dedicated result bucket:

```text
s3://api-center-athena-results/
```

Set `ATHENA_RESULTS_BUCKET=api-center-athena-results` before running managed
validation or dashboard queries. The raw bucket is a historical pilot fallback
only and must not be used for BI or tribe-facing result access.

## Rules

- Raw S3 stays under `topics/`; do not move Confluent raw output for this change.
- Platform validation results are platform-operator artifacts.
- Management results are management/API artifacts.
- Tribe result prefixes require a `tribe_id`.
- Production dashboard queries must use `environment = 'prod'`.
- Query result lifecycle should be shorter than raw data lifecycle.
- Do not grant BI users access to `s3://api-center-raw-data/topics/`.

## Commands

Use the resolver:

```powershell
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose platform-validation -Environment test
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose platform-materialization -Environment test
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose management -Environment prod
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose tribe -Environment prod -TribeId logistics
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose management -Environment test -ResultsBucket api-center-athena-results
```

Use the query runner without `-OutputLocation`:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\pipeline-health-daily.sql `
  -Database gold_platform `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Environment test `
  -ResultPurpose platform-validation `
  -Parameters @{ environment = "test"; year = "2026"; month = "05"; day = "20" } `
  -Wait
```

## Lifecycle Policy

Review the policy before applying it:

```powershell
Get-Content .\infra\aws-data-pipeline\policies\athena-results-lifecycle.json
```

Apply only after confirming the bucket has no conflicting lifecycle rules:

```powershell
aws s3api put-bucket-lifecycle-configuration `
  --bucket api-center-athena-results `
  --lifecycle-configuration file://infra/aws-data-pipeline/policies/athena-results-lifecycle.json `
  --profile apic
```

## Cleanup

Always run inventory first:

```powershell
.\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket api-center-athena-results -Profile apic
```

Run dry-run cleanup:

```powershell
.\scripts\data-pipeline\cleanup-athena-results.ps1 -Bucket api-center-athena-results -Profile apic -OlderThanDays 7
```

Move old flat files to legacy quarantine only after reviewing dry-run output:

```powershell
.\scripts\data-pipeline\cleanup-athena-results.ps1 `
  -Bucket api-center-athena-results `
  -Profile apic `
  -OlderThanDays 7 `
  -MoveToLegacy `
  -ConfirmCleanup
```

Use `-Delete -ConfirmCleanup` only after lifecycle policy and retention have
been approved.

## Dedicated Results Bucket Gate

Before granting tribe or BI access to Athena result artifacts, create or approve:

```text
bucket: api-center-athena-results
platform_validation_test_workgroup: api-center-platform-validation-test
platform_validation_prod_workgroup: api-center-platform-validation-prod
platform_materialization_test_workgroup: api-center-materialization-test
platform_materialization_prod_workgroup: api-center-materialization-prod
management_test_workgroup: api-center-management-test
management_prod_workgroup: api-center-management-prod
tribe_reader_test_workgroup: api-center-tribe-<tribe_id>-test
tribe_reader_prod_workgroup: api-center-tribe-<tribe_id>-prod
raw_bucket_access_for_bi: false
result_bucket_lifecycle_days: 7-30
prod_result_prefix: s3://api-center-athena-results/athena-results/management/prod/
tribe_result_prefix: s3://api-center-athena-results/athena-results/tribe/<tribe_id>/prod/
```

Keep `api-center-raw-data` platform-only. Do not use raw bucket permissions to
grant dashboard access.

Preview the dedicated bucket/workgroup plan without making AWS changes:

```powershell
.\scripts\data-pipeline\provision-athena-results-controls.ps1 `
  -Environment test `
  -TribeId codex-sdk-20260520041053 `
  -DryRun
```

The provisioner creates bucket controls and workgroups. The result-reader policy
template is reviewed and attached separately to approved reader roles; it is not
applied as part of this script.
