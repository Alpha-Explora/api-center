# Secret Manager Migration Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely finish the APICenter Secret Manager migration by removing legacy risk without breaking active production, test, shared-service, or tribe-secret flows.

**Architecture:** Treat Secret Manager cleanup as an evidence-first operational migration. Active `latest` secrets and live GKE mounts are preserved, legacy payload keys are removed by rotation, older enabled versions are disabled before destruction, and test/smoke tribe secrets are retired only after registry, pipeline, and operator evidence confirms they are unused.

**Tech Stack:** GCP Secret Manager, GKE/Kubernetes, PowerShell, `gcloud.cmd`, `kubectl`, APICenter NestJS gateway, APICenter management Next.js console, shared-service GKE deployments.

---

## Current Evidence Snapshot

Observed on 2026-05-22 from `C:\Codes\apic`:

- Current `gcloud` project: `api-center-496422`.
- Live GKE context: `gke_api-center-496422_asia-southeast1_api-center`.
- Production API Center ConfigMap in namespace `api-center` uses `GCP_PROJECT_ID=api-center-496422`, `GCP_SECRET_NAME=api-center-prod`, `AUTH_PROVIDER=composite`, and `KAFKA_TOPIC_PREFIX=prod.`.
- Test API Center ConfigMap in namespace `api-center-test` uses `GCP_PROJECT_ID=api-center-496422`, `GCP_SECRET_NAME=api-center-test`, `AUTH_PROVIDER=composite`, and `KAFKA_TOPIC_PREFIX=test.`.
- Production shared-service deployments mount Kubernetes secret `api-shared-services-prod`.
- Test shared-service deployments mount Kubernetes secret `api-shared-services-test`.
- Latest `api-center-prod` contains no documented legacy keys, but version 11 has a UTF-8 BOM that crashes plain `gcloud secrets versions access` output on this Windows shell. Runtime code strips BOM in `api-center/src/config/gcp-secret-loader.ts`, so this is a cleanup issue, not proof of runtime failure.
- Latest `api-shared-services-prod` and `api-shared-services-test` contain current provider/runtime key names and no documented legacy keys.
- The old GCP project `api-center-492808` could not be listed by the current account. Do not delete anything there until inventory access is restored.

## File Structure

- Modify: `api-center/docs/superpowers/plans/README.md`
  - Track this plan as active until cleanup is complete.
- Modify: `api-center/docs/apicenter-platform-setup.md`
  - After execution, update the operational source of truth with final retained secrets, retired secrets, and the no-BOM rotation rule.
- Modify: `api-center/docs/deployment-gke.md`
  - After execution, remove stale references to old project IDs or legacy secret paths if still present.
- Create during execution: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`
  - Human-readable inventory and decision log. This file must not contain plaintext secret values.

---

### Task 1: Create A Non-Secret Inventory And Decision Log

**Files:**
- Create: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`

- [ ] **Step 1: Confirm local proxy variables will not affect cloud commands**

Run:

```powershell
Write-Output "HTTP_PROXY=$env:HTTP_PROXY"
Write-Output "HTTPS_PROXY=$env:HTTPS_PROXY"
Write-Output "ALL_PROXY=$env:ALL_PROXY"
```

Expected: If any value points to `http://127.0.0.1:9`, clear it for each `kubectl`/HTTP command:

```powershell
$env:HTTP_PROXY=$null
$env:HTTPS_PROXY=$null
$env:http_proxy=$null
$env:https_proxy=$null
$env:ALL_PROXY=$null
$env:all_proxy=$null
```

- [ ] **Step 2: Inventory Secret Manager names without values**

Run:

```powershell
$project = "api-center-496422"
gcloud.cmd secrets list `
  --project=$project `
  --format="table(name.basename(),createTime)"
```

Expected: The list includes active platform secrets, shared-service secrets, prod tribe secrets, and test tribe secrets.

- [ ] **Step 3: Inventory enabled versions without values**

Run:

```powershell
$project = "api-center-496422"
$secrets = gcloud.cmd secrets list --project=$project --format="value(name.basename())"
foreach ($secret in $secrets) {
  Write-Output "SECRET $secret"
  gcloud.cmd secrets versions list $secret `
    --project=$project `
    --filter="state:ENABLED" `
    --format="table(name.basename(),state,createTime)"
}
```

Expected: Each secret has at least one enabled version. Record secrets with many enabled versions, especially `api-center-prod`, `api-center-test`, `api-shared-services-prod`, `api-shared-services-test`, and smoke/test tribe secrets.

- [ ] **Step 4: Create the decision log**

Create `api-center/docs/operations/secret-manager-inventory-2026-05-22.md` with this structure:

```markdown
# Secret Manager Inventory And Cleanup Decisions

Date: 2026-05-22
Project: api-center-496422

## Keep

| Secret | Reason |
| --- | --- |
| api-center-prod | Production API Center loads this through GCP_SECRET_NAME. |
| api-center-test | Test API Center loads this through GCP_SECRET_NAME. |
| api-shared-services-prod | Production shared-service pods mount this Kubernetes secret after sync. |
| api-shared-services-test | Test shared-service pods mount this Kubernetes secret after sync. |

## Review Before Retiring

| Secret | Required evidence before disable/delete |
| --- | --- |
| api-center-tribe-secret-smoke-tribe | Confirm live smoke tests are no longer needed. |
| api-center-tribe-secret-test-tribe | Confirm no prod-scope test tribe token flow uses it. |
| api-center-test-tribe-secret-codex-sdk-20260520041053 | Confirm data-pipeline smoke evidence and docs no longer need repeat publishes. |
| api-center-test-tribe-secret-codex-owner-* | Confirm no active registration/onboarding test depends on it. |
| api-center-test-tribe-secret-codex-smoke-* | Confirm no active local smoke test depends on it. |

## Candidate Legacy Versions To Disable

| Secret | Versions | Reason |
| --- | --- | --- |
| api-center-prod | older enabled versions except latest | Runtime uses latest; keep only short rollback window. |
| api-center-test | older enabled versions except latest | Runtime uses latest; keep only short rollback window. |
| api-shared-services-prod | older enabled versions except latest | Shared services use synced current Kubernetes secret. |
| api-shared-services-test | older enabled versions except latest | Shared services use synced current Kubernetes secret. |

## Blocked Inventory

| Project | Blocker | Next action |
| --- | --- | --- |
| api-center-492808 | Current account cannot list Secret Manager secrets. | Restore inventory access before deleting or disabling anything in this project. |
```

- [ ] **Step 5: Commit inventory only**

Run:

```powershell
git add api-center/docs/operations/secret-manager-inventory-2026-05-22.md
git commit -m "docs: add secret manager cleanup inventory"
```

Expected: Commit succeeds and contains no secret values.

---

### Task 2: Rotate `api-center-prod` Without UTF-8 BOM

**Files:**
- No repo file required unless execution findings update docs afterward.

- [ ] **Step 1: Export latest `api-center-prod` to a temporary file**

Run:

```powershell
$project = "api-center-496422"
$source = "C:\tmp\api-center-prod-latest.json"
$clean = "C:\tmp\api-center-prod-clean.json"
if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Force }
if (Test-Path -LiteralPath $clean) { Remove-Item -LiteralPath $clean -Force }
gcloud.cmd secrets versions access latest `
  --secret=api-center-prod `
  --project=$project `
  --out-file=$source
```

Expected: `$source` exists. Do not print its contents.

- [ ] **Step 2: Rewrite as UTF-8 without BOM and validate JSON**

Run:

```powershell
$bytes = [System.IO.File]::ReadAllBytes($source)
$text = [System.Text.Encoding]::UTF8.GetString($bytes)
if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
  $text = $text.Substring(1)
}
$json = $text | ConvertFrom-Json
$json.PSObject.Properties.Name | Sort-Object
[System.IO.File]::WriteAllText(
  $clean,
  ($json | ConvertTo-Json -Depth 20),
  [System.Text.UTF8Encoding]::new($false)
)
```

Expected: Key names print, secret values do not. `$clean` is valid JSON without BOM.

- [ ] **Step 3: Add the clean payload as a new version**

Run:

```powershell
gcloud.cmd secrets versions add api-center-prod `
  --project=$project `
  --data-file=$clean
```

Expected: A new enabled version is created.

- [ ] **Step 4: Verify the latest version is readable without `--out-file`**

Run:

```powershell
$output = & gcloud.cmd secrets versions access latest `
  --secret=api-center-prod `
  --project=$project 2>&1
$code = $LASTEXITCODE
$text = ($output -join "`n")
$keyCount = ([regex]::Matches($text, '"([^"\\]*(?:\\.[^"\\]*)*)"\s*:')).Count
Write-Output "exit=$code keyCount=$keyCount length=$($text.Length)"
```

Expected: `exit=0`, `keyCount` is greater than zero. Do not print the payload.

- [ ] **Step 5: Remove temporary files**

Run:

```powershell
Remove-Item -LiteralPath $source -Force
Remove-Item -LiteralPath $clean -Force
```

Expected: Both temp files are gone.

- [ ] **Step 6: Restart production API Center pods after confirming a maintenance window**

Run only after confirming the operator window:

```powershell
$env:HTTP_PROXY=$null
$env:HTTPS_PROXY=$null
$env:http_proxy=$null
$env:https_proxy=$null
$env:ALL_PROXY=$null
$env:all_proxy=$null
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center --timeout=180s
```

Expected: Rollout completes successfully.

---

### Task 3: Verify Active Runtime Secret References

**Files:**
- Modify after verification: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`

- [ ] **Step 1: Verify production API Center ConfigMap**

Run:

```powershell
$env:HTTP_PROXY=$null
$env:HTTPS_PROXY=$null
$env:http_proxy=$null
$env:https_proxy=$null
$env:ALL_PROXY=$null
$env:all_proxy=$null
kubectl get configmap api-center-config -n api-center `
  -o jsonpath="{.data.GCP_PROJECT_ID}{' '}{.data.GCP_SECRET_NAME}{' '}{.data.AUTH_PROVIDER}{' '}{.data.KAFKA_TOPIC_PREFIX}"
```

Expected: `api-center-496422 api-center-prod composite prod.`

- [ ] **Step 2: Verify test API Center ConfigMap**

Run:

```powershell
kubectl get configmap api-center-config -n api-center-test `
  -o jsonpath="{.data.GCP_PROJECT_ID}{' '}{.data.GCP_SECRET_NAME}{' '}{.data.AUTH_PROVIDER}{' '}{.data.KAFKA_TOPIC_PREFIX}"
```

Expected: `api-center-496422 api-center-test composite test.`

- [ ] **Step 3: Verify shared-service secret mounts**

Run:

```powershell
kubectl get deployments -n api-center `
  -o jsonpath="{range .items[*]}{.metadata.name}{':'}{range .spec.template.spec.containers[*].envFrom[*]}{.secretRef.name}{','}{end}{'\n'}{end}"
kubectl get deployments -n api-center-test `
  -o jsonpath="{range .items[*]}{.metadata.name}{':'}{range .spec.template.spec.containers[*].envFrom[*]}{.secretRef.name}{','}{end}{'\n'}{end}"
```

Expected: Production shared-service deployments use `api-shared-services-prod`; test shared-service deployments use `api-shared-services-test`.

- [ ] **Step 4: Update the inventory evidence**

Append a dated section to `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`:

```markdown
## Runtime Reference Verification

Date: 2026-05-22

- Production API Center ConfigMap uses `api-center-prod`.
- Test API Center ConfigMap uses `api-center-test`.
- Production shared-service deployments mount `api-shared-services-prod`.
- Test shared-service deployments mount `api-shared-services-test`.
- No live GKE config inspected in project `api-center-496422` references project `api-center-492808`.
```

- [ ] **Step 5: Commit verification evidence**

Run:

```powershell
git add api-center/docs/operations/secret-manager-inventory-2026-05-22.md
git commit -m "docs: record active secret runtime references"
```

Expected: Commit succeeds.

---

### Task 4: Disable Older Enabled Versions, Do Not Destroy Yet

**Files:**
- Modify: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`

- [ ] **Step 1: List current enabled versions for core secrets**

Run:

```powershell
$project = "api-center-496422"
$coreSecrets = @(
  "api-center-prod",
  "api-center-test",
  "api-shared-services-prod",
  "api-shared-services-test"
)
foreach ($secret in $coreSecrets) {
  Write-Output "SECRET $secret"
  gcloud.cmd secrets versions list $secret `
    --project=$project `
    --filter="state:ENABLED" `
    --format="table(name.basename(),state,createTime)"
}
```

Expected: Each secret has one latest version plus zero or more older enabled versions.

- [ ] **Step 2: Disable older enabled versions only after a successful runtime check**

For each core secret, disable all enabled versions except the latest version. Example command:

```powershell
$project = "api-center-496422"
$secret = "api-center-prod"
$keep = "12"
$disable = @("4","5","6","7","8","9","11")
foreach ($version in $disable) {
  gcloud.cmd secrets versions disable $version `
    --secret=$secret `
    --project=$project `
    --quiet
}
```

Expected: Older versions become disabled. The kept latest version remains enabled.

- [ ] **Step 3: Recheck enabled versions**

Run:

```powershell
foreach ($secret in $coreSecrets) {
  Write-Output "SECRET $secret"
  gcloud.cmd secrets versions list $secret `
    --project=$project `
    --filter="state:ENABLED" `
    --format="table(name.basename(),state,createTime)"
}
```

Expected: Each core secret has only the intended enabled version unless the operator intentionally preserved one rollback version.

- [ ] **Step 4: Document disabled versions**

Append a section to `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`:

```markdown
## Disabled Historical Versions

Date: 2026-05-22

| Secret | Disabled versions | Kept enabled versions | Reason |
| --- | --- | --- | --- |
| api-center-prod | <versions> | <version> | Runtime uses latest; old versions no longer needed for normal operation. |
| api-center-test | <versions> | <version> | Runtime uses latest; old versions no longer needed for normal operation. |
| api-shared-services-prod | <versions> | <version> | Synced Kubernetes secret uses current payload. |
| api-shared-services-test | <versions> | <version> | Synced Kubernetes secret uses current payload. |
```

- [ ] **Step 5: Commit disabled-version evidence**

Run:

```powershell
git add api-center/docs/operations/secret-manager-inventory-2026-05-22.md
git commit -m "docs: record disabled secret versions"
```

Expected: Commit succeeds.

---

### Task 5: Classify And Retire Unused Smoke/Test Tribe Secrets

**Files:**
- Modify: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`
- Modify if stale docs are found: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify if stale docs are found: `apicenter-management/docs/operations/local-smoke-testing.md`

- [ ] **Step 1: Search repo references for candidate secrets and tribe IDs**

Run:

```powershell
rg -n "codex-smoke|codex-owner|codex-sdk-20260520041053|smoke-tribe|test-tribe|flow-ci|greenovate|pakiapps|shoteam|smurf-village|trinithrive|church-donations|logistics" `
  -S `
  --glob "!**/node_modules/**" `
  --glob "!**/dist/**" `
  --glob "!**/coverage/**" `
  api-center api-shared-services apicenter-management
```

Expected: References are mostly docs/plans for smoke evidence. Any current runbook reference means the secret should be kept until that runbook is updated.

- [ ] **Step 2: Mark dated Codex secrets as retire candidates**

Add this table to the inventory file:

```markdown
## Tribe Secret Retirement Candidates

| Secret | Classification | Action |
| --- | --- | --- |
| api-center-test-tribe-secret-codex-owner-20260520024442 | Dated test artifact | Disable first; delete after 7 days if no owner objects. |
| api-center-test-tribe-secret-codex-owner-20260520024731 | Dated test artifact | Disable first; delete after 7 days if no owner objects. |
| api-center-test-tribe-secret-codex-smoke-20260520022325 | Dated smoke artifact | Disable first; delete after 7 days if no smoke run needs replay. |
| api-center-test-tribe-secret-codex-smoke-20260520022425 | Dated smoke artifact | Disable first; delete after 7 days if no smoke run needs replay. |
| api-center-test-tribe-secret-codex-smoke-20260520022520 | Dated smoke artifact | Disable first; delete after 7 days if no smoke run needs replay. |
| api-center-test-tribe-secret-codex-smoke-20260520022710 | Dated smoke artifact | Disable first; delete after 7 days if no smoke run needs replay. |
| api-center-test-tribe-secret-codex-sdk-20260520041053 | Data-pipeline smoke artifact | Keep until pipeline evidence is archived and no repeat publish is needed. |
```

- [ ] **Step 3: Disable dated Codex secrets after evidence review**

Run only for secrets classified as safe to retire:

```powershell
$project = "api-center-496422"
$retireSecrets = @(
  "api-center-test-tribe-secret-codex-owner-20260520024442",
  "api-center-test-tribe-secret-codex-owner-20260520024731",
  "api-center-test-tribe-secret-codex-smoke-20260520022325",
  "api-center-test-tribe-secret-codex-smoke-20260520022425",
  "api-center-test-tribe-secret-codex-smoke-20260520022520",
  "api-center-test-tribe-secret-codex-smoke-20260520022710"
)
foreach ($secret in $retireSecrets) {
  $versions = gcloud.cmd secrets versions list $secret `
    --project=$project `
    --filter="state:ENABLED" `
    --format="value(name.basename())"
  foreach ($version in $versions) {
    gcloud.cmd secrets versions disable $version `
      --secret=$secret `
      --project=$project `
      --quiet
  }
}
```

Expected: Selected dated test/smoke secrets have no enabled versions. Do not delete the secret resources yet.

- [ ] **Step 4: Wait one operating week**

Expected: No failed smoke tests, onboarding checks, or pipeline replay tasks require the disabled dated secrets.

- [ ] **Step 5: Delete retired dated Codex secret resources**

Run only after Step 4 passes:

```powershell
$project = "api-center-496422"
foreach ($secret in $retireSecrets) {
  gcloud.cmd secrets delete $secret `
    --project=$project `
    --quiet
}
```

Expected: Only retired dated test artifacts are deleted.

- [ ] **Step 6: Commit retirement evidence**

Run:

```powershell
git add api-center/docs/operations/secret-manager-inventory-2026-05-22.md
git commit -m "docs: record retired smoke secret cleanup"
```

Expected: Commit succeeds.

---

### Task 6: Resolve The Old Project `api-center-492808`

**Files:**
- Modify: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`
- Modify if stale docs are found: `api-center/docs/deployment-gke.md`

- [ ] **Step 1: Restore or request inventory access**

Required permission: `secretmanager.secrets.list` on project `api-center-492808`.

Run after access is restored:

```powershell
gcloud.cmd secrets list `
  --project=api-center-492808 `
  --format="table(name.basename(),createTime)"
```

Expected: Either a list of legacy secrets appears, or project access remains blocked and cleanup must stop for that project.

- [ ] **Step 2: Confirm no live workload points to the old project**

Run:

```powershell
rg -n "api-center-492808" `
  -S `
  --glob "!**/node_modules/**" `
  --glob "!**/dist/**" `
  --glob "!**/coverage/**" `
  api-center api-shared-services apicenter-management
```

Expected: Active manifests should point to `api-center-496422`. Historical docs may still mention `api-center-492808` and must be labeled historical if kept.

- [ ] **Step 3: Decide old-project retention**

Append this to the inventory file:

```markdown
## Old Project Decision

| Project | Decision | Evidence |
| --- | --- | --- |
| api-center-492808 | <keep temporarily / disable secrets / delete secrets> | <inventory and workload evidence> |
```

- [ ] **Step 4: Do not delete old-project secrets until billing, Artifact Registry, GKE, and DNS are checked**

Run:

```powershell
gcloud.cmd container clusters list --project=api-center-492808
gcloud.cmd artifacts repositories list --project=api-center-492808
gcloud.cmd compute forwarding-rules list --project=api-center-492808
```

Expected: If any active infrastructure exists, keep secrets until that infrastructure is retired or migrated.

- [ ] **Step 5: Commit old-project decision evidence**

Run:

```powershell
git add api-center/docs/operations/secret-manager-inventory-2026-05-22.md api-center/docs/deployment-gke.md
git commit -m "docs: record old gcp project secret decision"
```

Expected: Commit succeeds, or `api-center/docs/deployment-gke.md` is omitted if unchanged.

---

### Task 7: Update Durable Runbooks

**Files:**
- Modify: `api-center/docs/apicenter-platform-setup.md`
- Modify: `api-center/docs/deployment-gke.md`
- Modify: `api-center/docs/superpowers/plans/README.md`

- [ ] **Step 1: Update platform setup secret guidance**

In `api-center/docs/apicenter-platform-setup.md`, keep the current target model:

```text
api-center-prod
api-center-test
api-shared-services-prod
api-shared-services-test
api-center-tribe-secret-<tribe-id>
api-center-test-tribe-secret-<tribe-id>
```

Expected: The doc says `TRIBE_SECRET_*` is local/dev rollback only and should not be added to GCP platform secrets for new tribes.

- [ ] **Step 2: Add no-BOM rotation note**

Add this operator note:

````markdown
When rotating JSON payloads from Windows PowerShell, write UTF-8 without BOM.
The API Center loader strips BOM at runtime, but BOM payloads can break plain
`gcloud secrets versions access` output in some shells. Prefer:

```powershell
[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
```
````

- [ ] **Step 3: Update GKE deployment docs**

Search and update stale active references:

```powershell
rg -n "api-center-492808|TRIBE_SECRET_[A-Z0-9_]+|PAYMONGO_SECRET_KEY|PAYMONGO_WEBHOOK_SECRET|KAFKA_SSL_CA_PEM" api-center/docs/deployment-gke.md api-center/docs/apicenter-platform-setup.md
```

Expected: Current instructions do not tell operators to use old project IDs or legacy payload keys. Historical changelog entries may remain if clearly historical.

- [ ] **Step 4: Move this plan from active to completed after execution**

After all cleanup is done, update `api-center/docs/superpowers/plans/README.md` from `active` to `completed` for this plan.

- [ ] **Step 5: Commit runbook updates**

Run:

```powershell
git add api-center/docs/apicenter-platform-setup.md api-center/docs/deployment-gke.md api-center/docs/superpowers/plans/README.md
git commit -m "docs: update secret manager cleanup runbooks"
```

Expected: Commit succeeds.

---

### Task 8: Final Verification And Completion Criteria

**Files:**
- Modify: `api-center/docs/operations/secret-manager-inventory-2026-05-22.md`

- [ ] **Step 1: Verify core secret latest versions remain enabled**

Run:

```powershell
$project = "api-center-496422"
$coreSecrets = @("api-center-prod","api-center-test","api-shared-services-prod","api-shared-services-test")
foreach ($secret in $coreSecrets) {
  Write-Output "SECRET $secret"
  gcloud.cmd secrets versions list $secret `
    --project=$project `
    --filter="state:ENABLED" `
    --format="table(name.basename(),state,createTime)"
}
```

Expected: Each core secret has the intended enabled version.

- [ ] **Step 2: Verify GKE runtime references still point to retained secrets**

Run:

```powershell
kubectl get configmap api-center-config -n api-center `
  -o jsonpath="{.data.GCP_PROJECT_ID}{' '}{.data.GCP_SECRET_NAME}{' '}{.data.KAFKA_TOPIC_PREFIX}"
kubectl get configmap api-center-config -n api-center-test `
  -o jsonpath="{.data.GCP_PROJECT_ID}{' '}{.data.GCP_SECRET_NAME}{' '}{.data.KAFKA_TOPIC_PREFIX}"
kubectl get deployments -n api-center `
  -o jsonpath="{range .items[*]}{.metadata.name}{':'}{range .spec.template.spec.containers[*].envFrom[*]}{.secretRef.name}{','}{end}{'\n'}{end}"
kubectl get deployments -n api-center-test `
  -o jsonpath="{range .items[*]}{.metadata.name}{':'}{range .spec.template.spec.containers[*].envFrom[*]}{.secretRef.name}{','}{end}{'\n'}{end}"
```

Expected: Production and test still point at retained secrets only.

- [ ] **Step 3: Verify no documented legacy keys remain in latest core payloads**

Run:

```powershell
$project = "api-center-496422"
$coreSecrets = @("api-center-prod","api-center-test","api-shared-services-prod","api-shared-services-test")
$legacy = @(
  "PAYMONGO_SECRET_KEY",
  "PAYMONGO_WEBHOOK_SECRET",
  "GEOLOCATION_API_URL",
  "GEOLOCATION_API_KEY",
  "GEOTAGGING_API_URL",
  "GEOTAGGING_API_KEY",
  "GEOFENCING_API_URL",
  "GEOFENCING_API_KEY",
  "EXTERNAL_ALLOWLIST_GEOLOCATION",
  "EXTERNAL_ALLOWLIST_GEOTAGGING",
  "EXTERNAL_ALLOWLIST_GEOFENCING",
  "KAFKA_SSL_CA_PEM"
)
foreach ($secret in $coreSecrets) {
  $path = "C:\tmp\$secret-latest.json"
  gcloud.cmd secrets versions access latest --secret=$secret --project=$project --out-file=$path
  $bytes = [System.IO.File]::ReadAllBytes($path)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) {
    $text = $text.Substring(1)
  }
  $keys = [regex]::Matches($text, '"([^"\\]*(?:\\.[^"\\]*)*)"\s*:') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  $present = $legacy | Where-Object { $keys -contains $_ }
  Write-Output "$secret legacyKeys=$($present -join ',')"
  Remove-Item -LiteralPath $path -Force
}
```

Expected: Each line has an empty `legacyKeys=` value.

- [ ] **Step 4: Record final completion**

Append:

```markdown
## Completion Evidence

Date: 2026-05-22

- Core platform/shared-service secrets retained and verified.
- Legacy payload keys absent from latest core secrets.
- UTF-8 BOM removed from `api-center-prod`.
- Older enabled core versions disabled or explicitly retained as rollback.
- Dated smoke/test tribe secrets retired only after evidence review.
- Old project `api-center-492808` handled according to explicit inventory evidence.
```

- [ ] **Step 5: Final commit**

Run:

```powershell
git add api-center/docs/operations/secret-manager-inventory-2026-05-22.md
git commit -m "docs: complete secret manager cleanup evidence"
```

Expected: Commit succeeds.

---

## Safety Rules

- Never print plaintext secret values in terminal, docs, commits, or chat.
- Prefer `--out-file` for payload reads when checking key names.
- Disable before delete.
- Keep `api-center-prod`, `api-center-test`, `api-shared-services-prod`, and `api-shared-services-test`.
- Do not delete anything in `api-center-492808` until inventory access is restored and old infrastructure is checked.
- Do not delete active tribe secrets just because they are old. Retire only when registry, smoke, and pipeline evidence show they are unused.

## Self-Review

- Spec coverage: The plan covers no-BOM rotation, live runtime verification, legacy-key checks, historical version cleanup, dated test-secret retirement, old-project inventory, and durable docs.
- Placeholder scan: No task relies on an undefined operator action without a command or expected result. Values that must be discovered at execution time are represented as explicit evidence fields in the inventory file.
- Type consistency: Secret names, project IDs, namespaces, and runtime config keys match the verified APICenter naming model.
