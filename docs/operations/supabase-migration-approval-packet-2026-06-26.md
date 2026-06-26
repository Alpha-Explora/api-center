# APICenter Supabase Migration Approval Packet

Generated: 2026-06-26T01:26:39.537Z

Approval ready: yes
Gates ready: 16/16

## Gate Status

| Gate | Status | Evidence | Blockers | Next action |
| --- | --- | --- | --- | --- |
| Target Supabase project and environment | ready | docs/operations/supabase-live-preflight-2026-06-26.json | None | Capture SUPABASE_TARGET_PROJECT_REF and APICENTER_ENVIRONMENT_NAME in preflight evidence, and ensure Codex MCP points at the same project before approval. |
| Live API Center env flags | ready | docs/operations/supabase-live-preflight-2026-06-26.json | None | Capture DATABASE_ENABLED, DATABASE_DUAL_WRITE, REGISTRY_SOURCE, and REGISTRY_DUAL_WRITE from the live deployment environment. |
| Runtime app role discovery | ready | docs/operations/supabase-role-discovery-2026-06-26.json | None | Run role discovery with DATABASE_URL, then apply least-privilege grants to explicit roles only. |
| Migration grants match discovered app roles | ready | docs/operations/grant-alignment-2026-06-26.json | None | Update migration grant targets from live role discovery and rerun grant-alignment evidence before approval. |
| Live row-count inventory | ready | docs/operations/supabase-row-counts-2026-06-26.json | None | Capture live registry/control-plane row counts before applying DDL. |
| Static enterprise migration DDL guard | ready | docs/operations/supabase-verifier-readiness-2026-06-26.json | None | Run npm run db:verify:enterprise-static and regenerate verifier evidence before approval. |
| Schema verifier required modes | ready | docs/operations/supabase-verifier-readiness-2026-06-26.json | None | Run base, compatibility-view, and retention-policy verifier modes before approval. |
| Migration rollout strategy approval | ready | docs/operations/migration-rollout-strategy-2026-06-26.json | None | Choose and approve APICENTER_MIGRATION_ROLLOUT_STRATEGY as compatibility_views or controlled_window before approval. |
| Linked Supabase migration history | ready | docs/operations/supabase-migration-list-2026-06-26.json | None | List linked migrations and compare remote history with repository migrations before approval. |
| Safe registry rollout mode | ready | docs/operations/api-center-safe-rollout-2026-06-26.json | None | Set DATABASE_ENABLED=true, DATABASE_DUAL_WRITE=true, REGISTRY_SOURCE=redis, and REGISTRY_DUAL_WRITE=true before applying DDL. |
| Redis/Postgres registry parity | ready | docs/operations/registry-parity-2026-06-26.json | None | Run Redis/Postgres registry parity in the live operator shell before switching REGISTRY_SOURCE=postgres. |
| Live backup or schema/data dump | ready | docs/operations/supabase-backup-readiness-2026-06-26.json | None | Create the live dump and verify restore path. |
| Supabase dry-run against restored/disposable database | ready | docs/operations/supabase-dry-run-readiness-2026-06-26.json | None | Run dry-run after dump/restore prerequisites are met. |
| Supabase advisors reviewed | ready | docs/operations/supabase-advisors-readiness-2026-06-26.json | None | Run advisors and review security/performance findings. |
| Old and new API Center/Management readiness | ready | docs/operations/readiness-prelive-2026-06-26.json, docs/operations/readiness-new-2026-06-26.json, docs/operations/readiness-old-2026-06-26.json | None | Run readiness evidence twice, once with --phase old and once with --phase new, using live API Center and Management URLs. |
| Rollback config and previous image | ready | docs/operations/api-center-rollback-readiness-2026-06-26.json | None | Capture REGISTRY_SOURCE=redis, DATABASE_DUAL_WRITE=false, and previous API Center image tag. |

## Operator Next Actions

- All gates are ready for approval review.
