# Athena Results Runbook

Athena query results are not raw lake data. They are query artifacts and may
contain filtered tribe or BI-visible rows. Keep them separated by purpose,
environment, and tribe where needed.

## Prefixes

| Purpose | Output prefix |
| --- | --- |
| Test platform validation | `s3://api-center-raw-data/athena-results/platform/validation/test/` |
| Prod platform validation | `s3://api-center-raw-data/athena-results/platform/validation/prod/` |
| Test management UI/API | `s3://api-center-raw-data/athena-results/management/test/` |
| Prod management UI/API | `s3://api-center-raw-data/athena-results/management/prod/` |
| Test tribe-facing result | `s3://api-center-raw-data/athena-results/tribe/<tribe_id>/test/` |
| Prod tribe-facing result | `s3://api-center-raw-data/athena-results/tribe/<tribe_id>/prod/` |
| Legacy quarantine | `s3://api-center-raw-data/athena-results/legacy-unclassified/<yyyy-mm-dd>/` |

Before broad BI or tribe access, prefer a dedicated result bucket:

```text
s3://api-center-athena-results/
```

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
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose management -Environment prod
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose tribe -Environment prod -TribeId logistics
```

Use the query runner without `-OutputLocation`:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\pipeline-health-daily.sql `
  -Database gold_platform `
  -Workgroup primary `
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
  --bucket api-center-raw-data `
  --lifecycle-configuration file://infra/aws-data-pipeline/policies/athena-results-lifecycle.json `
  --profile apic
```

## Cleanup

Always run inventory first:

```powershell
.\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket api-center-raw-data -Profile apic
```

Run dry-run cleanup:

```powershell
.\scripts\data-pipeline\cleanup-athena-results.ps1 -Bucket api-center-raw-data -Profile apic -OlderThanDays 7
```

Move old flat files to legacy quarantine only after reviewing dry-run output:

```powershell
.\scripts\data-pipeline\cleanup-athena-results.ps1 `
  -Bucket api-center-raw-data `
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
platform_validation_workgroup:
management_workgroup:
tribe_reader_workgroup:
raw_bucket_access_for_bi: false
result_bucket_lifecycle_days: 7-30
prod_result_prefix: s3://api-center-athena-results/management/prod/
tribe_result_prefix: s3://api-center-athena-results/tribe/<tribe_id>/prod/
```

Keep `api-center-raw-data` platform-only. Do not use raw bucket permissions to
grant dashboard access.
