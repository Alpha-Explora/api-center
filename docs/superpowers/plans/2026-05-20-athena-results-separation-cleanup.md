# Athena Results Separation And Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Athena query result output by purpose, environment, and tribe where needed, then safely inventory and clean up the current flat `athena-results/` prefix.

**Architecture:** Raw Confluent S3 data stays under `s3://api-center-raw-data/topics/...`; this plan changes only Athena query result output. During the pilot, results may stay in the existing bucket but must move under governed prefixes. Before tribe-facing or BI access, create or switch to a dedicated Athena results bucket/workgroup so query artifacts can have separate IAM and lifecycle policy from raw data.

**Tech Stack:** PowerShell scripts, AWS CLI, Athena workgroups, S3 lifecycle policies, APICenter data-pipeline docs/runbooks.

---

## Current Problem

Current scripts and docs use a flat result location:

```text
s3://api-center-raw-data/athena-results/
```

That is acceptable for early platform-only validation, but it is not enough once
query results become management, BI, or tribe-facing artifacts. Athena result
files can contain row-level data from curated tables. They need visibility and
retention boundaries separate from raw S3.

## Target Layout

Short-term, keep the existing bucket but split result prefixes:

```text
s3://api-center-raw-data/athena-results/platform/validation/test/
s3://api-center-raw-data/athena-results/platform/validation/prod/
s3://api-center-raw-data/athena-results/management/test/
s3://api-center-raw-data/athena-results/management/prod/
s3://api-center-raw-data/athena-results/tribe/<tribe_id>/test/
s3://api-center-raw-data/athena-results/tribe/<tribe_id>/prod/
s3://api-center-raw-data/athena-results/legacy-unclassified/<yyyy-mm-dd>/
```

Long-term, prefer a dedicated bucket:

```text
s3://api-center-athena-results/athena-results/platform/validation/test/
s3://api-center-athena-results/athena-results/platform/validation/prod/
s3://api-center-athena-results/athena-results/management/test/
s3://api-center-athena-results/athena-results/management/prod/
s3://api-center-athena-results/athena-results/tribe/<tribe_id>/test/
s3://api-center-athena-results/athena-results/tribe/<tribe_id>/prod/
```

Do not separate Athena results by microservice. Use:

```text
purpose: platform validation, management, tribe
environment: test, prod
tribe_id: only for tribe-facing result artifacts
```

## Planned File Structure

| Path | Purpose |
| --- | --- |
| `api-center/scripts/data-pipeline/resolve-athena-output-location.ps1` | Computes the governed Athena output prefix from purpose, environment, and optional tribe ID. |
| `api-center/scripts/data-pipeline/run-athena-query.ps1` | Adds optional purpose/environment/tribe arguments while preserving explicit `-OutputLocation`. |
| `api-center/scripts/data-pipeline/validate-athena-results-layout.ps1` | Lists current Athena result prefixes and flags flat/unclassified objects. |
| `api-center/scripts/data-pipeline/cleanup-athena-results.ps1` | Dry-run-first cleanup helper for old flat `athena-results/` objects. |
| `api-center/infra/aws-data-pipeline/policies/athena-results-lifecycle.json` | Lifecycle policy template for result cleanup. |
| `api-center/docs/data-pipeline/athena-results-runbook.md` | Operator runbook for output prefixes, workgroups, lifecycle, IAM, and cleanup. |
| `api-center/infra/aws-data-pipeline/README.md` | Update required environment and examples. |
| `api-center/docs/data-pipeline/retention-access-cost-controls.md` | Update result retention/access controls. |
| `api-center/docs/data-pipeline/actual-pipeline-runbook.md` | Update pilot commands to use separated output prefixes. |
| `api-center/docs/production-costing.md` | Update cost controls to include separated result lifecycle. |
| `api-center/docs/superpowers/plans/2026-05-20-data-pipeline-pilot-and-management-health.md` | Update continuation plan examples to use governed result prefixes. |

---

## Phase 0: Inventory Current Result Usage

**Purpose:** Confirm every current flat result reference before changing scripts.

**Files:**
- No edits.

- [ ] **Step 1: Search current references**

Run:

```powershell
cd C:\Codes\apic\api-center
rg -n "athena-results|ATHENA_OUTPUT_LOCATION|OutputLocation|query_result_location" docs infra scripts
```

Expected:

```text
All current result output references are visible.
Flat references to s3://api-center-raw-data/athena-results/ are identified.
```

- [ ] **Step 2: Capture current S3 result prefix inventory**

Run:

```powershell
cd C:\Codes\apic\api-center
aws s3api list-objects-v2 `
  --bucket api-center-raw-data `
  --prefix athena-results/ `
  --max-keys 100 `
  --profile apic
```

Expected:

```text
The output shows whether existing files are flat under athena-results/ or already grouped.
Do not delete anything in this step.
```

---

## Phase 1: Add Athena Output Location Resolver

**Purpose:** Make output prefixes deterministic instead of hand-writing `s3://.../athena-results/` in commands.

**Files:**
- Create: `api-center/scripts/data-pipeline/resolve-athena-output-location.ps1`

- [ ] **Step 1: Create resolver script**

Create `api-center/scripts/data-pipeline/resolve-athena-output-location.ps1`:

```powershell
param(
  [ValidateSet("platform-validation", "management", "tribe")]
  [string]$Purpose = "platform-validation",

  [ValidateSet("test", "prod")]
  [string]$Environment = "test",

  [string]$TribeId,

  [string]$ResultsBucket = $env:ATHENA_RESULTS_BUCKET,

  [string]$FallbackBucket = $env:API_CENTER_RAW_BUCKET
)

$ErrorActionPreference = "Stop"

if (-not $ResultsBucket) {
  $ResultsBucket = $FallbackBucket
}

if (-not $ResultsBucket) {
  $ResultsBucket = "api-center-raw-data"
}

if ($Purpose -eq "tribe") {
  if (-not $TribeId) {
    throw "TribeId is required when Purpose is tribe."
  }

  if ($TribeId -notmatch "^[a-z0-9][a-z0-9._-]*[a-z0-9]$") {
    throw "TribeId must use lowercase letters, numbers, dot, underscore, or hyphen."
  }

  "s3://$ResultsBucket/athena-results/tribe/$TribeId/$Environment/"
  exit 0
}

if ($Purpose -eq "platform-validation") {
  "s3://$ResultsBucket/athena-results/platform/validation/$Environment/"
  exit 0
}

"s3://$ResultsBucket/athena-results/management/$Environment/"
```

- [ ] **Step 2: Verify resolver output**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose platform-validation -Environment test
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose management -Environment prod
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose tribe -Environment test -TribeId codex-sdk-20260520041053
```

Expected:

```text
s3://api-center-raw-data/athena-results/platform/validation/test/
s3://api-center-raw-data/athena-results/management/prod/
s3://api-center-raw-data/athena-results/tribe/codex-sdk-20260520041053/test/
```

- [ ] **Step 3: Commit Phase 1**

Run:

```powershell
cd C:\Codes\apic\api-center
git add scripts/data-pipeline/resolve-athena-output-location.ps1
git commit -m "feat: add athena output location resolver"
```

---

## Phase 2: Update Athena Query Runner

**Purpose:** Let existing validation scripts use governed result prefixes without breaking explicit `-OutputLocation`.

**Files:**
- Modify: `api-center/scripts/data-pipeline/run-athena-query.ps1`

- [ ] **Step 1: Add resolver parameters**

In `api-center/scripts/data-pipeline/run-athena-query.ps1`, change the parameter block to include:

```powershell
  [ValidateSet("platform-validation", "management", "tribe")]
  [string]$ResultPurpose = "platform-validation",
  [ValidateSet("test", "prod")]
  [string]$Environment = "test",
  [string]$TribeId,
```

Keep the existing `OutputLocation` parameter:

```powershell
  [string]$OutputLocation = $env:ATHENA_OUTPUT_LOCATION,
```

- [ ] **Step 2: Resolve output location when not explicitly provided**

Replace:

```powershell
if (-not $OutputLocation) { throw "ATHENA_OUTPUT_LOCATION is required" }
```

with:

```powershell
if (-not $OutputLocation) {
  $resolver = Join-Path $PSScriptRoot "resolve-athena-output-location.ps1"
  $resolverArgs = @(
    "-Purpose", $ResultPurpose,
    "-Environment", $Environment
  )

  if ($TribeId) {
    $resolverArgs += @("-TribeId", $TribeId)
  }

  $OutputLocation = & $resolver @resolverArgs
}

if (-not $OutputLocation) { throw "ATHENA_OUTPUT_LOCATION is required" }
```

- [ ] **Step 3: Verify backwards compatibility with explicit output**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\pipeline-health-daily.sql `
  -Database gold_platform `
  -Workgroup primary `
  -OutputLocation s3://api-center-raw-data/athena-results/platform/validation/test/ `
  -Profile apic `
  -Parameters @{ environment = "test"; year = "2026"; month = "05"; day = "20" } `
  -Wait
```

Expected:

```text
state = SUCCEEDED
output_location starts with s3://api-center-raw-data/athena-results/platform/validation/test/
```

- [ ] **Step 4: Verify default governed output**

Run:

```powershell
cd C:\Codes\apic\api-center
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

Expected:

```text
state = SUCCEEDED
output_location starts with s3://api-center-raw-data/athena-results/platform/validation/test/
```

- [ ] **Step 5: Commit Phase 2**

Run:

```powershell
cd C:\Codes\apic\api-center
git add scripts/data-pipeline/run-athena-query.ps1
git commit -m "feat: route athena results by purpose and environment"
```

---

## Phase 3: Document Result Prefixes, Access, And Workgroups

**Purpose:** Make the new convention visible before cleanup changes are run.

**Files:**
- Create: `api-center/docs/data-pipeline/athena-results-runbook.md`
- Modify: `api-center/infra/aws-data-pipeline/README.md`
- Modify: `api-center/docs/data-pipeline/retention-access-cost-controls.md`
- Modify: `api-center/docs/production-costing.md`

- [ ] **Step 1: Create Athena results runbook**

Create `api-center/docs/data-pipeline/athena-results-runbook.md`:

````markdown
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
````

- [ ] **Step 2: Update infrastructure README**

In `api-center/infra/aws-data-pipeline/README.md`, replace the flat output example:

```text
ATHENA_OUTPUT_LOCATION=s3://api-center-raw-data/athena-results/
```

with:

```text
ATHENA_RESULTS_BUCKET=api-center-raw-data
ATHENA_OUTPUT_LOCATION is optional when using scripts/data-pipeline/run-athena-query.ps1.
Default output is resolved from ResultPurpose and Environment, for example:
s3://api-center-raw-data/athena-results/platform/validation/test/
```

- [ ] **Step 3: Update retention/access controls**

In `api-center/docs/data-pipeline/retention-access-cost-controls.md`, replace:

```text
query_result_location: s3://api-center-raw-data/athena-results/
```

with:

```text
query_result_location:
  platform validation test: s3://api-center-raw-data/athena-results/platform/validation/test/
  platform validation prod: s3://api-center-raw-data/athena-results/platform/validation/prod/
  management test: s3://api-center-raw-data/athena-results/management/test/
  management prod: s3://api-center-raw-data/athena-results/management/prod/
  tribe results: s3://api-center-raw-data/athena-results/tribe/<tribe_id>/<environment>/
query_result_retention_days: 7-30
```

- [ ] **Step 4: Update production costing**

In `api-center/docs/production-costing.md`, add this line under data pipeline cost guardrails:

```markdown
| Separated Athena result prefixes | Lets lifecycle and IAM cleanup target query artifacts without touching raw S3. |
```

- [ ] **Step 5: Commit Phase 3**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/athena-results-runbook.md infra/aws-data-pipeline/README.md docs/data-pipeline/retention-access-cost-controls.md docs/production-costing.md
git commit -m "docs: define athena result separation"
```

---

## Phase 4: Add Lifecycle Policy Template

**Purpose:** Make cleanup enforceable through S3 lifecycle rules after approval.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/policies/athena-results-lifecycle.json`
- Modify: `api-center/docs/data-pipeline/athena-results-runbook.md`

- [ ] **Step 1: Create lifecycle policy template**

Create `api-center/infra/aws-data-pipeline/policies/athena-results-lifecycle.json`:

```json
{
  "Rules": [
    {
      "ID": "expire-athena-platform-validation-results",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "athena-results/platform/validation/"
      },
      "Expiration": {
        "Days": 30
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "expire-athena-management-results",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "athena-results/management/"
      },
      "Expiration": {
        "Days": 30
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "expire-athena-tribe-results",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "athena-results/tribe/"
      },
      "Expiration": {
        "Days": 30
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    },
    {
      "ID": "expire-athena-legacy-unclassified-results",
      "Status": "Enabled",
      "Filter": {
        "Prefix": "athena-results/legacy-unclassified/"
      },
      "Expiration": {
        "Days": 14
      },
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 7
      }
    }
  ]
}
```

- [ ] **Step 2: Document lifecycle application command**

Add to `api-center/docs/data-pipeline/athena-results-runbook.md`:

````markdown
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
````

- [ ] **Step 3: Commit Phase 4**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline/policies/athena-results-lifecycle.json docs/data-pipeline/athena-results-runbook.md
git commit -m "docs: add athena result lifecycle policy"
```

---

## Phase 5: Add Inventory And Cleanup Scripts

**Purpose:** Make cleanup explicit, dry-run-first, and auditable.

**Files:**
- Create: `api-center/scripts/data-pipeline/validate-athena-results-layout.ps1`
- Create: `api-center/scripts/data-pipeline/cleanup-athena-results.ps1`
- Modify: `api-center/docs/data-pipeline/athena-results-runbook.md`

- [ ] **Step 1: Create layout validator**

Create `api-center/scripts/data-pipeline/validate-athena-results-layout.ps1`:

```powershell
param(
  [string]$Bucket = $env:ATHENA_RESULTS_BUCKET,
  [string]$Profile = $env:AWS_PROFILE,
  [int]$MaxKeys = 1000
)

$ErrorActionPreference = "Stop"

if (-not $Bucket) {
  $Bucket = $env:API_CENTER_RAW_BUCKET
}

if (-not $Bucket) {
  $Bucket = "api-center-raw-data"
}

$args = @(
  "s3api", "list-objects-v2",
  "--bucket", $Bucket,
  "--prefix", "athena-results/",
  "--max-keys", "$MaxKeys"
)

if ($Profile) {
  $args += @("--profile", $Profile)
}

$json = & aws @args | ConvertFrom-Json
$objects = @($json.Contents | Where-Object { $_ })
$approvedPrefixes = @(
  "athena-results/platform/validation/test/",
  "athena-results/platform/validation/prod/",
  "athena-results/management/test/",
  "athena-results/management/prod/",
  "athena-results/tribe/",
  "athena-results/legacy-unclassified/"
)

$rows = $objects | ForEach-Object {
  $key = $_.Key
  $approved = $false
  foreach ($prefix in $approvedPrefixes) {
    if ($key.StartsWith($prefix)) {
      $approved = $true
      break
    }
  }

  [pscustomobject]@{
    bucket = $Bucket
    key = $key
    size = $_.Size
    last_modified = $_.LastModified
    approved_prefix = $approved
  }
}

[pscustomobject]@{
  bucket = $Bucket
  scanned = $rows.Count
  unclassified_count = @($rows | Where-Object { -not $_.approved_prefix }).Count
  rows = $rows
} | ConvertTo-Json -Depth 5
```

- [ ] **Step 2: Create dry-run cleanup script**

Create `api-center/scripts/data-pipeline/cleanup-athena-results.ps1`:

```powershell
param(
  [string]$Bucket = $env:ATHENA_RESULTS_BUCKET,
  [string]$Profile = $env:AWS_PROFILE,
  [int]$OlderThanDays = 7,
  [switch]$MoveToLegacy,
  [switch]$Delete,
  [switch]$ConfirmCleanup
)

$ErrorActionPreference = "Stop"

if (-not $Bucket) {
  $Bucket = $env:API_CENTER_RAW_BUCKET
}

if (-not $Bucket) {
  $Bucket = "api-center-raw-data"
}

if (($MoveToLegacy -or $Delete) -and -not $ConfirmCleanup) {
  throw "ConfirmCleanup is required for MoveToLegacy or Delete."
}

$cutoff = (Get-Date).ToUniversalTime().AddDays(-1 * $OlderThanDays)
$inventory = .\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket $Bucket -Profile $Profile | ConvertFrom-Json
$targets = @($inventory.rows | Where-Object {
  -not $_.approved_prefix -and ([datetime]$_.last_modified) -lt $cutoff
})
$legacyDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")

$actions = foreach ($target in $targets) {
  $action = "dry-run"
  $destination = $null

  if ($MoveToLegacy) {
    $destination = "athena-results/legacy-unclassified/$legacyDate/$($target.key.Substring('athena-results/'.Length))"
    $copySource = "$Bucket/$($target.key)"
    $copyArgs = @("s3api", "copy-object", "--bucket", $Bucket, "--copy-source", $copySource, "--key", $destination)
    $deleteArgs = @("s3api", "delete-object", "--bucket", $Bucket, "--key", $target.key)
    if ($Profile) {
      $copyArgs += @("--profile", $Profile)
      $deleteArgs += @("--profile", $Profile)
    }
    & aws @copyArgs | Out-Null
    & aws @deleteArgs | Out-Null
    $action = "moved-to-legacy"
  } elseif ($Delete) {
    $deleteArgs = @("s3api", "delete-object", "--bucket", $Bucket, "--key", $target.key)
    if ($Profile) {
      $deleteArgs += @("--profile", $Profile)
    }
    & aws @deleteArgs | Out-Null
    $action = "deleted"
  }

  [pscustomobject]@{
    action = $action
    bucket = $Bucket
    key = $target.key
    destination = $destination
    last_modified = $target.last_modified
    size = $target.size
  }
}

[pscustomobject]@{
  bucket = $Bucket
  older_than_days = $OlderThanDays
  target_count = $targets.Count
  mode = if ($MoveToLegacy) { "move-to-legacy" } elseif ($Delete) { "delete" } else { "dry-run" }
  actions = @($actions)
} | ConvertTo-Json -Depth 5
```

- [ ] **Step 3: Verify dry-run cleanup**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket api-center-raw-data -Profile apic
.\scripts\data-pipeline\cleanup-athena-results.ps1 -Bucket api-center-raw-data -Profile apic -OlderThanDays 7
```

Expected:

```text
cleanup output shows mode = dry-run
no objects are moved or deleted
```

- [ ] **Step 4: Document cleanup command**

Add to `api-center/docs/data-pipeline/athena-results-runbook.md`:

````markdown
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
````

- [ ] **Step 5: Commit Phase 5**

Run:

```powershell
cd C:\Codes\apic\api-center
git add scripts/data-pipeline/validate-athena-results-layout.ps1 scripts/data-pipeline/cleanup-athena-results.ps1 docs/data-pipeline/athena-results-runbook.md
git commit -m "feat: add athena results cleanup tooling"
```

---

## Phase 6: Migrate Validation Commands To Governed Prefixes

**Purpose:** Stop producing new flat result artifacts during APICenter pipeline validation.

**Files:**
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/data-pipeline/raw-to-bronze-runbook.md`
- Modify: `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`
- Modify: `api-center/docs/superpowers/plans/2026-05-20-data-pipeline-pilot-and-management-health.md`

- [ ] **Step 1: Replace flat validation examples**

Replace examples that use:

```text
-OutputLocation s3://api-center-raw-data/athena-results/
```

with:

```text
-Environment test `
-ResultPurpose platform-validation `
```

For prod examples, use:

```text
-Environment prod `
-ResultPurpose platform-validation `
```

- [ ] **Step 2: Add manual override note**

Add this note to the runbooks:

```markdown
If an operator passes `-OutputLocation`, that explicit path wins. Use explicit
paths only for break-glass diagnostics or migration testing. Normal validation
uses `-ResultPurpose` and `-Environment`.
```

- [ ] **Step 3: Verify no flat examples remain in active runbooks**

Run:

```powershell
cd C:\Codes\apic\api-center
rg -n "s3://api-center-raw-data/athena-results/$|OutputLocation=s3://api-center-raw-data/athena-results/" docs infra scripts
```

Expected:

```text
No active command examples use the flat athena-results root.
Historical plan text may still mention old output as past evidence.
```

- [ ] **Step 4: Commit Phase 6**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/actual-pipeline-runbook.md docs/data-pipeline/raw-to-bronze-runbook.md docs/data-pipeline/new-tribe-s3-onboarding-runbook.md docs/superpowers/plans/2026-05-20-data-pipeline-pilot-and-management-health.md
git commit -m "docs: use governed athena result prefixes"
```

---

## Phase 7: Optional Live Cleanup Execution

**Purpose:** Move or delete old flat result files only after inventory review.

**Files:**
- Modify: `api-center/docs/data-pipeline/athena-results-runbook.md`

- [ ] **Step 1: Run inventory**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket api-center-raw-data -Profile apic
```

Expected:

```text
unclassified_count is known
rows list old flat objects under athena-results/
```

- [ ] **Step 2: Run dry-run cleanup**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\cleanup-athena-results.ps1 `
  -Bucket api-center-raw-data `
  -Profile apic `
  -OlderThanDays 7
```

Expected:

```text
mode = dry-run
target_count is reviewed before any mutation
```

- [ ] **Step 3: Move old flat files to legacy quarantine**

Run only after the dry-run output is approved:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\cleanup-athena-results.ps1 `
  -Bucket api-center-raw-data `
  -Profile apic `
  -OlderThanDays 7 `
  -MoveToLegacy `
  -ConfirmCleanup
```

Expected:

```text
mode = move-to-legacy
objects move to athena-results/legacy-unclassified/<yyyy-mm-dd>/
```

- [ ] **Step 4: Record cleanup evidence**

Add to `api-center/docs/data-pipeline/athena-results-runbook.md`:

````markdown
## Cleanup Evidence

```text
cleanup_date:
bucket:
dry_run_target_count:
moved_to_legacy_count:
deleted_count:
legacy_prefix:
operator:
approval:
```
````

- [ ] **Step 5: Commit Phase 7**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/athena-results-runbook.md
git commit -m "docs: record athena results cleanup evidence"
```

---

## Phase 8: Dedicated Results Bucket And Workgroup Gate

**Purpose:** Prepare the clean production posture before tribe-facing or BI query-result access.

**Files:**
- Modify: `api-center/docs/data-pipeline/athena-results-runbook.md`
- Modify: `api-center/docs/data-pipeline/retention-access-cost-controls.md`

- [ ] **Step 1: Add bucket/workgroup gate**

Add to `api-center/docs/data-pipeline/athena-results-runbook.md`:

````markdown
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
````

- [ ] **Step 2: Add workgroup split to controls**

Add to `api-center/docs/data-pipeline/retention-access-cost-controls.md`:

```markdown
## Athena Workgroup Split Target

| Workgroup | Output prefix | Readers |
| --- | --- | --- |
| `api-center-platform-validation` | `s3://api-center-athena-results/athena-results/platform/validation/<environment>/` | Platform data operators |
| `api-center-management` | `s3://api-center-athena-results/athena-results/management/<environment>/` | Management service role/operators |
| `api-center-tribe-<tribe_id>` | `s3://api-center-athena-results/athena-results/tribe/<tribe_id>/<environment>/` | Approved tribe readers |
```

- [ ] **Step 3: Commit Phase 8**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/athena-results-runbook.md docs/data-pipeline/retention-access-cost-controls.md
git commit -m "docs: add athena results bucket gate"
```

---

## Completion Criteria

- New Athena validation results no longer land directly under flat `athena-results/`.
- `run-athena-query.ps1` can compute output paths from purpose/environment/tribe.
- Platform validation, management, and tribe result prefixes are documented.
- Lifecycle policy template exists for result cleanup.
- Cleanup script supports dry-run, move-to-legacy, and delete modes with explicit confirmation.
- Old flat result files are inventoried before any move/delete.
- Raw S3 remains unchanged and platform-only.
- Production/BI/tribe-facing query-result access is gated behind a dedicated bucket/workgroup decision.

## Known Risks

- Moving or deleting Athena result files can break old console links to CSV outputs. These are query artifacts, not source-of-truth data, but cleanup should still be documented.
- Applying a bucket lifecycle policy can replace or conflict with existing rules. Always inspect existing lifecycle configuration before applying the template.
- Tribe result prefixes are only useful if IAM/workgroup permissions enforce them. Prefix layout alone is not an access-control system.
- A dedicated results bucket is cleaner long-term, but it requires IAM and workgroup setup. The short-term split under `api-center-raw-data` is an interim control, not the final BI posture.
