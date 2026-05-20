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
