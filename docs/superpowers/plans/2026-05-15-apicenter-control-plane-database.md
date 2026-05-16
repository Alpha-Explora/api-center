# API Center Control-Plane Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ACID Postgres control-plane database for API Center registry, policy, provisioning, audit, and operational state without replacing Redis hot caches or the Confluent/S3 event lake.

**Architecture:** Postgres becomes the durable source for management/control-plane records. Redis remains the low-latency runtime cache for token/session state, rate limits, registry hydration, and rolling counters. Confluent/S3 remains the durable raw event/data lake and is not replaced by this database.

**Tech Stack:** Supabase Postgres, Supabase CLI SQL migrations, optional Prisma client for runtime typed access only, NestJS module/service patterns, existing Redis cache, existing Confluent publishers, and Jest unit/integration tests. Prisma migrations are no longer the schema source of truth.

---

## Decision Summary

Build the database, but keep its ownership narrow:

- **Use Postgres for ACID control-plane state:** registry, service routes, scopes, dependencies, provisioning jobs, topic/S3 sink status, operator audit, lifecycle history, and durable rollout/verification state.
- **Use Supabase migrations for schema changes:** SQL files under `supabase/migrations` become the canonical migration history. Do not create new `prisma/migrations` entries.
- **Keep Redis for hot runtime state:** token/session cache, rate limit counters, health/runtime counters, and optional registry cache.
- **Keep Confluent/S3 for event exports:** shared-service payload exports, tribe events, audit event stream, raw analytics lake.
- **Keep Secret Manager for secrets:** no plaintext secrets, provider keys, OTP codes, or private keys in Postgres.
- **Use separate schemas for shared-service business state:** keep payment, OTP, email, SMS, geo, and Google OAuth operational tables outside the API Center control-plane schemas, even if they share the same Supabase Postgres project/database for cost reasons.
- **Keep Prisma optional:** Prisma may remain as the Nest runtime DB client if the code continues to use it, but schema evolution must be driven by reviewed Supabase SQL migrations.

This avoids turning the gateway request path into a database-bound bottleneck while still giving the management layer durable, queryable state.

## ACID Boundaries

Use transactions when one operator action changes multiple control-plane records.

Examples:

- Register service:
  - insert/update `services`
  - replace `service_routes`
  - replace `service_scopes`
  - replace `service_dependencies`
  - append `service_lifecycle_events`
  - append `audit_events`
- Provision Confluent topic:
  - insert `provisioning_jobs`
  - upsert `confluent_topics`
  - update job result
  - append `audit_events`
- Add topic to S3 sink:
  - insert `provisioning_jobs`
  - upsert `s3_sink_topics`
  - update job result
  - append `audit_events`

Do not wrap external API calls themselves in long DB transactions. Instead:

1. Create job row as `running`.
2. Commit.
3. Call Confluent/GCP/Kubernetes.
4. Update job row as `succeeded` or `failed`.

## Target Schemas

Use one Supabase Postgres project/database with separate schemas:

```text
Supabase Postgres project
  database: postgres
    schema: api_center
    schema: api_center_ops
    schema: api_center_audit
    schema: shared_payment
    schema: shared_otp
    schema: shared_email
    schema: shared_sms
    schema: shared_geo
    schema: shared_gauth
```

Ownership boundary:

- `api_center`, `api_center_ops`, and `api_center_audit` are API Center control-plane schemas.
- `shared_*` schemas are provider/business-state schemas owned by the shared-service implementations.
- All schemas can live in the same Supabase Postgres database at first to save cost.
- If one shared service grows independently, its schema can later move to its own database without changing API Center registry ownership.

---

## File Structure

Create:

- `api-center/supabase/config.toml` - Supabase CLI project config for local database resets and linked-project operations.
- `api-center/supabase/migrations/<timestamp>_init_control_plane.sql` - canonical API Center control-plane SQL migration.
- `api-center/prisma/schema.prisma` - Prisma datasource, generator, and model definitions.
- `api-center/src/database/database.module.ts` - Nest module for DB access.
- `api-center/src/database/prisma.service.ts` - lifecycle-managed Prisma client.
- `api-center/src/database/prisma.service.spec.ts` - lifecycle/unit tests.
- `api-center/src/registry/registry-store.interface.ts` - persistence abstraction for registry state.
- `api-center/src/registry/postgres-registry-store.service.ts` - Postgres implementation of registry store.
- `api-center/src/registry/redis-registry-cache.service.ts` - focused Redis cache implementation extracted from current registry service.
- `api-center/src/ops/provisioning-jobs.service.ts` - durable job tracking for external provisioning.
- `api-center/src/ops/confluent-state.service.ts` - topic and S3 sink state persistence.
- `api-center/src/audit/persistent-audit-events.service.ts` - durable audit event persistence.
- `api-center/docs/database-control-plane.md` - operator-facing schema and migration guide.

Modify:

- `api-center/package.json` - add Prisma scripts and dependencies.
- `api-center/package.json` - add Supabase migration scripts and stop treating Prisma migrate commands as the deployment path.
- `api-center/.env.example` - document `DATABASE_URL` and DB feature flags.
- `api-center/src/app.module.ts` - import `DatabaseModule` once DB-backed mode is enabled.
- `api-center/src/config/config.service.ts` - add DB config and safe feature flag validation.
- `api-center/src/registry/registry.module.ts` - bind registry store implementation.
- `api-center/src/registry/registry.service.ts` - move durable persistence behind `RegistryStore`.
- `api-center/src/analytics/audit-events.service.ts` - optionally dual-write audit events during migration.
- `api-center/docs/apicenter-platform-setup.md` - add database ownership boundary.
- `api-center/docs/deployment-gke.md` - add Supabase Postgres deployment notes after implementation.

---

## Canonical Tables

### `api_center.organizations`

Use now even if only one org exists. It keeps future org/domain/project moves clean.

```sql
CREATE TABLE api_center.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `api_center.services`

Durable source for the service registry.

```sql
CREATE TABLE api_center.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES api_center.organizations(id),
  service_id text NOT NULL,
  name text NOT NULL,
  service_type text NOT NULL CHECK (service_type IN ('tribe', 'shared')),
  base_url text NOT NULL,
  health_check_path text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('proposed', 'active', 'deprecated', 'retired')),
  version text,
  previous_version text,
  description text,
  owner_team text,
  contact text,
  service_tier text CHECK (service_tier IN ('critical', 'standard', 'experimental')),
  cost_center text,
  sunset_date timestamptz,
  replacement_service_id text,
  healthy boolean,
  last_health_check_at timestamptz,
  registered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, service_id)
);
```

Indexes:

```sql
CREATE INDEX services_type_status_idx ON api_center.services(service_type, status);
CREATE INDEX services_owner_team_idx ON api_center.services(owner_team);
```

### `api_center.service_routes`

Normalized `exposes`.

```sql
CREATE TABLE api_center.service_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  method text,
  path text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, method, path)
);
```

### `api_center.service_scopes`

Normalized `requiredScopes`.

```sql
CREATE TABLE api_center.service_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  scope text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id, scope)
);
```

### `api_center.service_dependencies`

Normalized `consumes`.

```sql
CREATE TABLE api_center.service_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  depends_on_service_id uuid REFERENCES api_center.services(id),
  depends_on_external_id text,
  dependency_type text NOT NULL DEFAULT 'consumes'
    CHECK (dependency_type IN ('consumes', 'routes_to', 'shared_service', 'external')),
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (depends_on_service_id IS NOT NULL AND depends_on_external_id IS NULL)
    OR
    (depends_on_service_id IS NULL AND depends_on_external_id IS NOT NULL)
  )
);
```

Indexes:

```sql
CREATE INDEX service_dependencies_service_idx ON api_center.service_dependencies(service_id);
CREATE INDEX service_dependencies_depends_on_idx ON api_center.service_dependencies(depends_on_service_id);
```

### `api_center.service_lifecycle_events`

Durable registry history.

```sql
CREATE TABLE api_center.service_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN (
      'registered',
      'updated',
      'deprecated',
      'retired',
      'reactivated',
      'deregistered',
      'health_changed',
      'version_changed'
    )),
  previous_status text,
  next_status text,
  previous_version text,
  next_version text,
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system', 'operator', 'tribe')),
  actor_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `api_center.tribe_secret_refs`

Secret Manager metadata only. No plaintext.

```sql
CREATE TABLE api_center.tribe_secret_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES api_center.services(id) ON DELETE CASCADE,
  secret_manager_name text NOT NULL,
  latest_version text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotated', 'revoked', 'deleted')),
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_id)
);
```

### `api_center.confluent_topics`

Tracks expected and observed topic state.

```sql
CREATE TABLE api_center.confluent_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_name text NOT NULL UNIQUE,
  owner_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  topic_type text NOT NULL
    CHECK (topic_type IN ('tribe_events', 'shared_export', 'api_center_core')),
  partitions integer NOT NULL DEFAULT 1 CHECK (partitions > 0),
  retention_ms bigint,
  cleanup_policy text NOT NULL DEFAULT 'delete',
  exists_in_confluent boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### `api_center.s3_sink_topics`

Tracks connector inclusion, not S3 object delivery.

```sql
CREATE TABLE api_center.s3_sink_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES api_center.confluent_topics(id) ON DELETE CASCADE,
  connector_name text NOT NULL,
  included boolean NOT NULL DEFAULT false,
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, connector_name)
);
```

### `api_center_ops.provisioning_jobs`

Durable external-operation ledger.

```sql
CREATE TABLE api_center_ops.provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  job_type text NOT NULL
    CHECK (job_type IN (
      'tribe_secret',
      'confluent_topic',
      's3_sink_include',
      's3_sink_remove',
      'deployment_restart',
      'registry_sync',
      'shared_service_registration'
    )),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  requested_by text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Indexes:

```sql
CREATE INDEX provisioning_jobs_service_idx ON api_center_ops.provisioning_jobs(service_id);
CREATE INDEX provisioning_jobs_status_created_idx ON api_center_ops.provisioning_jobs(status, created_at DESC);
```

### `api_center_audit.audit_events`

Durable operator and platform audit. Confluent remains the streaming audit path.

```sql
CREATE TABLE api_center_audit.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text,
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system', 'operator', 'tribe')),
  actor_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  outcome text NOT NULL DEFAULT 'succeeded'
    CHECK (outcome IN ('succeeded', 'failed', 'denied')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Indexes:

```sql
CREATE INDEX audit_events_created_idx ON api_center_audit.audit_events(created_at DESC);
CREATE INDEX audit_events_resource_idx ON api_center_audit.audit_events(resource_type, resource_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON api_center_audit.audit_events(actor_type, actor_id, created_at DESC);
```

### `api_center_ops.health_snapshots`

Historical health status without overloading the registry row.

```sql
CREATE TABLE api_center_ops.health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES api_center.services(id) ON DELETE CASCADE,
  healthy boolean NOT NULL,
  status_code integer,
  latency_ms integer,
  error_message text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
```

### `api_center_ops.smoke_test_runs`

Management smoke test history.

```sql
CREATE TABLE api_center_ops.smoke_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  tribe_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  test_type text NOT NULL,
  provider_impacting boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),
  status_code integer,
  latency_ms integer,
  response_preview text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### `api_center_ops.usage_rollups`

Dashboard acceleration only. Raw detail stays in Confluent/S3.

```sql
CREATE TABLE api_center_ops.usage_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  consumer_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  target_service_id uuid REFERENCES api_center.services(id) ON DELETE SET NULL,
  route_family text NOT NULL CHECK (route_family IN ('tribes', 'shared', 'external', 'kafka')),
  request_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  avg_latency_ms numeric(10,2),
  p95_latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (window_start, window_end, consumer_service_id, target_service_id, route_family)
);
```

---

## Phase 0: Provider And Migration Decision

**Outcome:** Use Supabase Postgres and Supabase CLI migrations, while keeping production on Redis until the DB cutover is complete.

- [x] **Step 1: Choose deployment target**

Recommended:

```text
Current path: Supabase Postgres
Migration source of truth: Supabase CLI SQL migrations
Runtime client: Prisma client may remain temporarily if useful
```

Decision rule:

```text
Use Supabase migrations because they are plain SQL, tracked in Git, and can be applied with supabase db push instead of Prisma migrate.
Do not depend on Prisma's migration engine or a direct IPv4 database host.
For runtime, use a pooled Supabase database URL or another verified connection string that works from GKE.
```

- [ ] **Step 2: Define secrets**

Add only these to Secret Manager, not Git:

```json
{
  "DATABASE_URL": "postgresql://api_center_app:<password>@<supabase-pooler-host>:6543/postgres?pgbouncer=true",
  "DATABASE_PROVIDER": "supabase"
}
```

Use:

```text
DATABASE_URL = runtime pooled/app connection for API Center pods
SUPABASE_PROJECT_REF = operator/CI only, not required inside API Center pods
SUPABASE_ACCESS_TOKEN = operator/CI only, never exposed to the app
SUPABASE_DB_PASSWORD = operator/CI only, used by supabase link/db push
```

- [ ] **Step 3: Confirm runtime connectivity**

For Supabase + GKE:

```text
Use the pooled Supabase Postgres connection string for runtime.
Verify from a trusted local environment first, then from a temporary GKE debug pod before setting DATABASE_ENABLED=true.
```

Do not run Supabase migrations from the application pod. Run them from a trusted operator machine or CI with Supabase CLI credentials.

---

## Phase 1: Add Database Infrastructure Locally

**Outcome:** API Center can connect to Postgres in dev/test without changing runtime behavior.

**Files:**

- Modify: `api-center/package.json`
- Modify: `api-center/.env.example`
- Create: `api-center/supabase/config.toml`
- Create: `api-center/supabase/migrations/<timestamp>_init_control_plane.sql`
- Create: `api-center/prisma/schema.prisma`
- Create: `api-center/src/database/database.module.ts`
- Create: `api-center/src/database/prisma.service.ts`
- Create: `api-center/src/database/prisma.service.spec.ts`

- [x] **Step 1: Add Supabase migration tooling and scripts**

Install:

```powershell
npm install @prisma/client @prisma/adapter-pg pg
npm install -D prisma supabase
```

Add scripts:

```json
{
  "db:generate": "prisma generate",
  "db:validate": "prisma validate",
  "db:migration:new": "supabase migration new",
  "db:migration:list": "supabase migration list",
  "db:migration:push": "supabase db push",
  "db:migration:push:dry": "supabase db push --dry-run",
  "db:reset": "supabase db reset",
  "db:studio": "supabase status"
}
```

Migration rule:

```text
Use Prisma only for client generation/validation if runtime code still imports PrismaService.
Use Supabase CLI for every schema migration.
Do not add new Prisma migrate commands or new prisma/migrations directories.
```

Implementation note on 2026-05-16:

```text
Supabase CLI is installed locally as version 2.75.0.
API Center package scripts now use Supabase CLI for migration creation, listing, dry-run, push, reset, and local status.
Prisma scripts are limited to runtime-client generation and schema validation.
```

- [x] **Step 2: Create the Prisma module**

Create `src/database/prisma.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Create `src/database/database.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
```

- [x] **Step 3: Add DB config**

Modify `src/config/config.service.ts` to expose:

```ts
readonly database = {
  url: process.env.DATABASE_URL || "",
  enabled: process.env.DATABASE_ENABLED === "true",
  registrySource:
    process.env.REGISTRY_SOURCE === "postgres" ? "postgres" : "redis",
};
```

Validation rule:

```ts
if (this.database.enabled && !this.database.url) {
  throw new Error("DATABASE_URL is required when DATABASE_ENABLED=true");
}
```

- [x] **Step 4: Test connection lifecycle**

Create `src/database/prisma.service.spec.ts`:

```ts
import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  it("connects and disconnects through Prisma lifecycle hooks", async () => {
    const service = new PrismaService();
    const connect = jest
      .spyOn(service, "$connect")
      .mockResolvedValue(undefined);
    const disconnect = jest
      .spyOn(service, "$disconnect")
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
```

Run:

```powershell
npm test -- prisma.service.spec.ts --runInBand
npm run typecheck
```

Expected:

```text
PASS prisma.service.spec.ts
typecheck passes
```

---

## Phase 2: Convert Initial Control-Plane Migration To Supabase

**Outcome:** Empty Postgres database has the full API Center control-plane schema.

**Files:**

- Create: `api-center/supabase/config.toml`
- Create: `api-center/supabase/migrations/<timestamp>_init_control_plane.sql`
- Keep: `api-center/prisma/schema.prisma` only if Prisma remains the runtime client source

- [x] **Step 1: Initialize Supabase CLI project**

Run:

```powershell
cd C:\Codes\apic\api-center
npx supabase init
```

Expected:

```text
supabase/config.toml exists.
supabase/migrations/ is the canonical migration directory.
```

- [x] **Step 2: Create Supabase migration**

Run:

```powershell
cd C:\Codes\apic\api-center
npx supabase migration new init_control_plane
```

Expected:

```text
supabase/migrations/<timestamp>_init_control_plane.sql exists.
```

Copy the existing reviewed SQL from:

```text
prisma/migrations/20260515000000_init_control_plane/migration.sql
```

into:

```text
supabase/migrations/<timestamp>_init_control_plane.sql
```

- [ ] **Step 3: Keep Prisma schema as runtime-client mirror**

Use Prisma models for the canonical tables above. Keep `Json` fields for metadata:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Organization {
  id        String   @id @default(uuid()) @db.Uuid
  slug      String   @unique
  name      String
  status    String   @default("active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  services Service[]

  @@map("organizations")
  @@schema("api_center")
}
```

Then add the remaining models:

```text
Service
ServiceRoute
ServiceScope
ServiceDependency
ServiceLifecycleEvent
TribeSecretRef
ConfluentTopic
S3SinkTopic
ProvisioningJob
AuditEvent
HealthSnapshot
SmokeTestRun
UsageRollup
```

- [x] **Step 4: Stop using Prisma migrate for schema deployment**

Implementation note: the old initial SQL migration was committed under
`prisma/migrations/20260515000000_init_control_plane/migration.sql`. Treat that
file as a conversion source only. After the Supabase migration exists, all new
schema changes belong in `supabase/migrations`.

Run:

```powershell
npm run db:validate
npm run db:generate
```

Expected:

```text
Prisma schema validates as a runtime-client mirror.
Prisma client generated
```

Verification on 2026-05-16:

```powershell
npm run db:validate
```

Result:

```text
The schema at prisma\schema.prisma is valid.
```

- [x] **Step 3: Review SQL manually**

Confirm:

```text
Schemas api_center, api_center_ops, api_center_audit are created.
Foreign keys use ON DELETE CASCADE only for child rows that should disappear with the parent service.
Audit and job records preserve history with ON DELETE SET NULL.
Unique constraints exist for service_id, scopes, routes, topic_name, and connector topic membership.
```

- [x] **Step 5: Migration test**

Status on 2026-05-16: switch the migration test to Supabase CLI. The old
Prisma migration test is no longer the target.

Run against local Supabase:

```powershell
cd C:\Codes\apic\api-center
npx supabase start
npm run db:reset
npm run db:generate
```

Expected:

```text
Local Supabase resets successfully and applies all SQL files under supabase/migrations.
Prisma client generated
```

Run against the linked Supabase project only after local reset passes:

```powershell
cd C:\Codes\apic\api-center
npx supabase login
npx supabase link --project-ref <project-ref>
npm run db:migration:push:dry
npm run db:migration:push
```

Expected:

```text
Dry run shows the expected init migration.
Remote push records the migration under supabase_migrations.schema_migrations.
```

Implementation note on 2026-05-16:

```text
Project ref qnebjcboppqdsgmgizvs was linked from both repos.
Because Supabase migration history is project-wide, both repos now mirror both migration files.
npm run db:migration:push:dry showed:
  20260515000000_init_control_plane.sql
  20260516000000_init_shared_service_schemas.sql
npm run db:migration:push applied both migrations successfully.
npm run db:migration:list and npm run db:shared:migration:list both show matching local and remote migration history.
```

---

## Phase 3: Build Registry Store Abstraction

**Outcome:** Registry can keep its current behavior while persistence moves behind an interface.

**Files:**

- Create: `api-center/src/registry/registry-store.interface.ts`
- Create: `api-center/src/registry/postgres-registry-store.service.ts`
- Create: `api-center/src/registry/redis-registry-cache.service.ts`
- Modify: `api-center/src/registry/registry.service.ts`
- Modify: `api-center/src/registry/registry.module.ts`
- Test: `api-center/src/registry/postgres-registry-store.service.spec.ts`
- Test: `api-center/src/registry/registry.service.spec.ts`

- [x] **Step 1: Define store interface**

Create `registry-store.interface.ts`:

```ts
import { ServiceRegistryEntry, ServiceRegistryMap } from "../types";

export const REGISTRY_STORE = Symbol("REGISTRY_STORE");

export interface RegistryStore {
  loadAll(): Promise<ServiceRegistryMap>;
  upsert(entry: ServiceRegistryEntry): Promise<void>;
  remove(serviceId: string): Promise<void>;
}
```

- [x] **Step 2: Add Postgres implementation**

Implementation note: `PostgresRegistryStoreService` is registered as a provider
but is not yet the active runtime registry source. Redis remains the active
source until `REGISTRY_SOURCE=postgres` cutover work is complete.

Create `postgres-registry-store.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { ServiceRegistryEntry, ServiceRegistryMap } from "../types";
import { RegistryStore } from "./registry-store.interface";

@Injectable()
export class PostgresRegistryStoreService implements RegistryStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadAll(): Promise<ServiceRegistryMap> {
    const rows = await this.prisma.service.findMany({
      include: {
        routes: true,
        scopes: true,
        dependencies: {
          include: {
            dependsOnService: true,
          },
        },
      },
    });

    return Object.fromEntries(
      rows.map((row) => [row.serviceId, mapRowToRegistryEntry(row)]),
    );
  }

  async upsert(entry: ServiceRegistryEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { slug: "default" },
        update: {},
        create: { slug: "default", name: "Default Organization" },
      });

      const service = await tx.service.upsert({
        where: {
          organizationId_serviceId: {
            organizationId: organization.id,
            serviceId: entry.serviceId,
          },
        },
        update: mapRegistryEntryToServiceUpdate(entry),
        create: {
          organizationId: organization.id,
          ...mapRegistryEntryToServiceCreate(entry),
        },
      });

      await tx.serviceRoute.deleteMany({ where: { serviceId: service.id } });
      await tx.serviceScope.deleteMany({ where: { serviceId: service.id } });
      await tx.serviceDependency.deleteMany({ where: { serviceId: service.id } });

      await tx.serviceRoute.createMany({
        data: entry.exposes.map((route) => ({
          serviceId: service.id,
          path: route,
        })),
      });

      await tx.serviceScope.createMany({
        data: entry.requiredScopes.map((scope) => ({
          serviceId: service.id,
          scope,
        })),
      });

      await tx.serviceLifecycleEvent.create({
        data: {
          serviceId: service.id,
          eventType: "updated",
          nextStatus: entry.status,
          nextVersion: entry.version,
          metadata: {},
        },
      });
    });
  }

  async remove(serviceId: string): Promise<void> {
    await this.prisma.service.updateMany({
      where: { serviceId },
      data: { status: "retired" },
    });
  }
}
```

Add mapper helpers in the same file. Keep them pure and unit tested.

- [ ] **Step 3: Keep Redis as cache**

Extract the current Redis `hgetall`, `hset`, and `hdel` logic from `RegistryService` into `RedisRegistryCacheService`.

Required methods:

```ts
loadAll(): Promise<ServiceRegistryMap | null>
write(serviceId: string, entry: ServiceRegistryEntry): Promise<void>
remove(serviceId: string): Promise<void>
replaceAll(entries: ServiceRegistryMap): Promise<void>
```

- [ ] **Step 4: Wire dual mode**

Use config:

```text
REGISTRY_SOURCE=redis
REGISTRY_SOURCE=postgres
```

Phase behavior:

```text
redis = existing production behavior
postgres = load durable source from Postgres, hydrate memory and Redis cache
```

- [x] **Step 5: Tests**

Completed focused tests:

```powershell
npm test -- registry.service.spec.ts postgres-registry-store.service.spec.ts --runInBand
npm test -- postgres-registry-store.service.spec.ts prisma.service.spec.ts config.service.spec.ts --runInBand
npm run typecheck
```

Run:

```powershell
npm test -- registry.service.spec.ts postgres-registry-store.service.spec.ts --runInBand
npm run typecheck
```

Expected:

```text
Registry behavior remains unchanged in redis mode.
Postgres store writes service, routes, scopes, dependencies, and lifecycle event in one transaction.
```

---

## Phase 4: Durable Provisioning And Confluent/S3 State

**Outcome:** Management actions have durable job/status rows.

**Files:**

- Create: `api-center/src/ops/provisioning-jobs.service.ts`
- Create: `api-center/src/ops/confluent-state.service.ts`
- Create: `api-center/src/ops/ops.module.ts`
- Modify: management-facing API endpoints when they move server-side into API Center.

- [ ] **Step 1: Add job service**

Create methods:

```ts
createRunningJob(input): Promise<ProvisioningJob>
markSucceeded(id, result): Promise<ProvisioningJob>
markFailed(id, errorMessage, result): Promise<ProvisioningJob>
listRecent(filter): Promise<ProvisioningJob[]>
```

- [ ] **Step 2: Add Confluent state service**

Create methods:

```ts
upsertTopic(topicName, topicType, ownerServiceId, observedState)
markTopicCheckFailed(topicName, error)
upsertS3SinkTopic(topicName, connectorName, included)
markS3SinkCheckFailed(topicName, connectorName, error)
```

- [ ] **Step 3: Preserve external-call boundary**

Pattern:

```ts
const job = await jobs.createRunningJob(...);
try {
  const result = await confluentClient.provisionTopic(...);
  await db.$transaction([
    confluentState.upsertTopic(...),
    jobs.markSucceeded(job.id, result),
    audit.record(...),
  ]);
} catch (error) {
  await jobs.markFailed(job.id, safeMessage(error), {});
  throw error;
}
```

- [ ] **Step 4: Tests**

Run:

```powershell
npm test -- provisioning-jobs.service.spec.ts confluent-state.service.spec.ts --runInBand
```

Expected:

```text
Job succeeds and fails with durable status.
Topic and S3 sink rows upsert idempotently.
No secret values are persisted in request/result JSON.
```

---

## Phase 5: Durable Audit And Management History

**Outcome:** Audit events exist in Postgres for management queries while Confluent remains the event stream.

**Files:**

- Create: `api-center/src/audit/persistent-audit-events.service.ts`
- Modify: `api-center/src/analytics/audit-events.service.ts`
- Modify: `api-center/src/registry/registry.controller.ts`
- Modify: `api-center/src/shared/proxy-handler.ts`

- [ ] **Step 1: Add persistent audit service**

Methods:

```ts
record(input: {
  correlationId?: string;
  actorType: "system" | "operator" | "tribe";
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome?: "succeeded" | "failed" | "denied";
  metadata?: Record<string, unknown>;
}): Promise<void>
```

- [ ] **Step 2: Redaction rule**

Before insert, remove keys matching:

```text
secret
token
password
authorization
apiKey
privateKey
otp
code
```

- [ ] **Step 3: Dual-write migration**

During migration:

```text
Write recent audit to Redis as today.
Write durable audit to Postgres if DATABASE_ENABLED=true.
Publish audit to Confluent as today.
```

- [ ] **Step 4: Tests**

Run:

```powershell
npm test -- persistent-audit-events.service.spec.ts audit-events.service.spec.ts --runInBand
```

Expected:

```text
Audit events persist without secret fields.
Redis fallback still works when DB is disabled.
```

---

## Phase 6: Runtime Cutover

**Outcome:** API Center can safely use Postgres as durable source while keeping Redis hot path.

- [ ] **Step 1: Backfill from Redis**

Create a one-shot script:

```text
scripts/backfill-registry-to-postgres.ts
```

Behavior:

```text
Read Redis registry hash.
Validate each entry against ServiceManifest/ServiceRegistryEntry shape.
Upsert into Postgres in transactions.
Print counts only, not secrets.
```

- [ ] **Step 2: Deploy with dual-write**

Set:

```text
DATABASE_ENABLED=true
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=true
```

Verify:

```text
API readiness is green.
Registry register/update writes Redis and Postgres.
No request-path latency regression.
```

- [ ] **Step 3: Switch read source**

Set:

```text
REGISTRY_SOURCE=postgres
```

Startup behavior:

```text
Load registry from Postgres.
Hydrate in-memory map.
Hydrate Redis cache.
Continue serving from memory during requests.
```

- [ ] **Step 4: Rollback plan**

Rollback config only:

```text
REGISTRY_SOURCE=redis
DATABASE_ENABLED=false
```

Do not drop tables during rollback.

---

## Phase 7: Management UI Integration

**Outcome:** `apicenter-management` can show durable history instead of only live snapshots.

Add or expose API Center admin endpoints:

```text
GET /api/v1/admin/provisioning/jobs
GET /api/v1/admin/audit/events
GET /api/v1/admin/topics
GET /api/v1/admin/s3-sink/topics
GET /api/v1/admin/services/:serviceId/history
```

Management UI views:

```text
Service detail -> lifecycle timeline
Onboarding -> provisioning job history
Confluent card -> last verified topic/S3 sink state
Audit -> durable searchable audit table
Cost/usage -> rollup-backed trends
```

Do not add auth in this plan unless management is deployed publicly.

---

## Phase 8: Shared-Service Business Schemas

**Outcome:** Shared services can persist provider/business state without mixing it into API Center control-plane tables.

**Database placement:**

Use the same Supabase Postgres project and database initially, but create separate schemas:

```text
shared_payment
shared_otp
shared_email
shared_sms
shared_geo
shared_gauth
```

Do not store provider secrets or plaintext sensitive values in these schemas. Secrets remain in GCP Secret Manager.

- [x] **Step 1: Add shared-service schema ownership document**

Create or update shared-service documentation with this boundary:

```text
API Center schemas = registry, routing, provisioning, audit, operational control plane.
Shared-service schemas = provider/domain records for each shared service.
Redis = hot TTL state and locks.
Confluent/S3 = raw event export and analytics lake.
Secret Manager = provider secrets and private keys.
```

- [x] **Step 2: Add `shared_payment` schema**

Candidate tables:

```text
shared_payment.checkout_sessions
shared_payment.payments
shared_payment.refunds
shared_payment.payment_webhook_events
shared_payment.receipts
shared_payment.receipt_line_items
```

Use this schema for PayMongo operational records:

```text
checkout session metadata
payment status snapshots
refund records
webhook idempotency by provider event id
receipt metadata and line items
test/live mode marker
tribe/service ownership reference
```

Do not store PayMongo secret keys or webhook secrets.

- [x] **Step 3: Add `shared_otp` schema**

Candidate tables:

```text
shared_otp.otp_challenges
shared_otp.otp_attempts
shared_otp.otp_delivery_events
```

Store only hashed OTP values or challenge references. Keep short-lived OTP runtime state in Redis when TTL behavior is required.

- [x] **Step 4: Add `shared_email` schema**

Candidate tables:

```text
shared_email.email_messages
shared_email.email_templates
shared_email.email_delivery_events
```

Store send metadata, provider ids, status, recipient hash or normalized recipient when needed, and template references. Avoid raw body retention unless explicitly required.

- [x] **Step 5: Add `shared_sms` schema**

Candidate tables:

```text
shared_sms.sms_messages
shared_sms.sms_delivery_events
```

Store provider ids, delivery status, tribe ownership, and sanitized message metadata. Avoid raw SMS body retention by default.

- [x] **Step 6: Add `shared_geo` schema**

Candidate tables:

```text
shared_geo.geocode_requests
shared_geo.normalized_locations
shared_geo.geofence_checks
```

Use for cached/normalized Google Maps results and geofence outcomes. Decide retention before storing exact user coordinates.

- [x] **Step 7: Add `shared_gauth` schema**

Candidate tables:

```text
shared_gauth.oauth_sessions
shared_gauth.oauth_accounts
shared_gauth.oauth_token_refs
```

Prefer token references or encrypted token vault integration. Do not store Google client secrets or plaintext refresh/access tokens.

- [x] **Step 8: Convert shared-service schema migrations to Supabase**

Recommended first implementation:

```text
Add schemas and tables in a separate Supabase migration directory under api-shared-services.
Keep API Center Prisma focused on control-plane schemas only.
Use separate DB users:
  api_center_app -> API Center schemas
  shared_services_app -> shared_* schemas
  supabase migration role -> migration/admin operations from operator/CI only
```

This keeps generated runtime clients smaller and prevents API Center from accidentally depending on shared-service business tables.

Implementation note on 2026-05-16:

- Added `api-shared-services/prisma/shared-services/schema.prisma`.
- Added `api-shared-services/prisma/shared-services/migrations/20260516000000_init_shared_service_schemas/migration.sql`.
- Added `api-shared-services/docs/shared-service-database-schemas.md`.
- Added shared-service DB validation/deploy scripts.
- Runtime persistence remains disabled until the Supabase project is migrated and each shared-service gateway is wired/tested.

Supabase migration update:

```text
Convert the reviewed SQL from api-shared-services/prisma/shared-services/migrations/.../migration.sql
into api-shared-services/supabase/migrations/<timestamp>_init_shared_service_schemas.sql.
Keep Prisma schema only if shared-service runtime code needs a generated client.
Do not use prisma migrate deploy for shared-service schema deployment.
```

Implementation note on 2026-05-16:

```text
Created api-shared-services/supabase/config.toml.
Created api-shared-services/supabase/migrations/20260516000000_init_shared_service_schemas.sql.
Added CREATE EXTENSION IF NOT EXISTS pgcrypto because the shared-service schema uses gen_random_uuid().
Updated package scripts to use Supabase CLI for shared-service migration creation, listing, dry-run, push, and reset.
Verified the Prisma runtime mirror with npm run db:shared:validate.
```

---

## Phase 9: Production Hardening

**Outcome:** Database does not become a new single point of failure.

- [ ] Add readiness distinction:

```text
/health/live does not fail because DB is unavailable.
/health/ready fails only if DATABASE_ENABLED=true and DB-backed source is required.
```

- [ ] Add pool limits:

```text
Supabase pooler: start with max 5 connections per pod.
Use the pooled connection string for runtime.
```

- [ ] Add backup policy:

```text
Daily Supabase project backups where available on the selected plan.
Point-in-time recovery if the Supabase plan supports it under budget.
Export schema migrations to Git.
```

- [ ] Add retention:

```text
audit_events: 90 days in Postgres, raw long-term in S3
health_snapshots: 30 days
smoke_test_runs: 90 days
provisioning_jobs: 180 days
usage_rollups: 12 months
```

- [ ] Add dashboard alerts:

```text
DB connection failures
Migration failure
Registry Postgres-to-Redis hydration failure
Provisioning job failure spike
Audit persistent write failures
```

---

## What This Database Should Not Do

Do not use this database for:

- Raw tribe payload lake
- Raw shared-service exports
- PayMongo provider secret storage
- Google OAuth client secrets
- Google refresh/access tokens unless encrypted in a dedicated token vault
- OTP plaintext codes
- SMS/email raw message bodies by default
- High-cardinality request logs

Those stay in:

```text
Secret Manager -> secrets
Redis -> hot ephemeral state
Confluent/S3 -> raw event/data lake
Shared-service schemas -> provider-specific integration state
```

Shared-service schemas may store sanitized business records and provider
status metadata, but they should not become the raw analytics lake and should
not replace Confluent/S3 exports.

---

## Acceptance Criteria

- API Center has a Postgres schema for durable control-plane state.
- Registry data can be backfilled from Redis into Postgres.
- Registry reads can cut over from Redis-backed source to Postgres-backed source without changing route behavior.
- Redis remains a runtime cache and rate-limit/token store.
- Confluent/S3 remains the event export path.
- Secrets are never stored in plaintext in Postgres.
- Provisioning, topic/S3 sink state, service lifecycle, and audit history are queryable.
- Shared-service business state has separate schemas and does not pollute the API Center control-plane schema.
- Shared-service schemas can share the same Supabase Postgres project initially and split out later if scale or ownership requires it.
- Rollback to Redis registry source is config-only.

## Commit Plan

1. `docs: add api center database control-plane plan`
2. `feat(database): add supabase control-plane migration`
3. `feat(registry): add postgres registry store`
4. `feat(ops): persist provisioning and topic state`
5. `feat(audit): add durable audit event storage`
6. `docs: document api center database operations`
7. `docs: add shared service database schema plan`
8. `feat(shared-services): add supabase shared service business schemas`
