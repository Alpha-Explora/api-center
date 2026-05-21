# Supabase Live/Test Database Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move API Center and shared services from Redis-only runtime state to Supabase-backed durable state while keeping live and test isolated.

**Architecture:** Keep the same environment variable names in both environments, but point them at different Supabase databases through different GCP Secret Manager secrets. Test cuts over first using the `api-center-test` and `api-shared-services-test` secrets; live follows only after test passes migration, backfill, smoke, and rollback checks.

**Tech Stack:** NestJS, Prisma, Supabase Postgres, Redis, GKE namespaces, GCP Secret Manager, Confluent Cloud, Next.js management console.

---

## Current State

The database schema and migration files already exist, but runtime is not using Supabase yet.

Verified current deployment shape:

```text
GKE cluster: api-center
Live namespace: api-center
Test namespace: api-center-test
```

Verified current secrets:

```text
api-center-prod:
  DATABASE_URL: absent
  DATABASE_ENABLED: absent
  REGISTRY_SOURCE: absent

api-center-test:
  DATABASE_URL: absent
  DATABASE_ENABLED: absent
  REGISTRY_SOURCE: absent

api-shared-services-prod:
  SHARED_SERVICES_DATABASE_ENABLED=false

api-shared-services-test:
  SHARED_SERVICES_DATABASE_ENABLED=false
```

Verified current code:

```text
api-center/src/database/prisma.service.ts exists
api-center/src/registry/postgres-registry-store.service.ts exists
api-center/src/config/config.service.ts exposes database flags
api-center/src/registry/registry.service.ts still uses Redis as the active store
```

## Decision

Use the same env shape in live and test, but different secret values:

```text
Live:
  api-center-prod.DATABASE_URL=<live Supabase pooled URL>
  api-shared-services-prod.SHARED_SERVICES_DATABASE_URL=<live Supabase pooled URL>

Test:
  api-center-test.DATABASE_URL=<test Supabase pooled URL>
  api-shared-services-test.SHARED_SERVICES_DATABASE_URL=<test Supabase pooled URL>
```

The best isolation is two Supabase projects:

```text
api-center-live
api-center-test
```

If only one Supabase project is available, do not use the existing migrations for both live and test as-is. The current schemas are fixed names:

```text
api_center
api_center_ops
api_center_audit
shared_payment
shared_otp
shared_email
shared_sms
shared_geo
shared_gauth
```

Using one database for both environments would mix live and test rows unless the migrations are redesigned with environment-prefixed schemas.

## Files And Responsibilities

### API Center Repo

- `api-center/prisma/schema.prisma`
  - Defines API Center control-plane schemas.
- `api-center/supabase/migrations/*.sql`
  - SQL migrations to apply to Supabase.
- `api-center/src/database/prisma.service.ts`
  - Opens Prisma only when `DATABASE_ENABLED=true`.
- `api-center/src/config/config.service.ts`
  - Validates `DATABASE_ENABLED`, `DATABASE_URL`, and `REGISTRY_SOURCE`.
- `api-center/src/registry/registry.service.ts`
  - Currently Redis-backed registry. Needs dual-write and Postgres read-source integration.
- `api-center/src/registry/postgres-registry-store.service.ts`
  - Durable Postgres store implementation. Needs wiring into `RegistryService`.
- `api-center/docs/database-control-plane.md`
  - Operator docs for database setup and rollback.
- `api-center/docs/deployment-gke.md`
  - Secret Manager and rollout instructions.

### Shared Services Repo

- `api-shared-services/prisma/shared-services/schema.prisma`
  - Defines shared-service business schemas.
- `api-shared-services/supabase/migrations/*.sql`
  - SQL migrations to apply to Supabase.
- `api-shared-services/shared-services/paymongo/**`
  - First business service that should persist checkout/payment/receipt data.
- `api-shared-services/shared-services/otp-gateway/**`
  - Optional next service for OTP request/audit persistence.
- `api-shared-services/shared-services/email-gateway/**`
  - Optional next service for email send/audit persistence.
- `api-shared-services/shared-services/sms-gateway/**`
  - Optional next service for SMS send/audit persistence.
- `api-shared-services/docs/shared-service-database-schemas.md`
  - Operator docs for shared-service data ownership.

### Management Repo

- `apicenter-management/src/lib/api-center-client.ts`
  - Continues to call API Center APIs; should not connect directly to Supabase.
- `apicenter-management/src/app/settings/page.tsx`
  - Can display whether the selected API Center reports DB mode later.
- `apicenter-management/docs/operations/apicenter-management-runbook.md`
  - Needs live/test Supabase operation notes after cutover.

---

## Phase 1: Confirm Supabase Environments

**Goal:** Confirm test and live databases are separate before any runtime flag is enabled.

- [ ] **Step 1: Record Supabase projects**

Create or confirm these two Supabase projects:

```text
api-center-test
api-center-live
```

If the live project does not exist yet, keep live on Redis reads and do not
switch `REGISTRY_SOURCE=postgres`. `DATABASE_ENABLED=true` is acceptable only
when `DATABASE_URL` points to the intended live Supabase database and readiness
has been verified.

- [ ] **Step 2: Collect test connection strings**

From Supabase dashboard for the test project, collect:

```text
Test pooled connection string:
postgresql://postgres.<test-ref>:<password>@aws-...pooler.supabase.com:6543/postgres?pgbouncer=true

Test direct connection string:
postgresql://postgres:<password>@db.<test-ref>.supabase.co:5432/postgres
```

Use the pooled URL for runtime. Use direct only for migration tools if IPv4/networking allows it; otherwise run SQL from Supabase SQL Editor.

- [ ] **Step 3: Collect live connection strings**

From Supabase dashboard for the live project, collect:

```text
Live pooled connection string:
postgresql://postgres.<live-ref>:<password>@aws-...pooler.supabase.com:6543/postgres?pgbouncer=true

Live direct connection string:
postgresql://postgres:<password>@db.<live-ref>.supabase.co:5432/postgres
```

Do not paste either URL into frontend env files. Store them only in GCP Secret Manager.

- [ ] **Step 4: Decide migration path**

Use Supabase SQL Editor for first migration if local IPv4/direct DB access is unreliable.

Expected choice:

```text
Test: apply SQL through Supabase SQL Editor first.
Live: apply SQL through Supabase SQL Editor after test verification passes.
```

---

## Phase 2: Apply Migrations To Test

**Goal:** Create all required schemas/tables in the test Supabase database.

- [ ] **Step 1: Apply API Center control-plane migration to test**

Open:

```text
api-center/supabase/migrations/20260515000000_init_control_plane.sql
```

Paste and run it in the Supabase SQL Editor for `api-center-test`.

Expected result:

```text
Schemas created:
api_center
api_center_ops
api_center_audit
```

- [ ] **Step 2: Apply shared-service migration to test**

Open:

```text
api-shared-services/supabase/migrations/20260516000000_init_shared_service_schemas.sql
```

Paste and run it in the Supabase SQL Editor for `api-center-test`.

Expected result:

```text
Schemas created:
shared_payment
shared_otp
shared_email
shared_sms
shared_geo
shared_gauth
```

- [ ] **Step 3: Verify test schema existence**

Run this in the Supabase SQL Editor:

```sql
select schema_name
from information_schema.schemata
where schema_name in (
  'api_center',
  'api_center_ops',
  'api_center_audit',
  'shared_payment',
  'shared_otp',
  'shared_email',
  'shared_sms',
  'shared_geo',
  'shared_gauth'
)
order by schema_name;
```

Expected rows:

```text
api_center
api_center_audit
api_center_ops
shared_email
shared_gauth
shared_geo
shared_otp
shared_payment
shared_sms
```

---

## Phase 3: Add Test DB Secrets With Redis Still Active

**Goal:** Add database URLs to test secrets without changing the active registry source yet.

- [ ] **Step 1: Update `api-center-test` Secret Manager JSON**

Add these keys:

```json
{
  "DATABASE_ENABLED": "true",
  "DATABASE_URL": "<test Supabase pooled runtime URL>",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "false"
}
```

Keep `REGISTRY_SOURCE=redis` until the code supports dual-write/backfill and it has passed verification.

- [ ] **Step 2: Update `api-shared-services-test` Secret Manager JSON**

Add these keys:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true",
  "SHARED_SERVICES_DATABASE_URL": "<test Supabase pooled runtime URL>"
}
```

Keep `REGISTRY_SOURCE=redis` until API Center backfill/parity checks pass.
Shared-service DB can be enabled after the service-specific persistence path is
verified in test.

- [ ] **Step 3: Sync GKE test secrets**

Run from `api-center`:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-test -Namespace api-center-test -KubernetesSecretName api-center-test
```

Run from `api-shared-services`:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-test -Namespace api-center-test -KubernetesSecretName api-shared-services-test
```

- [ ] **Step 4: Restart test deployments**

```powershell
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout restart deployment/payment-service -n api-center-test
kubectl rollout restart deployment/email-service -n api-center-test
kubectl rollout restart deployment/sms-service -n api-center-test
kubectl rollout restart deployment/otp-service -n api-center-test
kubectl rollout restart deployment/gauth-service -n api-center-test
kubectl rollout restart deployment/geo-service -n api-center-test
```

- [ ] **Step 5: Verify test still uses Redis registry**

```powershell
kubectl exec -n api-center-test deploy/api-center -- printenv DATABASE_ENABLED
kubectl exec -n api-center-test deploy/api-center -- printenv REGISTRY_SOURCE
```

Expected:

```text
true
redis
```

---

## Phase 4: Implement API Center Registry Dual-Write

**Goal:** Make API Center write registry changes to both Redis and Postgres while Redis remains the active read source.

- [ ] **Step 1: Add `REGISTRY_DUAL_WRITE` config test**

Modify:

```text
api-center/src/config/config.service.spec.ts
```

Add a test that proves:

```text
REGISTRY_DUAL_WRITE=true -> config.database.registryDualWrite === true
REGISTRY_DUAL_WRITE absent -> config.database.registryDualWrite === false
```

- [ ] **Step 2: Add config property**

Modify:

```text
api-center/src/config/config.service.ts
```

Add:

```ts
registryDualWrite: process.env.REGISTRY_DUAL_WRITE === "true",
```

inside the existing `database` config object.

- [ ] **Step 3: Inject `PostgresRegistryStoreService` into `RegistryService`**

Modify:

```text
api-center/src/registry/registry.service.ts
```

Add constructor dependency:

```ts
private readonly postgresStore: PostgresRegistryStoreService,
```

Import:

```ts
import { PostgresRegistryStoreService } from "./postgres-registry-store.service";
```

- [ ] **Step 4: Dual-write on registration**

In `RegistryService.register`, after Redis persistence succeeds and before Kafka event publish, write:

```ts
if (this.config.database.enabled && this.config.database.registryDualWrite) {
  await this.postgresStore.upsert(entry);
}
```

If Postgres write fails, throw and roll back memory to the previous entry. Redis rollback should call `persistToRedisStrict` for previous entry or `deleteFromRedisStrict` for new entry.

- [ ] **Step 5: Dual-write on lifecycle changes**

Apply the same dual-write pattern to:

```text
deregister
deprecate
retire
activate
updateHealth
```

Expected behavior:

```text
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=true
```

reads from Redis, writes to Redis and Postgres.

- [ ] **Step 6: Add registry dual-write tests**

Modify:

```text
api-center/src/registry/registry.service.spec.ts
```

Add tests for:

```text
register writes Postgres when dual-write is enabled
register does not write Postgres when dual-write is disabled
Postgres failure rejects registration and restores in-memory registry
```

- [ ] **Step 7: Run API Center tests**

```powershell
npx jest src/config/config.service.spec.ts src/registry/registry.service.spec.ts src/registry/postgres-registry-store.service.spec.ts --runInBand
```

Expected:

```text
PASS
```

---

## Phase 5: Backfill Test Registry From Redis To Supabase

**Goal:** Copy existing test registry records into Postgres before switching reads.

- [ ] **Step 1: Add backfill script**

Create:

```text
api-center/scripts/backfill-registry-to-postgres.ts
```

The script should:

```text
1. Read Redis hash api-center:registry:services.
2. Parse each ServiceRegistryEntry.
3. Upsert each entry through PostgresRegistryStoreService.
4. Print count of inserted/updated services.
```

- [ ] **Step 2: Add npm script**

Modify:

```text
api-center/package.json
```

Add:

```json
{
  "scripts": {
    "db:backfill:registry": "tsx scripts/backfill-registry-to-postgres.ts"
  }
}
```

- [ ] **Step 3: Run backfill against test**

Use local env values pointed at test:

```powershell
$env:REDIS_CACHE_URL="<same Redis URL test uses>"
$env:DATABASE_ENABLED="true"
$env:DATABASE_URL="<test Supabase pooled runtime URL>"
npm run db:backfill:registry
```

Expected output:

```text
Backfilled registry services: <number>
```

- [ ] **Step 4: Verify service rows in Supabase test**

Run in Supabase SQL Editor:

```sql
select service_id, service_type, status, updated_at
from api_center.services
order by service_id;
```

Expected:

```text
Rows match the services shown in apicenter-management registry.
```

---

## Phase 6: Switch Test API Center Registry Reads To Postgres

**Goal:** Make test read registry state from Supabase while keeping rollback easy.

- [ ] **Step 1: Update `api-center-test` secret**

Set:

```json
{
  "DATABASE_ENABLED": "true",
  "DATABASE_URL": "<test Supabase pooled runtime URL>",
  "REGISTRY_SOURCE": "postgres",
  "REGISTRY_DUAL_WRITE": "true"
}
```

- [ ] **Step 2: Sync and restart test API Center**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-test -Namespace api-center-test -KubernetesSecretName api-center-test
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout status deployment/api-center -n api-center-test
```

- [ ] **Step 3: Verify test readiness**

```powershell
curl.exe -i https://api-center-test.itsandbox.site/api/v1/health/ready
```

Expected:

```text
HTTP/1.1 200
```

- [ ] **Step 4: Verify management registry against test**

Set `apicenter-management/.env.local`:

```text
API_CENTER_BASE_URL=https://api-center-test.itsandbox.site
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center-test.itsandbox.site
NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=test.
```

Open:

```text
http://localhost:3000/tribes
```

Expected:

```text
Registered services still appear.
New service registrations persist after API Center pod restart.
```

- [ ] **Step 5: Test rollback**

Set `api-center-test` back to:

```json
{
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Restart API Center and verify registry still works. Then switch back to Postgres after rollback test passes.

---

## Phase 7: Implement Shared-Service Persistence In Test

**Goal:** Enable Supabase writes for shared services one service at a time.

- [ ] **Step 1: Start with PayMongo persistence**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Persist:

```text
checkout session created
payment webhook received
receipt generated
receipt line items
refund events
```

Target schemas:

```text
shared_payment.checkout_sessions
shared_payment.payments
shared_payment.receipts
shared_payment.receipt_line_items
shared_payment.refunds
```

- [ ] **Step 2: Add PayMongo persistence tests**

Modify:

```text
api-shared-services/tests/shared-services/paymongo-provider.test.ts
```

Cover:

```text
SHARED_SERVICES_DATABASE_ENABLED=false skips DB writes
SHARED_SERVICES_DATABASE_ENABLED=true writes checkout session
DB write failure returns controlled 502/500 and logs provider-safe error
```

- [ ] **Step 3: Enable shared-service DB in test only**

Set in `api-shared-services-test`:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true",
  "SHARED_SERVICES_DATABASE_URL": "<test Supabase pooled runtime URL>"
}
```

Keep live:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

- [ ] **Step 4: Run test PayMongo smoke**

Use `apicenter-management` smoke tests pointed at:

```text
https://api-center-test.itsandbox.site
```

Expected:

```text
PayMongo test checkout succeeds.
Rows appear in shared_payment.checkout_sessions.
Events still publish to test.* Kafka topics.
```

---

## Phase 8: Apply Same Cutover To Live

**Goal:** Move live to Supabase only after test proves stable.

- [ ] **Step 1: Apply migrations to live Supabase**

Run the same migration files in `api-center-live` Supabase SQL Editor:

```text
api-center/supabase/migrations/20260515000000_init_control_plane.sql
api-shared-services/supabase/migrations/20260516000000_init_shared_service_schemas.sql
```

- [ ] **Step 2: Add live DB env with Redis still active**

Set in `api-center-prod`:

```json
{
  "DATABASE_ENABLED": "true",
  "DATABASE_URL": "<live Supabase pooled runtime URL>",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Set in `api-shared-services-prod`:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false",
  "SHARED_SERVICES_DATABASE_URL": "<live Supabase pooled runtime URL>"
}
```

- [ ] **Step 3: Backfill live registry**

Run:

```powershell
$env:REDIS_CACHE_URL="<live Redis URL>"
$env:DATABASE_ENABLED="true"
$env:DATABASE_URL="<live Supabase pooled runtime URL>"
npm run db:backfill:registry
```

- [ ] **Step 4: Switch live registry source**

Set in `api-center-prod`:

```json
{
  "REGISTRY_SOURCE": "postgres",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Restart live API Center:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-prod -Namespace api-center -KubernetesSecretName api-center-prod
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center
```

- [ ] **Step 5: Verify live**

```powershell
curl.exe -i https://api-center.itsandbox.site/api/v1/health/ready
```

Expected:

```text
HTTP/1.1 200
```

Open `apicenter-management` against live and verify:

```text
registry loads
shared services load
smoke safe checks pass
new registrations survive API Center restart
```

---

## Phase 9: Document Operations And Rollback

**Goal:** Make DB operations clear for future work.

- [ ] **Step 1: Update API Center DB docs**

Modify:

```text
api-center/docs/database-control-plane.md
api-center/docs/deployment-gke.md
api-center/docs/apicenter-platform-setup.md
```

Document:

```text
live/test Supabase separation
same env keys, different Secret Manager values
test-first cutover
rollback to REGISTRY_SOURCE=redis
```

- [ ] **Step 2: Update shared-service DB docs**

Modify:

```text
api-shared-services/docs/shared-service-database-schemas.md
api-shared-services/docs/shared-services-production-readiness-plan.md
```

Document:

```text
which services persist data
which tables they own
test/live PayMongo mode separation
how to verify rows after smoke tests
```

- [ ] **Step 3: Update management runbook**

Modify:

```text
apicenter-management/docs/operations/apicenter-management-runbook.md
```

Document:

```text
how to point management at test
how to point management at live
how to verify DB-backed registry after restart
what management never does: direct Supabase writes
```

---

## Rollback

Fast rollback for API Center:

```json
{
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "false"
}
```

Then:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-test -Namespace api-center-test -KubernetesSecretName api-center-test
kubectl rollout restart deployment/api-center -n api-center-test
```

Fast rollback for shared services:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

Then restart affected shared-service deployments.

Rollback does not delete Supabase rows. It only returns runtime reads/writes to the previous Redis/provider-only path.

## Verification Checklist

- [ ] Test Supabase has all API Center schemas.
- [ ] Test Supabase has all shared-service schemas.
- [ ] `api-center-test` has `DATABASE_ENABLED=true`.
- [ ] `api-center-test` stays on `REGISTRY_SOURCE=redis` before backfill.
- [ ] Registry backfill count matches management registry count.
- [ ] `api-center-test` can switch to `REGISTRY_SOURCE=postgres`.
- [ ] New test service registration survives API Center pod restart.
- [ ] PayMongo test smoke writes to `shared_payment` only after shared-service DB is explicitly enabled.
- [ ] Live remains Redis-backed until test passes.
- [ ] Live Supabase uses a different database/project from test.
- [ ] `apicenter-management` never stores direct Supabase credentials.

## What You Need From The User

For test:

```text
Supabase test project ref
Supabase test pooled database URL
Supabase test database password
Confirmation that migrations ran successfully
```

For live:

```text
Supabase live project ref
Supabase live pooled database URL
Supabase live database password
Approval to apply migrations after test passes
```

Do not request Supabase service-role API keys for this cutover. Runtime only needs Postgres connection strings stored in GCP Secret Manager.
