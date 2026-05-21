# Registry Persistence Runbook

Use this when changing APICenter service registry persistence or diagnosing
Redis/Postgres registry drift.

## Current Model

The runtime registry always keeps an in-memory cache for lookups. Redis remains
the default persistent source. Postgres is available for the control-plane
database cutover and is enabled only by explicit flags.

| Mode | Required flags | Startup source | Write behavior | Use when |
| --- | --- | --- | --- | --- |
| Redis only | `DATABASE_ENABLED=false` or `DATABASE_DUAL_WRITE=false`, `REGISTRY_SOURCE=redis` | Redis | Memory plus Redis | Normal fallback or early local testing. |
| Redis source with Postgres dual-write | `DATABASE_ENABLED=true`, `DATABASE_DUAL_WRITE=true`, `REGISTRY_SOURCE=redis` | Redis | Memory plus Redis, then Postgres | Backfill/cutover validation before switching source. |
| Postgres source with dual-write | `DATABASE_ENABLED=true`, `DATABASE_DUAL_WRITE=true`, `REGISTRY_SOURCE=postgres` | Postgres | Memory plus Redis, then Postgres | Cutover test after Redis and Postgres are reconciled. |
| Emergency memory only | Redis unavailable during local/dev startup | None | Memory only after startup warning | Local diagnostics only; do not use for shared environments. |

## Cutover Sequence

1. Run Redis as the active source and confirm the registry API returns the
   expected services.
2. Enable `DATABASE_ENABLED=true` and `DATABASE_DUAL_WRITE=true` while keeping
   `REGISTRY_SOURCE=redis`.
3. Backfill the current Redis registry into Postgres:

   ```powershell
   cd C:\Codes\apic\api-center
   npm run db:backfill:registry
   ```

4. Run the registry drift check endpoint or test helper used by the current
   release branch.
5. Switch only the test environment to `REGISTRY_SOURCE=postgres`.
6. Re-register, deprecate, and deregister a non-production test service.
7. If reads and writes match, repeat the same flag change for production during
   an approved maintenance window.

## Rollback

To roll back read source without deleting data:

```text
REGISTRY_SOURCE=redis
DATABASE_ENABLED=true
DATABASE_DUAL_WRITE=true
```

This keeps Redis as the startup source while Postgres continues receiving writes
for later inspection. If Postgres writes are failing and blocking registry
changes, set `DATABASE_DUAL_WRITE=false` and keep `REGISTRY_SOURCE=redis`.

## Verification

Run these after a flag change:

```powershell
cd C:\Codes\apic\api-center
npm test -- registry.service.spec.ts
npm run check:boundaries
```

For live environments, also verify:

```text
GET /api/v1/registry/services
GET /api/v1/health/ready
```

Record the active values of `DATABASE_ENABLED`, `DATABASE_DUAL_WRITE`, and
`REGISTRY_SOURCE` with the validation evidence.
