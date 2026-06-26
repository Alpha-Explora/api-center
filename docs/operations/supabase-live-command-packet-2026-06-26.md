# APICenter Supabase Live Migration Command Packet

Generated: 2026-06-26T00:06:38.077Z

Approval ready: yes
Pre-apply ready: yes
Approval gates: 16/16 ready
Blocked gates: pre-apply 0; post-apply 0
Linked project ref: `hguyivbodlrmooayuxwt`
Codex MCP project ref: `hguyivbodlrmooayuxwt`
Project-ref mismatch: no

## Required Inputs

- `SUPABASE_TARGET_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF`
- `APICENTER_ENVIRONMENT_NAME or SUPABASE_TARGET_ENVIRONMENT`
- `DATABASE_URL`
- `Supabase CLI OAuth login or SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `DATABASE_ENABLED`
- `DATABASE_DUAL_WRITE`
- `REGISTRY_SOURCE`
- `REGISTRY_DUAL_WRITE`
- `APICENTER_MIGRATION_ROLLOUT_STRATEGY`
- `API_CENTER_BASE_URL or APICENTER_URL`
- `MANAGEMENT_BASE_URL or APICENTER_MANAGEMENT_URL`
- `REDIS_CACHE_URL or REDIS_URL or CACHE_URL`
- `API_CENTER_PREVIOUS_IMAGE or API_CENTER_ROLLBACK_IMAGE`
- `API_CENTER_LOG_FILE or API_CENTER_LOG_DIR for post-cutover log scans`

## Command Phases

### Confirm target project and environment

Blocked by current evidence: no

```powershell
$env:SUPABASE_TARGET_PROJECT_REF="hguyivbodlrmooayuxwt"
$env:APICENTER_ENVIRONMENT_NAME="<test|uat|prod>"
$env:CODEX_SUPABASE_MCP_PROJECT_REF="hguyivbodlrmooayuxwt"
$env:APICENTER_MIGRATION_ROLLOUT_STRATEGY="compatibility_views"
$env:APICENTER_COMPATIBILITY_VIEWS_APPROVED="true"
npm run db:preflight:live -- --out docs/operations/supabase-live-preflight-2026-06-26.json
npm run db:rollout-strategy:evidence -- --out docs/operations/migration-rollout-strategy-2026-06-26.json
```

### Collect pre-approval Supabase evidence

Blocked by current evidence: no

```powershell
npm run db:discover:roles -- --out docs/operations/supabase-role-discovery-2026-06-26.json
npm run db:grant-alignment:evidence -- --out docs/operations/grant-alignment-2026-06-26.json
npm run db:row-counts:evidence -- --out docs/operations/supabase-row-counts-2026-06-26.json
npm run db:migration-list:evidence -- --run-linked --out docs/operations/supabase-migration-list-2026-06-26.json
npm run db:backup:evidence -- --run-dump --out docs/operations/supabase-backup-readiness-2026-06-26.json
npm run db:dry-run:evidence -- --run-dry-run --out docs/operations/supabase-dry-run-readiness-2026-06-26.json
npm run db:advisors:evidence -- --run-advisors --out docs/operations/supabase-advisors-readiness-2026-06-26.json
```

### Prove safe rollout mode and old/new readiness

Blocked by current evidence: no

```powershell
$env:DATABASE_ENABLED="true"
$env:DATABASE_DUAL_WRITE="true"
$env:REGISTRY_SOURCE="redis"
$env:REGISTRY_DUAL_WRITE="true"
npm run db:safe-rollout:evidence -- --out docs/operations/api-center-safe-rollout-2026-06-26.json
npm run db:rollback:evidence -- --out docs/operations/api-center-rollback-readiness-2026-06-26.json
npm run db:readiness:evidence -- --phase old --out docs/operations/readiness-old-2026-06-26.json
npm run db:readiness:evidence -- --phase new --out docs/operations/readiness-new-2026-06-26.json
```

### Regenerate approval packet and enforce no pre-apply blockers

Blocked by current evidence: no

```powershell
npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md --fail-on-pre-apply-blockers
```

### Apply migration after pre-apply approval, then prove post-apply gates

Blocked by current evidence: no

```powershell
npm run db:migration:push
npm run db:verifier:evidence -- --out docs/operations/supabase-verifier-readiness-2026-06-26.json
npm run db:registry-parity:evidence -- --out docs/operations/registry-parity-2026-06-26.json
npm run registry:verify
$env:REGISTRY_SOURCE="postgres"
npm run db:readiness:evidence -- --phase new --out docs/operations/readiness-new-2026-06-26.json
```

### Capture post-cutover monitoring evidence

Blocked by current evidence: no

```powershell
npm run db:logs:missing-table:evidence -- --out docs/operations/missing-table-log-scan-2026-06-26.json
npm run db:postcutover-errors:evidence -- --out docs/operations/postcutover-error-log-scan-2026-06-26.json
npm run db:compliance-export:evidence -- --out docs/operations/compliance-export-smoke-2026-06-26.json
```

## Blocked Gates

- No blocked approval gates.

## Post-Apply Gates

- No blocked post-apply gates.
