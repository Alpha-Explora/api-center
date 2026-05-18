# API Center Control-Plane Database

API Center has the foundation for an optional ACID Postgres control-plane database. The database is for durable management state only: registry records, service routes, scopes, dependencies, provisioning jobs, Confluent/S3 export status, audit records, smoke-test runs, and usage rollups.

It does not replace Redis for hot runtime state, and it does not replace Confluent/S3 for raw event exports. Shared-service provider/business records use separate Supabase SQL migrations in `api-shared-services`; API Center control-plane code should not import or query those shared-service business tables.

## Current Runtime Mode

Keep production registry reads on Redis until the database is created, migrated,
backfilled, and verified. The database connection can be enabled before the
read-source cutover so readiness catches connection problems early.

```text
DATABASE_ENABLED=true
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=false
```

With this mode, the gateway opens a database connection, but registry reads and
registry writes still use Redis unless `REGISTRY_DUAL_WRITE=true`.

## API Center Schemas

The API Center migration creates one database with three Postgres schemas:

| Schema | Purpose |
| --- | --- |
| `api_center` | Durable registry, routes, scopes, service dependencies, tribe secret references, Confluent topics, and S3 sink topic state |
| `api_center_ops` | Provisioning jobs, readiness/health snapshots, smoke-test runs, and usage rollups |
| `api_center_audit` | Durable operator and system audit events |

Secrets stay in GCP Secret Manager. Postgres stores only references and metadata, such as `api-center-tribe-secret-<tribe-id>`.

## Shared-Service Schemas

Shared-service provider and business records are documented and migrated from
the sibling repo:

```text
../api-shared-services/supabase/migrations/
```

Supabase tracks migration history per project, not per repo. Because API Center
and shared services currently share one Supabase project/database, both repos
mirror the same `supabase/migrations` ledger. The ownership boundary is still by
schema: API Center code owns `api_center*`, and shared-service code owns
`shared_*`.

Those migrations create:

```text
shared_payment
shared_otp
shared_email
shared_sms
shared_geo
shared_gauth
```

They can live in the same Supabase Postgres project/database to save cost, but
they use a separate runtime connection string and should be owned by the
shared-service runtime, not by API Center gateway code.

## Required Environment

Add these keys to `api-center-prod` only after a Postgres database exists:

```json
{
  "DATABASE_ENABLED": "true",
  "DATABASE_PROVIDER": "supabase",
  "DATABASE_URL": "postgresql://api_center_app:<password>@<supabase-session-pooler-host>:5432/postgres",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "true"
}
```

Use `REGISTRY_SOURCE=redis` during migration. Enable `REGISTRY_DUAL_WRITE=true`
only after the migrations are applied and the Postgres write path is verified.
Do not switch to `postgres` until registry backfill and read-path verification
are complete.

## Local Commands

Initialize/link Supabase CLI locally:

```powershell
cd C:\Codes\apic\api-center
npx supabase init
npx supabase login
npx supabase link --project-ref <project-ref>
```

Create a new migration:

```powershell
cd C:\Codes\apic\api-center
npx supabase migration new <descriptive_name>
```

Test migrations locally:

```powershell
cd C:\Codes\apic\api-center
npx supabase start
npx supabase db reset
```

Preview and apply migrations to the linked Supabase project:

```powershell
cd C:\Codes\apic\api-center
npx supabase db push --dry-run
npx supabase db push
```

Generate the Prisma client only if API Center runtime code still uses `PrismaService`:

```powershell
$env:DATABASE_URL="postgresql://api_center_app:password@localhost:5432/postgres?schema=api_center"
npm run db:generate
```

## GCP Deployment Notes

For GKE, the database should be reachable from the API Center pods through the Supabase pooled runtime connection string. Keep the DB credentials in Secret Manager, not in Kubernetes manifests.

Recommended rollout sequence:

1. Create or choose the Supabase Postgres project.
2. Create separate runtime and operator/migration credentials where possible.
3. Run `npx supabase db push --dry-run`, then `npx supabase db push`, from a trusted operator environment or CI job.
4. Add DB env keys to `api-center-prod` with `DATABASE_ENABLED=true`,
   `REGISTRY_SOURCE=redis`, and `REGISTRY_DUAL_WRITE=false`.
5. Restart API Center and verify readiness.
6. Switch `REGISTRY_DUAL_WRITE=true` after migrations and focused tests pass.
7. Backfill registry/provisioning state.
8. Compare Redis and Postgres reads.
9. Switch `REGISTRY_SOURCE=postgres` only after verification.

Rollback is simple during the migration window:

```text
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=false
```

## Current Implementation Status

The API Center Prisma schema, Supabase CLI config, initial Supabase SQL
migration, config flags, Prisma service, registry Postgres store abstraction,
registry dual-write hooks, and Redis-to-Postgres registry backfill script are
present. Redis is still the active registry source by default.

Still pending before Postgres becomes the active source of truth:

1. Apply/verify migrations in test, then production.
2. Enable `REGISTRY_DUAL_WRITE=true` after migrations are confirmed.
3. Backfill existing Redis registry data into Postgres with
   `npm run db:backfill:registry`.
4. Add parity checks between Redis and Postgres reads.
5. Switch `REGISTRY_SOURCE=postgres` only after parity checks pass.
6. Keep rollback to `REGISTRY_SOURCE=redis` documented and tested.
