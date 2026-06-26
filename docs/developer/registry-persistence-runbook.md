# Registry Persistence Runbook

Use this when changing APICenter service registry persistence or diagnosing
Redis/Postgres registry drift.

## Current Model

Postgres is the durable registry source of truth through the `apic_catalog`
schema. The runtime registry still keeps an in-memory cache for fast lookups, and
Redis remains the hot cache and rollback source.

| Mode | Required flags | Startup source | Write behavior | Use when |
| --- | --- | --- | --- | --- |
| Postgres source with Redis fallback | `DATABASE_ENABLED=true`, `REGISTRY_SOURCE=postgres`, `DATABASE_DUAL_WRITE=true` | Postgres, then Redis fallback when configured | Memory, Redis cache, Postgres durable write | Normal shared environments after parity. |
| Redis rollback source | `DATABASE_ENABLED=true`, `REGISTRY_SOURCE=redis`, `DATABASE_DUAL_WRITE=true` | Redis | Memory, Redis, then Postgres best effort | Temporary rollback or drift investigation. |
| Redis only | `DATABASE_ENABLED=false` or `DATABASE_DUAL_WRITE=false`, `REGISTRY_SOURCE=redis` | Redis | Memory plus Redis | Emergency rollback when Postgres writes block registry changes. |
| Emergency memory only | Redis unavailable during local/dev startup | None | Memory only after startup warning | Local diagnostics only; do not use for shared environments. |

## Migration Authority

Supabase SQL migrations under `api-center/supabase/migrations` are the canonical
live database history for APICenter control-plane schemas. Prisma migrations are
not used as the live deployment mechanism. Keep `prisma/schema.prisma` in sync so
application code remains typed and generated.

For future control-plane schema changes:

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:new -- <descriptive_name>
npm run db:migration:push:dry
npm run db:verify:control-plane -- --app-role <discovered_app_role>
npm run db:migration:push
npm run db:generate
```

Migration filenames must come from the Supabase CLI. Do not invent migration
timestamps by hand.

## Drift Checks

Run these after a flag change, deployment, or suspected registry mismatch:

```powershell
cd C:\Codes\apic\api-center
npm run registry:verify
npm run check:boundaries
```

For live environments, also verify:

```text
GET /api/v1/registry/services
GET /api/v1/health/ready
```

Record the active values of `DATABASE_ENABLED`, `DATABASE_DUAL_WRITE`, and
`REGISTRY_SOURCE` with validation evidence.

## Rollback

To roll back reads without deleting Postgres data:

```text
REGISTRY_SOURCE=redis
DATABASE_ENABLED=true
DATABASE_DUAL_WRITE=true
```

This keeps Redis as the startup source while Postgres continues receiving writes
for later inspection. If Postgres writes are failing and blocking registry
changes, set `DATABASE_DUAL_WRITE=false` and keep `REGISTRY_SOURCE=redis`.

## Recovery Checks

After rollback or recovery:

1. Register, update, deprecate, and deregister a non-production test service.
2. Confirm the registry API returns the expected service state.
3. Run `npm run registry:verify` and inspect any Redis/Postgres drift report.
4. Switch `REGISTRY_SOURCE=postgres` only after reads and writes match again.
