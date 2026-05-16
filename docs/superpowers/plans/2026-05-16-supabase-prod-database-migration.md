# Supabase Prod Database Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate production API Center and production shared services to Supabase-backed durable storage without mixing test/live data or taking the gateway offline.

**Architecture:** Test remains the rehearsal environment. Production uses the same environment variable names as test, but points at the live Supabase database through `api-center-prod` and `api-shared-services-prod` Secret Manager entries. API Center moves in phases from Redis read/write, to Redis reads plus Postgres dual-write, to Postgres reads after backfill and parity checks.

**Tech Stack:** GKE, GCP Secret Manager, Supabase Postgres, Prisma, NestJS, Redis, Confluent Cloud, API Center Management.

---

## Current Prod State

Verified on 2026-05-16:

```text
api-center-prod
DATABASE_URL: present
DATABASE_ENABLED=true
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=false

api-shared-services-prod
SHARED_SERVICES_DATABASE_URL: present
SHARED_SERVICES_DATABASE_ENABLED=true
```

Current safety boundary:

```text
API Center prod opens the DB connection but still reads registry from Redis.
Shared services prod has DB persistence enabled and must be verified service by service.
```

Do not switch `REGISTRY_SOURCE=postgres` until migrations, backfill, and parity
checks are complete.

## Environment Boundary

Use different databases for test and live:

```text
Test runtime:
api-center-test.DATABASE_URL=<test Supabase session pooler URL>
api-shared-services-test.SHARED_SERVICES_DATABASE_URL=<test Supabase session pooler URL>

Live runtime:
api-center-prod.DATABASE_URL=<live Supabase session pooler URL>
api-shared-services-prod.SHARED_SERVICES_DATABASE_URL=<live Supabase session pooler URL>
```

Do not point prod secrets at the test Supabase URL.

Use session pooler URLs for GKE runtime when available:

```text
postgresql://postgres.<project-ref>:<password>@aws-...pooler.supabase.com:5432/postgres
```

Use Supabase SQL Editor for migrations if direct IPv4 DB access is unreliable.

---

## Phase 0: Verify Production DB Risk

**Goal:** Confirm prod DB-enabled settings are intentional before any registry read-source cutover.

- [x] **Step 1: Set DB-enabled flags in Secret Manager**

Current requested state:

```json
{
  "api-center-prod.DATABASE_ENABLED": "true",
  "api-center-test.DATABASE_ENABLED": "true",
  "api-shared-services-prod.SHARED_SERVICES_DATABASE_ENABLED": "true",
  "api-shared-services-test.SHARED_SERVICES_DATABASE_ENABLED": "true"
}
```

- [ ] **Step 2: Verify prod shared-service DB behavior**

Before provider-impacting live checks, verify PayMongo persistence in test and
confirm the live Supabase `shared_payment` schema exists.

- [ ] **Step 3: If prod shared-service DB causes errors, disable only shared-service DB**

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

- [ ] **Step 4: If changed, sync prod shared-services secret**

Run from `api-shared-services`:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-prod -Namespace api-center -KubernetesSecretName api-shared-services-prod
kubectl rollout restart deployment/payment-service -n api-center
kubectl rollout restart deployment/email-service -n api-center
kubectl rollout restart deployment/sms-service -n api-center
kubectl rollout restart deployment/otp-service -n api-center
kubectl rollout restart deployment/gauth-service -n api-center
kubectl rollout restart deployment/geo-service -n api-center
kubectl rollout status deployment/payment-service -n api-center
```

- [ ] **Step 3: Verify prod is still healthy**

```powershell
curl.exe -i https://api-center.itsandbox.site/api/v1/health/ready
kubectl get deploy,pod,hpa -n api-center
```

Expected:

```text
HTTP/1.1 200
All prod deployments available
```

---

## Phase 1: Complete Test Cutover First

**Goal:** Prove the migration against test before production.

- [ ] **Step 1: Apply API Center migrations to test Supabase**

Run in Supabase SQL Editor for the test project:

```text
api-center/supabase/migrations/20260515000000_init_control_plane.sql
```

Expected schemas:

```text
api_center
api_center_ops
api_center_audit
```

- [ ] **Step 2: Apply shared-service migrations to test Supabase**

Run in Supabase SQL Editor for the test project:

```text
api-shared-services/supabase/migrations/20260516000000_init_shared_service_schemas.sql
```

Expected schemas:

```text
shared_payment
shared_otp
shared_email
shared_sms
shared_geo
shared_gauth
```

- [ ] **Step 3: Verify test schemas**

Run in Supabase SQL Editor:

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

Expected:

```text
9 rows
```

- [ ] **Step 4: Keep test registry source on Redis until dual-write exists**

Required `api-center-test` state:

```json
{
  "DATABASE_ENABLED": "false",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "false"
}
```

Do not set `REGISTRY_SOURCE=postgres` until Phase 2 is implemented.

---

## Phase 2: Implement API Center Dual-Write

**Goal:** Make API Center write registry changes to both Redis and Supabase before switching read source.

- [x] **Step 1: Add `REGISTRY_DUAL_WRITE` to config tests**

Modify:

```text
api-center/src/config/config.service.spec.ts
```

Add test expectations:

```ts
process.env.REGISTRY_DUAL_WRITE = "true";
const config = new ConfigService();
expect(config.database.registryDualWrite).toBe(true);
```

And default:

```ts
delete process.env.REGISTRY_DUAL_WRITE;
const config = new ConfigService();
expect(config.database.registryDualWrite).toBe(false);
```

- [x] **Step 2: Use existing `dualWrite` config**

Modify:

```text
api-center/src/config/config.service.ts
```

Current database config shape:

```ts
readonly database = {
  enabled: process.env.DATABASE_ENABLED === "true",
  provider: process.env.DATABASE_PROVIDER || "",
  url: process.env.DATABASE_URL || "",
  registrySource:
    process.env.REGISTRY_SOURCE === "postgres" ? "postgres" : "redis",
  dualWrite: process.env.REGISTRY_DUAL_WRITE === "true",
};
```

- [x] **Step 3: Wire `PostgresRegistryStoreService` into `RegistryService`**

Modify:

```text
api-center/src/registry/registry.service.ts
```

Add import:

```ts
import { PostgresRegistryStoreService } from "./postgres-registry-store.service";
```

Add constructor dependency:

```ts
private readonly postgresStore: PostgresRegistryStoreService,
```

- [x] **Step 4: Dual-write registry mutations**

In `RegistryService`, apply Postgres write after Redis write succeeds for these paths:

```text
register
deregister
deprecate
retire
activate
updateHealth
```

Only write Postgres when:

```ts
this.config.database.enabled && this.config.database.registryDualWrite
```

If Postgres write fails, return an error and keep the Redis/in-memory state consistent by rolling back the same mutation.

- [x] **Step 5: Add tests**

Modify:

```text
api-center/src/registry/registry.service.spec.ts
```

Cover:

```text
register writes Postgres when dual-write is enabled
register skips Postgres when dual-write is disabled
Postgres failure does not leave in-memory state ahead of Redis
lifecycle changes dual-write when enabled
```

- [x] **Step 6: Verify API Center tests**

```powershell
npx jest src/config/config.service.spec.ts src/registry/registry.service.spec.ts src/registry/postgres-registry-store.service.spec.ts --runInBand
npm run typecheck
```

Expected:

```text
PASS
```

Verified:

```text
npx jest src/config/config.service.spec.ts src/registry/registry.service.spec.ts src/registry/postgres-registry-store.service.spec.ts --runInBand
PASS 3 suites / 59 tests
```

---

## Phase 3: Test Backfill And Test Postgres Read Source

**Goal:** Prove registry survives restart from Supabase in test.

- [ ] **Step 1: Enable test DB connection with Redis read source**

Set `api-center-test`:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

- [ ] **Step 2: Sync and restart test API Center**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-test -Namespace api-center-test -KubernetesSecretName api-center-test
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout status deployment/api-center -n api-center-test
```

- [ ] **Step 3: Backfill test registry**

Run the backfill script from `api-center` after it exists:

```powershell
$env:DATABASE_ENABLED="true"
$env:DATABASE_URL="<test Supabase session pooler URL>"
$env:REDIS_CACHE_URL="<current redis cache url>"
npm run db:backfill:registry
```

Expected:

```text
Backfilled registry services: <count>
```

- [ ] **Step 4: Switch test reads to Postgres**

Set `api-center-test`:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "postgres",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Restart:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-test -Namespace api-center-test -KubernetesSecretName api-center-test
kubectl rollout restart deployment/api-center -n api-center-test
kubectl rollout status deployment/api-center -n api-center-test
```

- [ ] **Step 5: Verify test behavior**

```powershell
curl.exe -i https://api-center-test.itsandbox.site/api/v1/health/ready
```

Then in `apicenter-management/.env.local`:

```text
API_CENTER_BASE_URL=https://api-center-test.itsandbox.site
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center-test.itsandbox.site
NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=test.
```

Verify:

```text
Registry page loads
New test tribe registration works
Restarting test API Center does not lose the new service
Smoke tests still publish to test.* topics
```

---

## Phase 4: Apply Migrations To Prod Supabase

**Goal:** Create prod schemas without routing prod traffic to them yet.

- [ ] **Step 1: Confirm live Supabase is separate from test**

Confirm:

```text
api-center-prod.DATABASE_URL points to live Supabase
api-center-test.DATABASE_URL points to test Supabase
```

The project refs in the URLs must be different.

- [ ] **Step 2: Apply API Center migration to live Supabase**

Run in the live Supabase SQL Editor:

```text
api-center/supabase/migrations/20260515000000_init_control_plane.sql
```

- [ ] **Step 3: Apply shared-service migration to live Supabase**

Run in the live Supabase SQL Editor:

```text
api-shared-services/supabase/migrations/20260516000000_init_shared_service_schemas.sql
```

- [ ] **Step 4: Verify live schemas**

Run in live Supabase SQL Editor:

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

Expected:

```text
9 rows
```

---

## Phase 5: Enable Prod Dual-Write With Redis Reads

**Goal:** Start writing prod registry data to Supabase while Redis remains the active source of truth.

- [ ] **Step 1: Set prod API Center dual-write**

Set `api-center-prod`:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

- [ ] **Step 2: Sync and restart live API Center**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-prod -Namespace api-center -KubernetesSecretName api-center-prod
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center
```

- [ ] **Step 3: Verify live gateway stays healthy**

```powershell
curl.exe -i https://api-center.itsandbox.site/api/v1/health/ready
kubectl logs -n api-center deploy/api-center --tail=100
```

Expected:

```text
readiness 200
no Prisma connection errors
no registry write errors
```

- [ ] **Step 4: Backfill live registry**

Run:

```powershell
$env:DATABASE_ENABLED="true"
$env:DATABASE_URL="<live Supabase session pooler URL>"
$env:REDIS_CACHE_URL="<current prod redis cache url>"
npm run db:backfill:registry
```

Expected:

```text
Backfilled registry services: <count>
```

---

## Phase 6: Switch Prod Registry Reads To Supabase

**Goal:** Make live API Center read registry state from Supabase after backfill and dual-write are proven.

- [ ] **Step 1: Set prod registry source to Postgres**

Set `api-center-prod`:

```json
{
  "DATABASE_ENABLED": "true",
  "REGISTRY_SOURCE": "postgres",
  "REGISTRY_DUAL_WRITE": "true"
}
```

- [ ] **Step 2: Sync and restart live API Center**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-prod -Namespace api-center -KubernetesSecretName api-center-prod
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center
```

- [ ] **Step 3: Verify live registry after restart**

Open API Center Management against live:

```text
API_CENTER_BASE_URL=https://api-center.itsandbox.site
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=prod.
```

Verify:

```text
Registry page loads
Shared services appear
Known tribe services appear
New registration survives API Center restart
```

- [ ] **Step 4: Verify live smoke-safe checks**

Use only safe checks first:

```text
Readiness
Shared service catalog
Registry list
Token request for a known test tribe if it exists in live
```

Do not run PayMongo live provider-impacting checks unless intentionally testing live payments.

---

## Phase 7: Enable Prod Shared-Service Persistence Service By Service

**Goal:** Persist provider/business records to Supabase without turning every shared service on at once.

- [ ] **Step 1: Start with PayMongo only**

Keep `api-shared-services-prod`:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true"
}
```

Only after PayMongo persistence tests pass.

- [ ] **Step 2: Restart only payment service**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-prod -Namespace api-center -KubernetesSecretName api-shared-services-prod
kubectl rollout restart deployment/payment-service -n api-center
kubectl rollout status deployment/payment-service -n api-center
```

- [ ] **Step 3: Verify PayMongo rows in live Supabase**

Run in live Supabase SQL Editor after a known live/test-safe payment event:

```sql
select tribe_id, provider_mode, status, created_at
from shared_payment.checkout_sessions
order by created_at desc
limit 10;
```

Expected:

```text
Rows show provider_mode=live only for live PayMongo events.
```

- [ ] **Step 4: Enable remaining shared services one at a time**

Order:

```text
otp-service
email-service
sms-service
gauth-service
geo-service
```

For each service:

```text
1. Verify test persistence.
2. Verify prod migration table exists.
3. Restart only that deployment.
4. Verify logs and rows.
```

---

## Phase 8: Monitoring And Rollback

**Goal:** Keep live recoverable after cutover.

- [ ] **Step 1: Add dashboard checks**

Track:

```text
API Center readiness failures
Prisma connection errors
Registry read failures
Registry write failures
Shared-service DB write failures
PayMongo webhook failures
Kafka publish failures
```

- [ ] **Step 2: Fast API Center rollback**

Set `api-center-prod`:

```json
{
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "false"
}
```

Then:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-center-prod -Namespace api-center -KubernetesSecretName api-center-prod
kubectl rollout restart deployment/api-center -n api-center
kubectl rollout status deployment/api-center -n api-center
```

- [ ] **Step 3: Fast shared-service rollback**

Set `api-shared-services-prod`:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

Then restart affected shared-service deployments.

Rollback does not delete Supabase data; it only stops runtime from depending on Supabase.

---

## Phase 9: Documentation And Commit

**Goal:** Make prod DB operations repeatable.

- [ ] **Step 1: Update API Center docs**

Modify:

```text
api-center/docs/database-control-plane.md
api-center/docs/deployment-gke.md
api-center/docs/apicenter-platform-setup.md
```

Add:

```text
prod migration order
test-first requirement
REGISTRY_SOURCE rollback
live/test DB separation
```

- [ ] **Step 2: Update shared-services docs**

Modify:

```text
api-shared-services/docs/shared-service-database-schemas.md
api-shared-services/docs/shared-services-production-readiness-plan.md
```

Add:

```text
which service writes which schema
provider-mode separation
how to verify PayMongo records
```

- [ ] **Step 3: Update management runbook**

Modify:

```text
apicenter-management/docs/operations/apicenter-management-runbook.md
```

Add:

```text
how to point management to test
how to point management to live
how to verify DB-backed registry from the UI
```

- [ ] **Step 4: Commit**

Commit per repo:

```powershell
git add docs src prisma supabase package.json package-lock.json
git commit -m "feat: enable staged supabase database cutover"
```

---

## Stop Conditions

Stop and roll back if any of these happen:

```text
API Center readiness fails after DB flag change
Prisma connection errors repeat after restart
Registry page is empty after switching to Postgres
New service registration does not persist after restart
PayMongo live checkout fails after shared-service DB enablement
Supabase pooler shows connection exhaustion
```

## Final Acceptance Criteria

Production is migrated only when all are true:

```text
Live and test use different Supabase databases.
Prod API Center has DATABASE_ENABLED=true.
Prod API Center has REGISTRY_SOURCE=postgres.
Prod API Center has REGISTRY_DUAL_WRITE=true during stabilization.
Prod registry survives API Center restart.
Prod shared services write expected records to shared_* schemas.
Confluent still receives prod.* events.
S3 sink still exports prod.* topics.
Rollback to Redis is documented and tested.
```
