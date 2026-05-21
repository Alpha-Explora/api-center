# Unfinished Platform Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the currently open API Center platform work needed for reliable test/live operation, Supabase persistence, shared-service S3 export, PayMongo lifecycle validation, and management-console production readiness.

**Architecture:** Keep API Center as the runtime gateway and control plane. Keep shared services internal to GKE and accessed through API Center. Move persistence and export in controlled phases: verify deployment state first, cut over test before live, then enable production only after smoke checks prove the flow.

**Tech Stack:** NestJS 11, Next.js 16, React 19, Node 24, GKE Autopilot, GCP Secret Manager, Memorystore Redis, Supabase Postgres, Prisma, Confluent Cloud Kafka, Confluent S3 Sink, AWS S3.

---

## Scope

Included:

- Confirm latest images are built, pushed, deployed, and healthy.
- Finish Supabase test/live cutover without mixing data.
- Validate PayMongo lifecycle persistence and webhook behavior.
- Verify shared-service topics are exported to S3.
- Finish management-console operational polish and route coverage.
- Clean stale plan checkboxes and docs after implementation.

Excluded:

- Glue crawlers.
- Athena tables.
- Databricks jobs.
- PowerBI dashboards.
- Any future analytics pipeline beyond the already implemented API Center management/analytics endpoints.

## Current Known State

- `api-center` has DB config, Postgres registry store, dual-write wiring, and a registry backfill script.
- API Center production currently stays Redis-first until `REGISTRY_SOURCE=postgres` is explicitly enabled.
- `api-shared-services` has PayMongo persistence support and tests for core lifecycle behavior.
- `apicenter-management` has tribe secret provisioning, Confluent topic provisioning, S3 sink inclusion, smoke tests, and restart routes.
- Some plan checkboxes are stale because status blocks say implemented while old checkbox lists were not backfilled.

## File Structure

### API Center

- Modify: `api-center/gcp/gke/30-deployment.yaml`
  - Tracks the API Center image tag deployed to GKE.
- Modify: `api-center/docs/deployment-gke.md`
  - Records exact restart, smoke, and rollback steps.
- Modify: `api-center/docs/database-control-plane.md`
  - Records registry source, dual-write, and backfill rules.
- Modify: `api-center/docs/superpowers/plans/2026-05-16-supabase-prod-database-migration.md`
  - Tracks live/test DB cutover progress.
- Modify: `api-center/docs/superpowers/plans/2026-05-16-hybrid-paymongo-payment-lifecycle.md`
  - Tracks PayMongo lifecycle gaps and verification.

### API Shared Services

- Modify: `api-shared-services/gcp/gke/00-shared-services.yaml`
  - Tracks shared-service image tags and environment secret names.
- Modify: `api-shared-services/docs/shared-services-production-readiness-plan.md`
  - Tracks SDK smoke and production traffic controls.
- Modify: `api-shared-services/docs/shared-service-database-schemas.md`
  - Records Supabase schema state and runtime persistence rules.
- Test: `api-shared-services/tests/shared-services/payment-store.test.ts`
  - Covers payment store DB, memory, and disabled modes.
- Test: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`
  - Covers checkout, webhook, cancellation, status, refund, and failure behavior.

### API Center Management

- Modify: `apicenter-management/src/components/service-detail-client.tsx`
  - Keeps onboarding status and provisioning actions aligned.
- Modify: `apicenter-management/src/components/confluent-provisioning-card.tsx`
  - Shows topic/S3 check status clearly.
- Modify: `apicenter-management/src/components/shared-service-smoke-tests.tsx`
  - Runs safe and provider-impacting checks with clear states.
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
  - Records operator flow after the work is complete.
- Modify: `apicenter-management/docs/operations/local-smoke-testing.md`
  - Records local test flow for tribe/shared services.
- Create or modify tests under `apicenter-management/src/**/__tests__` or existing test folders.
  - Covers route-level rendering for tribe detail sections and provisioning status states.

---

## Phase 1: Deployment State And Latest Image Verification

**Outcome:** Know exactly what code is live in test and prod before changing DB or payment settings.

### Task 1.1: Confirm Git And Image State

**Repos:** `api-center`, `api-shared-services`, `apicenter-management`

- [x] **Step 1: Check git state in each repo**

```powershell
cd C:\Codes\apic\api-center
git status --short
git log -1 --oneline

cd C:\Codes\apic\api-shared-services
git status --short
git log -1 --oneline

cd C:\Codes\apic\apicenter-management
git status --short
git log -1 --oneline
```

Expected:

```text
No unexpected uncommitted source changes.
Latest commits match the intended pushed work.
```

Verified on 2026-05-16:

```text
api-center: main at 29ef3bd, only this plan file was uncommitted.
api-shared-services: main at 50f5ee6, clean.
apicenter-management: main at a760d98, clean.
```

- [x] **Step 2: Check current manifest image tags**

```powershell
cd C:\Codes\apic
Select-String -Path api-center\gcp\gke\30-deployment.yaml -Pattern "image:"
Select-String -Path api-shared-services\gcp\gke\00-shared-services.yaml -Pattern "image:"
```

Expected:

```text
API Center image points at the intended latest tag.
Shared payment service image points at the intended latest tag.
Other shared-service images are intentionally unchanged.
```

Verified on 2026-05-16:

```text
API Center image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:db-cutover-20260516
Payment image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/shared-payment-service:db-cutover-20260516
Other shared-service images remain on migration-20260516.
```

### Task 1.2: Confirm Cloud Build Or Docker Push Completed

**Files:** no code edits

- [x] **Step 1: Check Cloud Build history**

```powershell
gcloud builds list --project api-center-496422 --region asia-southeast1 --limit 10
```

Expected:

```text
The latest API Center and shared payment image builds are SUCCESS.
```

Verified on 2026-05-16:

```text
bf6d32a9-9d8f-44ba-80a4-527bbd1993f5  api-center:db-cutover-20260516              SUCCESS
577df8ca-ba2b-4a80-8160-b9b4184d1b43  shared-payment-service:db-cutover-20260516  SUCCESS
```

- [x] **Step 2: If a build is missing, submit only the missing image**

API Center:

```powershell
cd C:\Codes\apic\api-center
gcloud builds submit --project api-center-496422 --region asia-southeast1 --config C:\tmp\api-center-cloudbuild.yaml .
```

Shared payment service:

```powershell
cd C:\Codes\apic\api-shared-services
gcloud builds submit --project api-center-496422 --region asia-southeast1 --config C:\tmp\shared-payment-cloudbuild.yaml .
```

Expected:

```text
Build status: SUCCESS
```

No new build was needed because both target images already exist with successful Cloud Build records.

### Task 1.3: Redeploy Test First, Then Prod

**Files:** no code edits unless image tags are wrong

- [x] **Step 1: Deploy test API Center and test shared services**

```powershell
kubectl apply -n api-center-test -f C:\Codes\apic\api-center\gcp\gke
kubectl apply -n api-center-test -f C:\Codes\apic\api-shared-services\gcp\gke\00-shared-services.yaml
kubectl rollout status deployment/api-center -n api-center-test --timeout=180s
kubectl rollout status deployment/payment-service -n api-center-test --timeout=180s
```

Expected:

```text
deployment "api-center" successfully rolled out
deployment "payment-service" successfully rolled out
```

Verified on 2026-05-16:

```text
api-center-test/api-center runs api-center:db-cutover-20260516.
api-center-test/payment-service runs shared-payment-service:db-cutover-20260516.
Both deployments have ready pods.
```

- [x] **Step 2: Verify test readiness**

```powershell
curl.exe -sS https://api-center-test.itsandbox.site/api/v1/health/ready
```

Expected:

```json
{"status":"ok"}
```

Verified on 2026-05-16: public test readiness returned `status: ok` with Kafka, Redis, registry, and circuit breakers healthy.

- [x] **Step 3: Deploy prod only after test readiness passes**

```powershell
kubectl apply -n api-center -f C:\Codes\apic\api-center\gcp\gke
kubectl apply -n api-center -f C:\Codes\apic\api-shared-services\gcp\gke\00-shared-services.yaml
kubectl rollout status deployment/api-center -n api-center --timeout=180s
kubectl rollout status deployment/payment-service -n api-center --timeout=180s
```

Expected:

```text
deployment "api-center" successfully rolled out
deployment "payment-service" successfully rolled out
```

Verified on 2026-05-16:

```text
api-center/api-center runs api-center:db-cutover-20260516 with 2 ready pods.
api-center/payment-service runs shared-payment-service:db-cutover-20260516 with 1 ready pod.
```

- [x] **Step 4: Verify prod readiness**

```powershell
curl.exe -sS https://api-center.itsandbox.site/api/v1/health/ready
```

Expected:

```json
{"status":"ok"}
```

Verified on 2026-05-16: public prod readiness returned `status: ok` with Kafka, Redis, registry, and circuit breakers healthy.

- [ ] **Step 5: Commit docs if manifest tags or deployment notes changed**

```powershell
cd C:\Codes\apic\api-center
git add gcp/gke/30-deployment.yaml docs/deployment-gke.md
git commit -m "docs: record latest deployment verification"
git push
```

---

## Phase 2: Test Supabase Cutover

**Outcome:** Test API Center and test shared services can use Supabase safely while registry reads remain Redis-first until backfill and parity checks pass.

### Task 2.1: Verify Test Supabase Schemas

**Files:** Supabase SQL Editor or migrations only

- [x] **Step 1: Verify API Center test tables**

Run in the test Supabase SQL Editor:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema in ('api_center', 'shared_payment')
order by table_schema, table_name;
```

Expected:

```text
api_center registry/control-plane tables exist.
shared_payment checkout/payment lifecycle tables exist.
```

Verified on 2026-05-16 from `api-center-test`: 15 tables exist across `api_center` and `shared_payment`, including `api_center.services`, `api_center.confluent_topics`, `api_center.s3_sink_topics`, `shared_payment.checkout_sessions`, `shared_payment.payment_webhook_events`, `shared_payment.payments`, `shared_payment.receipts`, `shared_payment.receipt_line_items`, and `shared_payment.refunds`.

- [x] **Step 2: Verify required API Center columns**

```sql
select column_name
from information_schema.columns
where table_schema = 'api_center'
  and table_name = 'services'
order by ordinal_position;
```

Expected includes:

```text
service_id
service_type
base_url
status
owner_team
contact_email
event_topic
manifest
created_at
updated_at
```

Verified on 2026-05-16: `api_center.services` contains the registry identity, routing, ownership, lifecycle, health, and timestamp columns required by the current Prisma model. The concrete column name for contact is `contact`, not `contact_email`.

- [x] **Step 3: Verify required PayMongo columns**

```sql
select column_name
from information_schema.columns
where table_schema = 'shared_payment'
  and table_name = 'checkout_sessions'
order by ordinal_position;
```

Expected includes:

```text
checkout_id
tribe_id
reference_id
provider
status
amount
currency
checkout_url
created_at
updated_at
```

Verified on 2026-05-16: `shared_payment.checkout_sessions` contains provider mode, checkout/reference IDs, canonical status, amount, currency, redirect/success/cancel URLs, metadata, provider metadata, expiry, and timestamps. The concrete checkout URL column is `redirect_url`.

### Task 2.2: Verify Test Secret Values Without Printing Secrets

**Files:** GCP Secret Manager only

- [x] **Step 1: Confirm test API Center DB flags**

```powershell
$payload = gcloud secrets versions access latest --secret api-center-test --project api-center-496422 | ConvertFrom-Json
$payload.DATABASE_ENABLED
$payload.REGISTRY_SOURCE
$payload.REGISTRY_DUAL_WRITE
[bool]$payload.DATABASE_URL
```

Expected:

```text
true
redis
false
True
```

Verified on 2026-05-16 before read-source switch:

```text
DATABASE_ENABLED=true
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=true
DATABASE_URL present
```

- [x] **Step 2: Confirm test shared-service DB flags**

```powershell
$payload = gcloud secrets versions access latest --secret api-shared-services-test --project api-center-496422 | ConvertFrom-Json
$payload.SHARED_SERVICES_DATABASE_ENABLED
[bool]$payload.SHARED_SERVICES_DATABASE_URL
```

Expected:

```text
true
True
```

Verified on 2026-05-16:

```text
SHARED_SERVICES_DATABASE_ENABLED=true
SHARED_SERVICES_DATABASE_URL present
payment-service pod also has SHARED_SERVICES_DATABASE_ENABLED=true and URL present.
```

### Task 2.3: Restart Test And Verify Redis-First Safety

**Files:** no code edits

- [x] **Step 1: Sync test Kubernetes secrets**

```powershell
cd C:\Codes\apic\api-shared-services
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-test -Namespace api-center-test
```

Expected:

```text
Kubernetes secret api-shared-services-test updated in namespace api-center-test.
```

Verified by runtime state on 2026-05-16: test `payment-service` has `SHARED_SERVICES_DATABASE_ENABLED=true` and a DB URL present from the synced Kubernetes secret.

- [x] **Step 2: Restart only test deployments**

```powershell
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout restart deployment/payment-service -n api-center-test
kubectl rollout status deployment/api-center -n api-center-test --timeout=180s
kubectl rollout status deployment/payment-service -n api-center-test --timeout=180s
```

Expected:

```text
Both deployments successfully rolled out.
```

Verified on 2026-05-16: `api-center-test/api-center` was restarted after the test secret version update and rolled out successfully. `payment-service` was already running with DB env present, so no additional payment restart was required for this verification.

- [x] **Step 3: Confirm test registry still responds**

```powershell
curl.exe -sS https://api-center-test.itsandbox.site/api/v1/health/ready
```

Expected:

```json
{"status":"ok"}
```

Verified on 2026-05-16: test readiness returned `status: ok` with registry up and `registeredServices: 7`.

### Task 2.4: Backfill Test Registry And Switch Test Reads

**Files:** `api-center/scripts/backfill-registry-to-postgres.ts`

- [x] **Step 1: Run test backfill from a context that can reach Redis and Supabase**

```powershell
cd C:\Codes\apic\api-center
npm run db:backfill:registry
```

Expected:

```text
Backfill completed with registered service count matching Redis registry count.
```

Verified on 2026-05-16: local backfill timed out because Memorystore is private, so the same compiled backfill logic was run inside the `api-center-test` API Center pod. Result: `Backfilled registry services: 7`.

- [x] **Step 2: Set test dual-write on**

Update `api-center-test` in Secret Manager:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Expected:

```text
Redis remains read source; mutations also write to Supabase.
```

Verified on 2026-05-16: test had `REGISTRY_DUAL_WRITE=true` before the read-source switch.

- [x] **Step 3: Restart test API Center**

```powershell
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout status deployment/api-center -n api-center-test --timeout=180s
```

Expected:

```text
deployment "api-center" successfully rolled out
```

Verified on 2026-05-16 after test secret update.

- [x] **Step 4: Switch test read source after parity check**

Only after Redis and Supabase service counts match, update `api-center-test`:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "postgres",
  "REGISTRY_DUAL_WRITE": "true"
}
```

- [x] **Step 5: Verify test with Postgres reads**

```powershell
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout status deployment/api-center -n api-center-test --timeout=180s
curl.exe -sS https://api-center-test.itsandbox.site/api/v1/health/ready
```

Expected:

```json
{"status":"ok"}
```

Verified on 2026-05-16: `api-center-test` Secret Manager version 7 sets `REGISTRY_SOURCE=postgres`, `REGISTRY_DUAL_WRITE=true`, and `DATABASE_ENABLED=true`. Test API Center logs show `Registry hydrated 7 service(s) from Postgres`; public readiness returned `status: ok`.

---

## Phase 3: PayMongo Lifecycle Test Validation

**Outcome:** Test PayMongo checkout, webhook, status, cancellation, and persistence are proven before live PayMongo traffic depends on the new lifecycle path.

### Task 3.1: Finish Missing PayMongo Tests

**Files:**

- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`
- Modify: `api-shared-services/tests/shared-services/payment-store.test.ts`

- [x] **Step 1: Add failed webhook test**

Add a test that sends a signed PayMongo payment failed webhook and asserts:

```text
checkout status becomes failed
webhook event id is stored once
second delivery of the same event id is ignored
```

Implemented on 2026-05-16 in `api-shared-services/tests/shared-services/paymongo-provider.test.ts`.

- [x] **Step 2: Add refund webhook test**

Add a test that sends a signed PayMongo refund updated webhook and asserts:

```text
refund provider id is recorded
checkout status remains canonical and not overwritten by unrelated data
raw secret values are not persisted
```

Implemented on 2026-05-16 in `api-shared-services/tests/shared-services/paymongo-provider.test.ts`; response redaction is asserted by checking the webhook secret does not appear in the webhook response.

- [x] **Step 3: Add paid-cannot-cancel test**

Add a test that creates a paid checkout session and calls cancellation. Expected:

```text
service rejects cancellation or returns unchanged paid status
```

Implemented on 2026-05-16 in `api-shared-services/tests/shared-services/paymongo-provider.test.ts`; the cancellation route returns `409` and the checkout remains `paid`.

- [x] **Step 4: Run focused tests**

```powershell
cd C:\Codes\apic\api-shared-services
npm run test -- tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts
```

Expected:

```text
All PayMongo persistence tests pass.
```

Verified on 2026-05-16:

```text
npm run test -- tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts
Test Files  2 passed (2)
Tests       24 passed (24)
```

Initial sandboxed run hit the known Windows/Vite `spawn EPERM` startup issue; the same focused command passed outside the sandbox.

### Task 3.2: Run Test Checkout Smoke

**Files:** no source edits unless smoke reveals a bug

- [x] **Step 1: Open local management smoke tests**

```powershell
cd C:\Codes\apic\apicenter-management
npm run dev -- --turbo
```

Open:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Verified on 2026-05-16: `apicenter-management/.env.local` was pointed at
`https://api-center-test.itsandbox.site` and `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=test.`.
The local Next dev server could not be opened because this Windows session hit
the known Next `spawn EPERM` child-process failure, even when retried outside
the sandbox. The same smoke flow was run through the management/API Center
routes directly.

- [x] **Step 2: Request a token for the test tribe**

Expected:

```text
Temporary token issued.
```

Verified on 2026-05-16: rotated
`api-center-test-tribe-secret-smoke-tribe` to a fresh generated test secret,
restarted `api-center-test/api-center` to clear the 300-second resolver cache,
waited for public readiness to return HTTP 200, and successfully issued a token
for `smoke-tribe`.

- [x] **Step 3: Run PayMongo test checkout**

Use PayMongo test mode only. Expected:

```text
Checkout session is created.
Status API returns pending or paid depending on test flow.
No live PayMongo key is used.
```

Verified on 2026-05-16:

```text
Checkout ID: cs_735d379f0b2f5d7c23267761
Reference ID: smoke-order-1778916926077
Initial checkout status: pending
Provider mode verified later from Supabase row: test
```

- [x] **Step 4: Trigger or replay PayMongo test webhook**

Expected:

```text
Webhook returns success.
shared_payment checkout row changes to the expected status.
Duplicate webhook delivery is ignored.
```

Verified on 2026-05-16:

```text
Webhook event: checkout_session.payment.paid
Webhook status: paid
Duplicate replay ignored: true
Final status API result: paid
```

### Task 3.3: Verify Test Supabase And S3 Rows

**Files:** no source edits

- [x] **Step 1: Verify Supabase payment row**

Run in test Supabase SQL Editor:

```sql
select tribe_id, reference_id, provider, status, amount, currency, created_at, updated_at
from shared_payment.checkout_sessions
order by created_at desc
limit 10;
```

Expected:

```text
Latest smoke checkout row is present for the test tribe.
```

Verified on 2026-05-16 against test Supabase:

```text
tribe_id: smoke-tribe
reference_id: smoke-order-1778916926077
checkout_id: cs_735d379f0b2f5d7c23267761
provider: paymongo
provider_mode: test
status: paid
amount: 10000
currency: PHP
```

The matching `shared_payment.payment_webhook_events` row exists with
`event_type=checkout_session.payment.paid`, `status=processed`, and metadata
containing the same checkout ID.

- [ ] **Step 2: Verify S3 export topic for payment**

Look under the Confluent S3 sink output prefix for:

```text
topics/test.api-center.shared.payment.events/
```

Expected:

```text
At least one sanitized payment event exists.
No raw secret key, bearer token, OTP, OAuth code, full email body, or full SMS body appears.
```

Blocked on 2026-05-16 for direct object inspection: this Windows workspace has
no AWS CLI, boto3/botocore, or AWS PowerShell module installed, and unsigned S3
listing for `api-center-raw-data` returns `AccessDenied`.

Reachable upstream export checks passed:

```text
Kafka metric: kafka_publish_operations_total{topic="test.api-center.shared.payment.events",outcome="success"} 4
Kafka producer: kafka_producer_connected 1
Confluent topic exists: true
S3 sink includes topic: true
S3 sink connector: api-center-s3-sink RUNNING
S3 sink task: RUNNING
Configured connector topic count: 55
```

---

## Phase 4: Shared-Service Topics And S3 Export Closure

**Outcome:** Every shared-service export topic is present, included in the S3 sink, and receives sanitized events through API Center.

### Task 4.1: Verify Topic And S3 Sink Inclusion

**Files:** no source edits unless provisioning UI has a bug

- [x] **Step 1: Check Confluent topics**

Use `apicenter-management` tribe/shared-service detail provisioning cards or Confluent Cloud to verify these topics:

```text
test.api-center.shared.sms.events
test.api-center.shared.email.events
test.api-center.shared.payment.events
test.api-center.shared.otp.events
test.api-center.shared.geo.events
test.api-center.shared.gauth.events
prod.api-center.shared.sms.events
prod.api-center.shared.email.events
prod.api-center.shared.payment.events
prod.api-center.shared.otp.events
prod.api-center.shared.geo.events
prod.api-center.shared.gauth.events
```

Expected:

```text
All twelve environment-prefixed shared-service export topics exist.
```

Verified on 2026-05-16 through Confluent Cloud REST:

```text
test.api-center.shared.sms.events      exists
test.api-center.shared.email.events    exists
test.api-center.shared.payment.events  exists
test.api-center.shared.otp.events      exists
test.api-center.shared.geo.events      exists
test.api-center.shared.gauth.events    exists
prod.api-center.shared.sms.events      exists
prod.api-center.shared.email.events    exists
prod.api-center.shared.payment.events  exists
prod.api-center.shared.otp.events      exists
prod.api-center.shared.geo.events      exists
prod.api-center.shared.gauth.events    exists
```

- [x] **Step 2: Check S3 sink connector topic list**

Expected:

```text
api-center-s3-sink includes all test/prod shared-service export topics.
Connector status is RUNNING.
Task 0 status is RUNNING.
```

Verified on 2026-05-16:

```text
Connector: api-center-s3-sink
Connector state: RUNNING
Task states: RUNNING
All twelve test/prod shared-service export topics are included.
Configured connector topic count: 55
```

### Task 4.2: Run One Safe Call Per Shared Service

**Files:** no source edits unless a service fails

- [x] **Step 1: Run safe smoke checks in test**

From:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Run safe checks for:

```text
gauth
geo
payment
email
sms
otp
```

Expected:

```text
Safe checks pass or return a clear provider/test-account warning.
API Center stays ready.
```

Verified on 2026-05-16 by running one safe `/health` call per shared service
through `https://api-center-test.itsandbox.site` with a fresh `smoke-tribe`
token:

```text
gauth    HTTP 200  status=ok  provider=google configured=true
geo      HTTP 200  status=ok  service=geo-gateway mode=google-maps
payment  HTTP 200  status=ok  providerMode=test providerName=paymongo
email    HTTP 200  status=ok  resendEnabled=true
sms      HTTP 200  status=ok  mode=mock
otp      HTTP 200  status=ok  mode=mock
```

API Center readiness after the checks remained `status=ok`.

Kafka publish metrics after the checks:

```text
test.api-center.shared.gauth.events    success=1
test.api-center.shared.geo.events      success=1
test.api-center.shared.payment.events  success=1
test.api-center.shared.email.events    success=1
test.api-center.shared.sms.events      success=1
test.api-center.shared.otp.events      success=1
```

- [ ] **Step 2: Verify S3 folders**

Expected S3 topic folders:

```text
topics/test.api-center.shared.gauth.events/
topics/test.api-center.shared.geo.events/
topics/test.api-center.shared.payment.events/
topics/test.api-center.shared.email.events/
topics/test.api-center.shared.sms.events/
topics/test.api-center.shared.otp.events/
```

Expected:

```text
Each folder has at least one recent object after the smoke run.
```

Blocked on 2026-05-16 for direct S3 object inspection from this workspace:

```text
AWS CLI: not installed
boto3/botocore: not installed
AWS PowerShell modules: not installed
Unsigned S3 list request: AccessDenied
```

Reachable upstream checks passed for all six test shared-service topics:

```text
API Center published each test shared-service event topic successfully.
All six test shared-service topics exist in Confluent.
All six test shared-service topics are included in api-center-s3-sink.
api-center-s3-sink connector and task are RUNNING.
```

### Task 4.3: Decide Old Topic Cleanup

**Files:** update docs only after decision

- [x] **Step 1: List unprefixed topics**

Expected candidates:

```text
api-center.shared.sms.events
api-center.shared.email.events
api-center.shared.payment.events
api-center.shared.otp.events
api-center.shared.geo.events
api-center.shared.gauth.events
tribe.smoke-tribe.events
tribe.servease.events
```

Verified on 2026-05-16:

```text
api-center.shared.sms.events      absent
api-center.shared.email.events    absent
api-center.shared.payment.events  absent
api-center.shared.otp.events      absent
api-center.shared.geo.events      absent
api-center.shared.gauth.events    absent
tribe.smoke-tribe.events          exists
tribe.servease.events             exists
```

- [x] **Step 2: Confirm no active deployment writes to unprefixed topics**

Expected:

```text
test writes to test.* topics.
prod writes to prod.* topics.
```

Verified on 2026-05-16 from running deployments:

```text
api-center-test/api-center KAFKA_TOPIC_PREFIX=test.
api-center/api-center      KAFKA_TOPIC_PREFIX=prod.
```

No active API Center deployment is configured to write unprefixed topics.

- [ ] **Step 3: Remove or archive unprefixed topics**

If removing:

```text
Delete only after confirming S3 has the retained historical export or the data is disposable.
```

Blocked on operator decision: only `tribe.smoke-tribe.events` and
`tribe.servease.events` remain as unprefixed historical topics. Do not delete
or archive them until the operator confirms their historical data is disposable
or retained in S3.

- [ ] **Step 4: Update `api-center/docs/confluent-cloud-s3-sink-setup.md`**

Document:

```text
Use environment-prefixed topics only for new writes.
Unprefixed topics are historical or deleted.
```

---

## Phase 5: Production Supabase Cutover

**Outcome:** Live API Center moves to Supabase-backed registry reads only after migrations, backfill, and parity checks pass. Shared-service persistence is enabled service by service.

### Task 5.1: Verify Live Supabase Is Separate

**Files:** GCP Secret Manager and Supabase only

- [x] **Step 1: Compare test and prod DB URLs without printing full values**

```powershell
$test = gcloud secrets versions access latest --secret api-center-test --project api-center-496422 | ConvertFrom-Json
$prod = gcloud secrets versions access latest --secret api-center-prod --project api-center-496422 | ConvertFrom-Json
$testRef = ($test.DATABASE_URL -replace '^.*postgres\\.','' -replace ':.*$','')
$prodRef = ($prod.DATABASE_URL -replace '^.*postgres\\.','' -replace ':.*$','')
$testRef
$prodRef
```

Expected:

```text
Test and prod project refs are different.
```

Verified on 2026-05-16:

```text
Test and prod DB URLs point at separate Supabase project refs.
api-center-prod initially had a malformed DATABASE_URL.
api-center-prod was corrected to the valid live shared-services DB URL in Secret Manager version 8.
```

- [x] **Step 2: Verify live schemas**

Run the same schema checks from Phase 2 against live Supabase.

Expected:

```text
api_center and shared_payment schemas exist in live Supabase.
```

Verified on 2026-05-16:

```text
Live migrations were applied for:
- api-center/supabase/migrations/20260515000000_init_control_plane.sql
- api-shared-services/supabase/migrations/20260516000000_init_shared_service_schemas.sql

Live schemas exist:
api_center, api_center_audit, api_center_ops, shared_email, shared_gauth,
shared_geo, shared_otp, shared_payment, shared_sms

Live table checks found 15 API Center/payment tables.
```

### Task 5.2: Enable Live Dual-Write With Redis Reads

**Files:** GCP Secret Manager only

- [x] **Step 1: Update `api-center-prod`**

Set:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Verified on 2026-05-16:

```text
api-center-prod Secret Manager version 8 set:
DATABASE_ENABLED=true
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=true
```

- [x] **Step 2: Restart live API Center**

```powershell
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center --timeout=180s
curl.exe -sS https://api-center.itsandbox.site/api/v1/health/ready
```

Expected:

```json
{"status":"ok"}
```

Verified on 2026-05-16:

```text
Live API Center rolled out successfully.
Readiness returned status=ok with registeredServices=7.
```

- [x] **Step 3: Backfill live registry**

```powershell
cd C:\Codes\apic\api-center
npm run db:backfill:registry
```

Expected:

```text
Backfill count matches live registry count.
```

Verified on 2026-05-16:

```text
The Prisma backfill path hit a Supabase pooler interactive transaction timeout:
Failed to backfill geo: Transaction API error: Unable to start a transaction in the given time.

Direct SQL backfill from the live Redis registry was used instead.
Backfill counts:
- services: 7
- routes: 25
- scopes: 17
- dependencies: 6

Backfilled service ids:
email, gauth, geo, otp, payment, smoke-tribe, sms
```

### Task 5.3: Switch Live Reads To Postgres

**Files:** GCP Secret Manager only

- [x] **Step 1: Set live registry source**

Set in `api-center-prod`:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "postgres",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Verified on 2026-05-16:

```text
api-center-prod Secret Manager version 9 set:
DATABASE_ENABLED=true
REGISTRY_SOURCE=postgres
REGISTRY_DUAL_WRITE=true
```

- [x] **Step 2: Restart live API Center**

```powershell
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center --timeout=180s
curl.exe -sS https://api-center.itsandbox.site/api/v1/health/ready
```

Expected:

```json
{"status":"ok"}
```

Verified on 2026-05-16:

```text
Live API Center rolled out successfully after switching reads to Postgres.
Readiness returned status=ok with registeredServices=7.
Logs confirmed: Registry hydrated 7 service(s) from Postgres.
```

- [x] **Step 3: Verify live registry through management console**

Open:

```text
http://localhost:3000/tribes
```

Expected:

```text
All registered tribe and shared-service manifests still appear.
No missing shared services.
No broken dependency alerts caused by the read-source switch.
```

Verified on 2026-05-16:

```text
The live registry endpoint was verified with the admin secret.
It returned 7 services, including all shared services.

The local management console UI could not be used for this check because the
Windows session still hits the known Next/Vite spawn EPERM process failure.
The backend registry state needed by the management console was verified directly.
```

### Task 5.4: Enable Shared-Service Persistence Service By Service

**Files:** GCP Secret Manager, Kubernetes secret sync

- [x] **Step 1: Start with payment service**

Confirm `api-shared-services-prod`:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true"
}
```

Verified on 2026-05-16:

```text
api-shared-services-prod was updated to SHARED_SERVICES_DATABASE_ENABLED=true in Secret Manager version 12.
SHARED_SERVICES_DATABASE_URL is present.
The running payment-service pod has SHARED_SERVICES_DATABASE_ENABLED=true.
```

- [x] **Step 2: Sync and restart only payment**

```powershell
cd C:\Codes\apic\api-shared-services
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-prod -Namespace api-center
kubectl rollout restart deployment/payment-service -n api-center
kubectl rollout status deployment/payment-service -n api-center --timeout=180s
```

Expected:

```text
payment-service successfully rolled out.
```

Verified on 2026-05-16:

```text
Synced api-shared-services-prod into the api-center Kubernetes secret.
Restarted only deployment/payment-service.
Rollout status succeeded.
payment-service is 1/1 ready on image:
asia-southeast1-docker.pkg.dev/api-center-496422/api-center/shared-payment-service:db-cutover-20260516

Internal pod health returned HTTP 200:
{"success":true,"data":{"status":"ok","service":"paymongo-gateway","providerMode":"true","providerName":"paymongo"}}

No recent payment-service log lines matched:
error, failed, exception, panic, timeout
```

- [x] **Step 3: Verify live PayMongo rows**

Run in live Supabase SQL Editor:

```sql
select tribe_id, reference_id, status, created_at, updated_at
from shared_payment.checkout_sessions
order by created_at desc
limit 10;
```

Expected:

```text
Rows appear only after controlled live checkout tests.
No test checkout rows appear in live Supabase.
```

Verified on 2026-05-16:

```text
Read-only live Supabase query:
shared_payment.checkout_sessions total=0
provider_mode=test rows=0
provider_mode=live rows=0

No controlled live checkout was run. Running a live PayMongo checkout is
provider-impacting and requires explicit operator approval.
```

---

## Phase 6: Management Console Hardening

**Outcome:** Operators can onboard, provision, test, and inspect services without confusing states or brittle local-only behavior.

### Task 6.1: Add Route-Level UI Coverage

**Files:**

- Test: `apicenter-management/src/components/service-detail-client.test.tsx`
- Test: `apicenter-management/src/components/confluent-provisioning-card.test.tsx`

- [x] **Step 1: Test tribe detail sections**

Cover:

```text
/tribes/:serviceId default overview
/tribes/:serviceId?section=onboarding
/tribes/:serviceId?section=observability
/tribes/:serviceId?section=lifecycle
/tribes/:serviceId?section=developer
```

Expected:

```text
Each section renders the expected primary card and actions.
```

Implemented on 2026-05-16:

```text
Added apicenter-management/src/components/service-detail-client.test.tsx.
The tests cover:
- /tribes/:serviceId default overview
- /tribes/:serviceId?section=onboarding
- /tribes/:serviceId?section=observability
- /tribes/:serviceId?section=lifecycle
- /tribes/:serviceId?section=developer

Each route-level section asserts the active tab and a primary section card/action.
```

- [x] **Step 2: Test Confluent status states**

Cover:

```text
not checked
checking
done
failed
pending
```

Expected:

```text
The UI never shows "Done" before a status check or successful provision response.
```

Implemented on 2026-05-16:

```text
Added Vitest/jsdom React test harness for apicenter-management.
Added apicenter-management/src/components/confluent-provisioning-card.test.tsx.
Updated the Confluent provisioning card labels:
- Checking
- Done
- Pending
- Not checked
- Failed

The tests verify "Done" appears only after the Confluent topic or S3 sink
resource is confirmed by a successful status response or mutation evidence.
```

- [x] **Step 3: Run management tests**

```powershell
cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
npm run build
```

Expected:

```text
Lint, typecheck, and build pass.
```

Verified on 2026-05-16:

```text
npm test -- src/components/service-detail-client.test.tsx src/components/confluent-provisioning-card.test.tsx
Test Files 2 passed
Tests 10 passed

npm run lint
exit 0

npx tsc --noEmit
exit 0

npm run build
Next.js 16.2.6 production build completed successfully.
```

### Task 6.2: Finish Deprovisioning Cloud Permission Decision

**Files:**

- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`

- [ ] **Step 1: Decide whether UI can delete tribe secrets**

Option A:

```text
Grant management provisioner secretmanager.secrets.delete.
UI deprovision action can delete per-tribe Secret Manager secrets.
```

Option B:

```text
Do not grant delete.
UI deprovision action only deregisters and removes Confluent/S3 references.
Operator deletes secrets manually.
```

Blocked on operator decision as of 2026-05-16:

```text
The UI currently exposes "Delete tribe credential secret" and the local route
has a DELETE handler, but the documented custom role only grants:
secretmanager.secrets.create, secretmanager.secrets.get, secretmanager.versions.add

It does not grant secretmanager.secrets.delete.

Do not grant this permission or remove the UI action without an explicit
operator policy decision.
```

- [ ] **Step 2: Document the selected behavior**

Expected:

```text
Runbook says exactly what deregister, deprovision topic, remove from S3 sink, and secret deletion do.
```

### Task 6.3: Make The Onboarding Flow Less Fragmented

**Files:**

- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`

- [x] **Step 1: Keep the tribe detail Onboarding tab as the source of truth**

Expected UI:

```text
Manifest registered
Owner and contact set
Health path set
Tribe secret provisioned
Confluent topic created
Topic added to S3 sink
Token and safe smoke checks
Usage and audit checked
```

Verified on 2026-05-16:

```text
apicenter-management/src/components/tribe-onboarding-flow.tsx is rendered from
the tribe detail Onboarding tab and includes:
- Manifest registered
- Owner and contact set
- Health path set
- Tribe secret provisioned
- Confluent topic created
- Topic added to S3 sink
- Token and safe smoke checks
- Usage and audit checked
```

- [x] **Step 2: Ensure every step has an action or read-only status**

Expected:

```text
No step appears as completed unless the app has evidence.
No step appears as failed unless the last check failed.
Pending steps say what operator action is required.
```

Verified on 2026-05-16:

```text
The onboarding flow statuses are complete, pending, checking, blocked, and unknown.
Labels render as Done, Pending, Checking, Needs access, and Not checked.
Manifest, owner/contact, health, smoke-test, and usage/audit rows include direct actions.
Secret, Confluent topic, and S3 sink rows are read-only evidence checks with
their action cards below the checklist in the same Onboarding tab.
```

---

## Phase 7: Production Smoke And Release Gate

**Outcome:** The platform is considered ready only after controlled smoke checks prove gateway, shared services, DB, Confluent, S3, usage, audit, and alerts.

### Task 7.1: Run Full Test Smoke

**Files:** no source edits unless smoke reveals a bug

- [ ] **Step 1: Register or reuse a test tribe**

Expected:

```text
Test tribe exists in API Center test registry.
Per-tribe Secret Manager hash exists.
Confluent topic exists.
Topic is included in S3 sink.
```

- [ ] **Step 2: Run one safe SDK/API call per shared service**

Expected:

```text
gauth, geo, payment, email, sms, and otp safe checks pass through API Center.
```

- [ ] **Step 3: Confirm runtime signals**

Open:

```text
http://localhost:3000/shared-services/usage
http://localhost:3000/audit
http://localhost:3000/alerts
http://localhost:3000/cost
```

Expected:

```text
Usage increased for the test tribe.
Audit has recent events.
Alerts do not show new critical failures.
Cost signals do not show unexpected provider-impacting runs.
```

### Task 7.2: Run Controlled Prod Smoke

**Files:** no source edits unless smoke reveals a bug

- [ ] **Step 1: Use a dedicated live smoke tribe**

Expected:

```text
Live smoke tribe is registered in prod.
Live tribe secret is separate from test.
Live PayMongo uses live mode only when the operator explicitly runs a live payment test.
```

- [ ] **Step 2: Run non-provider-impacting live checks first**

Expected:

```text
Health, registry, token, gauth URL creation, and geo checks pass.
```

- [ ] **Step 3: Run provider-impacting live checks only when approved**

Expected:

```text
Email/SMS/PayMongo/OTP provider calls are deliberate and recorded.
```

### Task 7.3: Release Gate

- [ ] **Step 1: Confirm release criteria**

Required:

```text
Test API Center readiness passes.
Prod API Center readiness passes.
Test registry works after Supabase cutover.
Prod registry works after Supabase cutover.
PayMongo test checkout persists to test Supabase.
Shared-service export events land in S3.
Management console onboarding statuses match actual resources.
No old self-managed Kafka fallback is active.
No raw secrets are committed or shown in user-facing toasts.
```

- [ ] **Step 2: Commit and push docs updates**

```powershell
cd C:\Codes\apic\api-center
git add docs
git commit -m "docs: consolidate unfinished platform work"
git push

cd C:\Codes\apic\api-shared-services
git add docs tests
git commit -m "docs: update shared-service readiness state"
git push

cd C:\Codes\apic\apicenter-management
git add docs src
git commit -m "test: harden management onboarding flows"
git push
```

Expected:

```text
Each repo has either a committed change or a clean working tree with no commit needed.
```

---

## Phase 8: Stale Plan Cleanup

**Outcome:** Old plan files no longer mislead operators by showing unchecked steps that are already implemented.

### Task 8.1: Normalize Plan Status

**Files:**

- Modify: `api-center/docs/superpowers/plans/2026-05-16-gcp-project-redeploy-migration.md`
- Modify: `api-center/docs/superpowers/plans/2026-05-16-supabase-prod-database-migration.md`
- Modify: `api-center/docs/superpowers/plans/2026-05-16-hybrid-paymongo-payment-lifecycle.md`
- Modify: `apicenter-management/docs/superpowers/plans/2026-05-14-internal-tribe-token-auth.md`
- Modify: `apicenter-management/docs/superpowers/plans/2026-05-14-management-smoke-tests-and-form-ux.md`
- Modify: `apicenter-management/docs/superpowers/plans/2026-05-14-management-ux-flow-improvements.md`
- Modify: `apicenter-management/docs/superpowers/plans/2026-05-15-shared-service-topics-s3-export.md`

- [ ] **Step 1: Add a status block to each stale plan**

Use this format:

```markdown
## Current Status

- Completed:
  - ...
- Still tracked by active plan:
  - `api-center/docs/superpowers/plans/2026-05-16-unfinished-platform-work.md`
- No longer active:
  - ...
```

- [ ] **Step 2: Do not delete old plans**

Expected:

```text
Old plans remain as historical implementation records.
This consolidated plan becomes the active unfinished-work tracker.
```

- [ ] **Step 3: Update runbooks to point at this plan**

Files:

```text
api-center/docs/deployment-gke.md
api-center/docs/database-control-plane.md
api-shared-services/docs/shared-services-production-readiness-plan.md
apicenter-management/docs/operations/apicenter-management-runbook.md
```

Expected:

```text
Runbooks reference this plan for remaining platform work.
```

---

## Verification Commands

Run before marking the plan complete:

```powershell
cd C:\Codes\apic\api-center
npm run lint
npm run test -- src/config/config.service.spec.ts src/registry/registry.service.spec.ts src/registry/postgres-registry-store.service.spec.ts src/kafka/kafka.service.spec.ts src/shared/proxy-handler.spec.ts
npm run build

cd C:\Codes\apic\api-shared-services
npm run typecheck
npm run test -- tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts

cd C:\Codes\apic\apicenter-management
npm run lint
npx tsc --noEmit
npm run build
```

Expected:

```text
All commands exit 0.
Any Windows file-lock or spawn EPERM failure is documented separately and rerun after closing the locking process.
```

## Completion Criteria

- Latest API Center and payment-service images are built, pushed, deployed, and healthy in test and prod.
- Test Supabase registry cutover is complete.
- Prod Supabase registry cutover is complete.
- Shared-service PayMongo persistence is verified in test before live.
- Shared-service export topics are present and S3 receives sanitized events.
- Management console onboarding state reflects actual Secret Manager, Confluent, S3 sink, token, usage, and audit status.
- Docs and stale plan status blocks are updated.
- Future analytics pipeline remains in its separate plan and is not part of this completion gate.
