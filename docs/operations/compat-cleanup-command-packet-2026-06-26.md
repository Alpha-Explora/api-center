# APICenter Compatibility Cleanup Command Packet

Generated: 2026-06-26T01:26:08.907Z

Cleanup ready: yes
Readiness artifact: `docs/operations/compat-cleanup-readiness-2026-06-26.json`
Target migration: `supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql`
Stable deployment confirmed: yes
Cleanup approved: yes
Runtime legacy references: 0

## Required Inputs

- `APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT`
- `APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT or collector run time after the window completes`
- `APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION`
- `APICENTER_COMPATIBILITY_CLEANUP_STABLE_DEPLOYMENT=true`
- `APICENTER_COMPATIBILITY_CLEANUP_APPROVED=true`
- `DATABASE_URL for the approved live Supabase project`
- `SUPABASE_DB_PASSWORD or linked Supabase CLI auth`
- `A reviewed dry-run showing only legacy compatibility view drops`

Approval checkpoint: Do not set approval flags inside the packet. `APICENTER_COMPATIBILITY_CLEANUP_APPROVED=true` must come from an explicit operator approval in the shell or deployment context before dry-run/apply commands are run.

## Command Phases

### Confirm compatibility cleanup readiness

Blocked by current evidence: no

```powershell
npm run db:compat-cleanup:k8s -- --out docs/operations/compat-cleanup-k8s-2026-06-26.json
npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-2026-06-26.json
npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json --fail-on-blockers
npm run db:compat-cleanup:migration-static
```

### Dry-run compatibility cleanup migration

Blocked by current evidence: no

```powershell
npm run db:migration:push:dry
npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json --fail-on-blockers
```

### Apply compatibility cleanup after dry-run approval

Blocked by current evidence: no

```powershell
npm run db:migration:push
npm run db:verifier:evidence -- --post-compat-cleanup --out docs/operations/supabase-verifier-readiness-2026-06-26.json
npm run db:readiness:evidence -- --phase new --out docs/operations/readiness-new-2026-06-26.json
npm run db:logs:missing-table:evidence -- --out docs/operations/missing-table-log-scan-2026-06-26.json
npm run db:postcutover-errors:evidence -- --out docs/operations/postcutover-error-log-scan-2026-06-26.json
```

## Blockers

- No cleanup blockers.
