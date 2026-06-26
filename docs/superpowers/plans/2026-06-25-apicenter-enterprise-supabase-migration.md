# APICenter Enterprise Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Supabase Postgres the durable APICenter tracking backbone with enterprise-ready schema names, bounded ownership, migration safety, and auditable live rollout gates.

**Architecture:** API Center remains one deployable modular monolith for phase 1, with service-ready bounded contexts for catalog, governance, runtime operations, audit/evidence, data-pipeline governance, gateway control plane, and shared-service platform controls. Supabase SQL migrations are the canonical live database history; Prisma remains the typed application client mapped to owner schemas. Live rollout uses compatibility views or a controlled migration window so old `api_center*` names do not disappear while old pods can still run.

**Tech Stack:** Supabase Postgres, Supabase CLI migrations, Prisma multi-schema client, NestJS API Center, Redis registry fallback, GKE, Vercel Management UI, PowerShell verification commands.

**Visual tracker:** `../../visualizations/enterprise-supabase-migration-tracker.html`

**Tracking discipline:** After every implementation slice, check only the Markdown tasks that have current evidence, add a nearby `Verification recorded:` note when the evidence is not obvious from the checkbox, then regenerate the visual tracker with `node scripts/generate-migration-tracker.js`.

---

## Progress Tracking Artifacts

- [x] Created a static HTML tracker for slice-level progress and open work: `docs/visualizations/enterprise-supabase-migration-tracker.html`.
- [x] Linked the tracker from the active plan index.
- [x] Added a repeatable tracker generator script: `node scripts/generate-migration-tracker.js`.
- [x] Regenerated the static HTML tracker after Task 1 row-count verifier and Task 12 dry-run evidence updates.
- [x] Regenerated the static HTML tracker after Task 2 source-of-truth and Task 3 local DDL updates.
- [x] Regenerated the static HTML tracker after Task 7 security posture and Task 7A retention updates.
- [x] Regenerated the static HTML tracker after Task 6 required-audit sub-slice.
- [x] Upgraded the static HTML tracker to show checked-slice verification notes, not just checkbox counts.
- [x] Regenerated the static HTML tracker after Task 6 runtime topic/sink audit sub-slice.
- [x] Regenerated the static HTML tracker after Task 6 exact action-name and entitlement update sub-slice.
- [x] Regenerated the static HTML tracker after normalized service-call and source-metadata pre-live verification.
- [x] Regenerated the static HTML tracker after final checklist source-metadata and service-call verification.
- [x] Regenerated the static HTML tracker after API Center pre-live local build/test verification.
- [x] Regenerated the static HTML tracker after documentation/evidence final checklist reconciliation.
- [x] Regenerated the static HTML tracker after Management source-backed matrix and freshness contract verification.
- [x] Added and ran a redacted live migration preflight evidence collector: `npm run db:preflight:live -- --out docs/operations/supabase-live-preflight-2026-06-26.json`.
- [x] Added and ran static enterprise migration verification: `npm run db:verify:enterprise-static:test` and `npm run db:verify:enterprise-static`.
- [x] Added and ran redacted runtime role discovery tooling: `npm run db:discover:roles:test` and `npm run db:discover:roles -- --out docs/operations/supabase-role-discovery-2026-06-26.json`.
- [x] Documented the tracking discipline: check tasks only after evidence exists, record verification notes, and regenerate the HTML tracker after each completed slice.
- [x] Added and ran rollback readiness evidence tooling: `npm run db:rollback:evidence:test` and `npm run db:rollback:evidence -- --out docs/operations/api-center-rollback-readiness-2026-06-26.json`.
- [x] Added and ran Supabase advisor readiness evidence tooling: `npm run db:advisors:evidence:test` and `npm run db:advisors:evidence -- --out docs/operations/supabase-advisors-readiness-2026-06-26.json`.
- [x] Added and ran Supabase backup readiness evidence tooling: `npm run db:backup:evidence:test` and `npm run db:backup:evidence -- --out docs/operations/supabase-backup-readiness-2026-06-26.json`.
- [x] Added and ran Supabase dry-run readiness evidence tooling: `npm run db:dry-run:evidence:test` and `npm run db:dry-run:evidence -- --out docs/operations/supabase-dry-run-readiness-2026-06-26.json`.
- [x] Added and ran API Center and Management readiness evidence tooling: `npm run db:readiness:evidence:test` and `npm run db:readiness:evidence -- --out docs/operations/readiness-prelive-2026-06-26.json`.
- [x] Added and ran the pre-live approval packet generator: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Added and ran redacted live row-count evidence tooling: `npm run db:row-counts:evidence:test` and `npm run db:row-counts:evidence -- --out docs/operations/supabase-row-counts-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so row-count evidence is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Added and ran consolidated schema verifier evidence tooling: `npm run db:verifier:evidence:test` and `npm run db:verifier:evidence -- --out docs/operations/supabase-verifier-readiness-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so schema verifier evidence is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Added and ran linked Supabase migration-list evidence tooling: `npm run db:migration-list:evidence:test` and `npm run db:migration-list:evidence -- --out docs/operations/supabase-migration-list-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so linked migration history is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Fixed direct Supabase migration-history evidence for current `supabase_migrations.schema_migrations` columns and metadata-only output: `npm run db:migration-list:evidence:test`, `node -r dotenv/config scripts/collect-supabase-migration-list-evidence.js --out docs/operations/supabase-migration-list-2026-06-26.json`, and `npm run db:approval:packet:check`.
- [x] Added and ran safe registry rollout evidence tooling: `npm run db:safe-rollout:evidence:test` and `npm run db:safe-rollout:evidence -- --out docs/operations/api-center-safe-rollout-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so safe rollout mode is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Added and ran Redis/Postgres registry parity evidence tooling: `npm run db:registry-parity:evidence:test` and `npm run db:registry-parity:evidence -- --out docs/operations/registry-parity-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so registry parity is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Added and ran grant-alignment evidence tooling: `npm run db:grant-alignment:evidence:test` and `npm run db:grant-alignment:evidence -- --out docs/operations/grant-alignment-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so grant alignment is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Split static enterprise migration verification into its own approval packet gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Added and ran migration tracking consistency tooling: `npm run db:tracking:consistency:test` and `node scripts/check-migration-tracking-consistency.js --out docs/operations/migration-tracking-consistency-2026-06-26.json --fail-on-blockers`.
- [x] Regenerated the static HTML tracker after the schema verifier evidence wrapper slice.
- [x] Regenerated the static HTML tracker after the linked migration-list evidence wrapper slice.
- [x] Regenerated the static HTML tracker after the safe rollout evidence wrapper slice.
- [x] Regenerated the static HTML tracker after the registry parity evidence wrapper slice.
- [x] Regenerated the static HTML tracker after the grant-alignment evidence wrapper slice.
- [x] Regenerated the static HTML tracker after the static migration approval gate split.
- [x] Added and ran derived FK-index static verification: `npm run db:verify:enterprise-static:test` and `npm run db:verify:enterprise-static`.
- [x] Regenerated the verifier evidence and approval packet after adding the FK-index guard: `npm run db:verifier:evidence -- --out docs/operations/supabase-verifier-readiness-2026-06-26.json` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Regenerated the static HTML tracker after the FK-index static guard slice.
- [x] Added and ran target-project mismatch evidence: `node scripts/live-migration-preflight.test.js`, `npm run db:approval:packet:test`, `npm run db:preflight:live -- --out docs/operations/supabase-live-preflight-2026-06-26.json`, and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Regenerated the static HTML tracker after the Supabase MCP project-ref mismatch safety slice.
- [x] Added and ran executable target-confirmation evidence: `node scripts/live-migration-preflight.test.js`, `npm run db:approval:packet:test`, `npm run db:preflight:live -- --out docs/operations/supabase-live-preflight-2026-06-26.json`, and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Regenerated the static HTML tracker after the target-confirmation evidence contract slice.
- [x] Added and ran enforceable approval-packet check mode: `npm run db:approval:packet:test` and `npm run db:approval:packet:check` confirmed blocked approval exits nonzero while gates remain blocked.
- [x] Regenerated the static HTML tracker after the approval-packet check-mode slice.
- [x] Added and ran rollout-strategy evidence tooling: `npm run db:rollout-strategy:evidence:test` and `npm run db:rollout-strategy:evidence -- --out docs/operations/migration-rollout-strategy-2026-06-26.json`.
- [x] Updated and regenerated the pre-live approval packet so rollout strategy is a first-class approval gate: `npm run db:approval:packet:test` and `npm run db:approval:packet -- --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`.
- [x] Regenerated the static HTML tracker after the rollout-strategy approval gate slice.
- [x] Added and ran missing-table log evidence tooling: `npm run db:logs:missing-table:evidence:test` and `npm run db:logs:missing-table:evidence -- --out docs/operations/missing-table-log-scan-2026-06-26.json`.
- [x] Regenerated the static HTML tracker after the missing-table log evidence slice.
- [x] Regenerated the static HTML tracker after the migration tracking consistency guard slice.
- [x] Regenerated the static HTML tracker after the live row-count evidence wrapper slice.
- [x] Added and ran compliance export smoke evidence tooling: `npm run db:compliance-export:evidence:test` and `npm run db:compliance-export:evidence -- --out docs/operations/compliance-export-smoke-2026-06-26.json`.
- [x] Authenticated the Codex Supabase MCP server configured for `hguyivbodlrmooayuxwt`: `codex mcp login supabase` completed successfully, and `codex mcp list` shows `supabase` enabled with OAuth auth.
- [x] Relinked the local Supabase CLI metadata to live project `hguyivbodlrmooayuxwt` (`api-center-live`) with `supabase link --project-ref hguyivbodlrmooayuxwt --skip-pooler`, regenerated preflight evidence with `APICENTER_ENVIRONMENT_NAME=live`, and rebuilt approval/command packets to remove the stale project-ref mismatch blocker.
- [x] Wrote gitignored `.env` live-migration defaults for target confirmation, safe dual-write rollout, compatibility-view strategy, API Center/Management URLs, and Redis URLs; regenerated preflight, rollout-strategy, safe-rollout, readiness, approval, and command evidence with `dotenv/config`.
- [x] Regenerated the static HTML tracker after the compliance export smoke evidence slice.
- [x] Added and ran post-cutover audit/Prisma error log evidence tooling: `npm run db:postcutover-errors:evidence:test` and `npm run db:postcutover-errors:evidence -- --out docs/operations/postcutover-error-log-scan-2026-06-26.json`.
- [x] Regenerated the static HTML tracker after the post-cutover error log evidence slice.
- [x] Added and ran live operator command-packet tooling: `npm run db:live-command-packet:test` and `npm run db:live-command-packet -- --out docs/operations/supabase-live-command-packet-2026-06-26.json --md-out docs/operations/supabase-live-command-packet-2026-06-26.md`.
- [x] Regenerated the static HTML tracker after the live command-packet slice.
- [x] Strengthened static DDL verification for status-column check constraints, audit delete denial, and private-schema grant exposure: `npm run db:verify:enterprise-static:test` and `npm run db:verify:enterprise-static`.
- [x] Added generic static verification that fails any future `status` column without an inline check constraint: `npm run db:verify:enterprise-static:test` and `npm run db:verify:enterprise-static`.
- [x] Regenerated verifier evidence, approval packet, command packet, and tracker after the generic status-column guard slice.
- [x] Applied live Supabase migrations through `20260625234334_grant_registry_child_delete_privileges.sql`, rotated the live API Center Secret Manager DB settings to the least-privilege `api_center_app` role, deployed `supabase-registry-sourcefix-512551d-20260626075800`, and proved registry readiness/parity.
- [x] Regenerated approval packet, command packet, live evidence artifacts, and the static HTML tracker after the live migration/cutover slice.
- [x] Added and ran compatibility-cleanup readiness evidence tooling: `npm run db:compat-cleanup:readiness:test` and `npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json`.
- [x] Extended compatibility-cleanup readiness to scan both API Center and Management runtime source for legacy `api_center*` schema references before allowing view cleanup.
- [x] Generated the local compatibility cleanup migration `supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql`, added a static verifier, and confirmed it only drops the legacy compatibility views.
- [x] Added the compatibility-cleanup static migration verifier into the cleanup readiness gate: `npm run db:compat-cleanup:readiness:test` and `npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json`.
- [x] Added and ran the compatibility-cleanup command packet gate: `npm run db:compat-cleanup:command-packet:test` and `npm run db:compat-cleanup:command-packet -- --out docs/operations/compat-cleanup-command-packet-2026-06-26.json --md-out docs/operations/compat-cleanup-command-packet-2026-06-26.md`.
- [x] Added and ran stable-window evidence tooling for compatibility cleanup: `npm run db:compat-cleanup:stability:test` and `npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-2026-06-26.json`.
- [x] Added tested stable-window inference from readiness uptime plus non-placeholder deployment identity; live evidence remains blocked because API Center currently reports `imageTag=local`.
- [x] Added and ran Kubernetes-backed compatibility-cleanup deployment evidence tooling: `npm run db:compat-cleanup:k8s:test` and `npm run db:compat-cleanup:k8s -- --out docs/operations/compat-cleanup-k8s-2026-06-26.json`.
- [x] Fixed tracker percentage precision so open work cannot render as `100%`: `npm run db:tracker:test` and `npm run db:tracking:consistency:test`.
- [x] Hardened the compatibility-cleanup command packet so blocked packets do not render self-approval commands: `npm run db:compat-cleanup:command-packet:test` and `npm run db:compat-cleanup:command-packet -- --out docs/operations/compat-cleanup-command-packet-2026-06-26.json --md-out docs/operations/compat-cleanup-command-packet-2026-06-26.md`.
- [x] Applied the approved compatibility cleanup migration, dropped the empty legacy `api_center*` schemas, regenerated post-cleanup verifier/readiness/command-packet evidence, and refreshed the HTML tracker.

## Current Findings

- Live deployment is configured for Supabase-backed registry reads through `DATABASE_ENABLED=true`, `DATABASE_URL`, and `REGISTRY_SOURCE=postgres`.
- The live database is only partially migrated. Runtime checks showed missing tables such as `api_center.service_environments`, `api_center_ops.service_registration_requests`, quota tables, plan tables, approval requests, and topic onboarding state.
- Migration history is split. `supabase/migrations` contains shared-service schemas, registration requests, quota policies, plan entitlements, approvals, and other live-control-plane SQL. `prisma/migrations` contains `service_environments` and several pipeline feedback migrations that do not fully match `supabase/migrations`.
- Current schemas are too broad. `api_center` mixes catalog with event/sink inventory. `api_center_ops` mixes governance workflow, runtime telemetry, provisioning queues, quota decisions, and approval state. `api_center_audit` is directionally correct but needs immutability, retention, and access rules.

## Enterprise Naming Standard

Use lower snake_case for every schema, table, column, index, and constraint. Do not use quoted identifiers. Use plural table names for entity collections.

| Schema | Purpose | Rule |
| --- | --- | --- |
| `apic_catalog` | Durable API/service catalog and routable metadata | Configuration and registry state needed to serve traffic |
| `apic_governance` | Requests, approvals, policies, entitlements, stewardship decisions | Human or policy workflow state |
| `apic_runtime` | Observations, provisioning jobs, operational state, usage, quota evaluations | High-write or operationally derived records |
| `apic_audit` | Append-only audit events | Immutable evidence for who/what/when/why |
| `apic_gateway` | Gateway routes, consumers, subscriptions, credentials, policies, config publish snapshots, runtime rollups | Phase 1.5 gateway control-plane bounded context; not required for the phase 1 control-plane migration |
| `shared_*` | Shared-service-owned business/provider state | Owned by `api-shared-services`, not API Center runtime |
| `shared_core` | Cross-shared-service provider accounts, entitlements, usage rollups, idempotency, webhooks, and outbox events | Phase 1.5 shared-service platform bounded context; should remain outside API Center phase 1 control-plane schemas |

Naming rules:

- Prefer domain concepts over current implementation names.
- Use provider-neutral names only after APICenter owns a provider-neutral abstraction. Keep provider names when the current product and code are provider-specific, such as `confluent_topics` and `s3_sink_topics`.
- Use `owner_tribe_id` as a column, not a table prefix, unless the table stores tribe entities themselves.
- Use `environment` as a column for `test`, `uat`, `prod`, and future deployment stages.
- Use `status` plus `status_reason` for workflow state, and `requested_by`, `approved_by`, `rejected_by`, or `actor_id` for accountability.
- Store secrets only as Secret Manager references or hash metadata. Never store plaintext provider secrets in Supabase.

## Target Table Map

| Current table | Target table | Target schema |
| --- | --- | --- |
| `api_center.organizations` | `organizations` | `apic_catalog` |
| `api_center.services` | `services` | `apic_catalog` |
| `api_center.service_environments` | `service_environments` | `apic_catalog` |
| `api_center.service_routes` | `service_routes` | `apic_catalog` |
| `api_center.service_scopes` | `service_scopes` | `apic_catalog` |
| `api_center.service_dependencies` | `service_dependencies` | `apic_catalog` |
| `api_center.service_lifecycle_events` | `service_lifecycle_events` | `apic_catalog` |
| `api_center.tribe_secret_refs` | `service_secret_references` | `apic_catalog` |
| `api_center_ops.service_registration_requests` | `registry_change_requests` | `apic_governance` |
| `api_center_ops.approval_requests` | `approval_requests` | `apic_governance` |
| `api_center_ops.tribe_api_quota_policies` | `quota_policies` | `apic_governance` |
| `api_center_ops.tribe_plan_definitions` | `entitlement_plans` | `apic_governance` |
| `api_center_ops.tribe_plan_assignments` | `entitlement_assignments` | `apic_governance` |
| `api_center_ops.provisioning_jobs` | `provisioning_jobs` | `apic_runtime` |
| `api_center_ops.topic_onboarding_states` | `event_topic_onboarding_states` | `apic_runtime` |
| `api_center.confluent_topics` | `confluent_topics` | `apic_runtime` |
| `api_center.s3_sink_topics` | `s3_sink_topics` | `apic_runtime` |
| `api_center_ops.health_snapshots` | `health_snapshots` | `apic_runtime` |
| `api_center_ops.smoke_test_runs` | `smoke_test_runs` | `apic_runtime` |
| `api_center_ops.usage_rollups` | `usage_rollups` | `apic_runtime` |
| `api_center_ops.tribe_api_quota_decisions` | `quota_evaluations` | `apic_runtime` |
| `api_center_ops.pipeline_feedback_actions` | `pipeline_feedback_actions` | `apic_runtime` |
| `api_center_audit.audit_events` | `audit_events` | `apic_audit` |

## Modular Monolith Target

APICenter should stay a modular monolith until a bounded context proves it needs independent scaling, deployment, ownership, security isolation, or failure isolation. Microservice readiness is achieved by enforcing module boundaries now, not by splitting deployments before the product boundaries are stable.

Current deployment rule: one NestJS API Center deployable, one Management UI, and private Supabase schemas. Future extraction rule: a bounded context may become a microservice only when it already has a clear owner schema, API contract, event contract, release gate, rollback path, and no direct table access from other contexts.

| Bounded context | Current module area | Owner schema or store | Future service path | Boundary rule |
| --- | --- | --- | --- | --- |
| Catalog and registry | `src/registry`, `src/catalog` | `apic_catalog`, Redis registry cache | Catalog Service | Owns service metadata, environments, routes, scopes, dependencies, and service secret references. Other contexts consume catalog APIs/read models, not catalog tables directly. |
| Governance | `src/approvals`, `src/quotas`, `src/entitlements`, `src/developer-portal`, `src/policy` | `apic_governance` | Governance Service | Owns requests, approvals, policies, plans, quota policy, entitlement state, and provider-impacting workflow decisions. |
| Runtime operations | `src/analytics`, `src/health`, `src/forecasting`, selected `src/operations` | `apic_runtime`, Redis windows, external telemetry | Runtime Operations Service | Owns operational observations, health, smoke tests, usage rollups, quota evaluations, and projections. Hot-path counters stay out of synchronous Postgres writes. |
| Audit and evidence | `src/compliance`, audit analytics, promotion evidence in `src/operations` | `apic_audit`, future evidence tables | Audit/Evidence Service | Owns append-only audit, immutable evidence snapshots, promotion evidence bundles, retention, and compliance exports. |
| Data-pipeline governance | `src/data-pipeline`, `src/kafka-governance` | `apic_runtime`, `apic_governance`, Athena evidence | Data Pipeline Governance Service | Owns event topic onboarding, schema governance, feedback actions, decision signals, and query-run provenance. |
| Gateway control plane | current gateway/proxy routes plus future module | `apic_gateway`, gateway-native config cache | Gateway Control Plane Service | Owns consumers, subscriptions, route versions, policy bindings, credential refs, publish snapshots, and gateway rollups. Runtime gateway decisions use published config, not live DB reads. |
| Shared-service platform | `src/shared-services`, external `api-shared-services` contracts | existing `shared_*`, future `shared_core` | Shared Services Platform Service | Owns shared-service integration controls and rollups without moving provider transaction tables into API Center. |
| Auth and identity boundary | `src/auth`, `src/secrets` | Secret Manager, Redis token/session state, secret reference tables | Identity/Security Service only if needed | Owns token issuance, auth provider integration, secret resolution, and credential reference lifecycle. No plaintext secrets in Supabase. |
| Shared kernel | `src/shared`, `src/config`, `src/database`, `src/metrics` | no business schema ownership | Library, not service | May contain infrastructure utilities only. It must not contain domain policy, product workflow state, or domain-specific table ownership. |

Boundary enforcement rules:

- A module may write only its owner schema unless the write happens through another module's public service API or an explicit outbox/event contract.
- Cross-context reads must use public services, API contracts, read models, or documented projections; direct Prisma/table access across owner schemas is not allowed for new code.
- Shared DTOs are contracts, not dumping grounds. Domain-specific DTOs stay with the owning context and are exported intentionally.
- Internal events must carry stable IDs, environment, actor/correlation metadata, and schema version where relevant.
- Every future service extraction needs contract tests, smoke tests, grants, rollback, observability, and data ownership documented before deployment split.
- Management remains a consumer of API Center/Gateway/Shared Services APIs and must not become its own persistence layer.

## Sync vs Async Decision Matrix

The platform must keep request-time decisions fast and predictable while still recording durable evidence. Synchronous paths are allowed only when the caller needs the result before the response can be returned. Everything else should be queued, written after response completion, or rolled up from a durable/event source.

| Workflow | Sync or async | System of record | Rule |
| --- | --- | --- | --- |
| Token issuance and token validation | Sync | Redis token/session state, Secret Manager references, auth module | The gateway cannot proxy a request until auth succeeds or fails. |
| Registry route lookup | Sync from cache/published config | Redis registry cache, future gateway config snapshot, `apic_catalog` | Runtime routing must not depend on a live Postgres query per request. |
| Scope, lifecycle, dependency, entitlement, and quota admission checks | Sync | Published gateway policy config, `apic_governance`, `apic_runtime.quota_evaluations` for retained decisions | Allow/deny must happen before proxying. Retained evidence can be written asynchronously after the decision. |
| Proxy to tribe or shared service | Sync | Target upstream service | The user-facing response depends on the upstream result. Usage/evidence recording must not block the response path except for required admission checks. |
| Idempotency reservation for write requests | Sync | Redis or durable idempotency table owned by the gateway/shared-service context | Duplicate prevention must happen before executing provider or upstream writes. |
| Provider API call for payment, OTP, email, SMS, geo, or Google auth | Sync when the caller needs provider result; async when the operation can be accepted for later processing | Shared-service provider tables and provider APIs | Payment confirmation and OAuth exchange are sync; bulk email/SMS, retries, and provider reconciliation are async. |
| Webhook signature verification and receipt | Sync | `shared_core.provider_webhook_events` or provider-owned webhook table | Verify and durably record receipt before returning success to the provider. Downstream state changes are async. |
| Audit event capture | Async after response or transactional with governance mutation when the audit row proves the mutation | `apic_audit.audit_events`, Kafka audit topic | Provider-impacting admin mutations should commit audit with the mutation; high-volume proxy audit can be best-effort async plus durable rollup. |
| Gateway and shared-service usage counters | Async rollup | Redis hot counters, `usage_rollups`, future `gateway_usage_rollups`, future `shared_service_usage_rollups` | Counters must not add Postgres latency to every request. Flush hourly/daily rollups with replay capability. |
| Promotion evidence and compliance snapshots | Async from source-backed state | `promotion_evidence_bundles`, `evidence_snapshots` | Create snapshots at workflow milestones, not only when a user exports compliance data. |
| Data-pipeline query runs and decision signals | Async | `pipeline_query_runs`, `pipeline_decision_signals`, external Athena evidence | Expensive analytics should be queued and status-tracked. Management shows freshness and degraded states. |
| Alerts, scorecards, reliability, and cost trends | Async projections | Durable rollups, audit, health snapshots, external provider evidence | These views are derived products. They must declare source freshness and must not block runtime traffic. |

Failure behavior:

- Sync admission failures fail closed when they protect security, quota, lifecycle, or provider-impacting policy.
- Async evidence failures raise operational alerts and degraded Management labels; they do not fail already-completed user traffic unless the workflow explicitly requires transactional audit.
- Any async worker must be idempotent by correlation id, event id, provider event id, or deterministic rollup key.
- Any durable async table must have retention, replay, and dead-letter behavior before it supports compliance, reliability, chargeback, or operational-trust claims.

## Approved Future Platform Bounded Contexts

The live migration remains focused on API Center control-plane durability. The approved long-term enterprise model keeps API Gateway and shared-service platform support separate as bounded contexts first, then services only when operational pressure justifies extraction. They may initially share the same Supabase project for operational simplicity, but they should not share application modules, migration ownership, hot-path assumptions, or release gates.

### API Gateway

Purpose: decide whether a runtime request is allowed, where it goes, and how it is counted.

Ownership: phase 1.5 gateway control-plane module first, then a separate service when route/policy publishing, telemetry ingestion, or runtime scale needs independent deployment. It must have its own release gates even while it remains inside the monolith.

Schema: `apic_gateway`

Candidate tables:

| Table | Purpose |
| --- | --- |
| `gateway_instances` | Gateway runtime instances or clusters by environment and region. |
| `gateway_routes` | Gateway-facing route definitions bound to catalog services and environments. |
| `gateway_route_versions` | Versioned route snapshots used for safe promotion and rollback. |
| `gateway_consumers` | Organizations, tribes, services, or client groups allowed to consume APIs. |
| `client_applications` | Registered client applications that call APIs through the gateway. |
| `client_credential_references` | Secret-manager references for client credentials, never plaintext secrets. |
| `consumer_subscriptions` | Approved consumer-to-API access, including environment, plan, status, and expiry. |
| `route_policy_bindings` | Auth, scope, quota, threat-protection, transform, and routing policy bindings per route/version. |
| `gateway_policy_evaluations` | Optional retained policy/deny/allow decisions when durable enforcement evidence is required. |
| `gateway_usage_rollups` | Aggregated request, latency, error, and quota counters by route, consumer, service, and window. |
| `gateway_error_rollups` | Aggregated error classes and upstream failure patterns without raw request bodies. |
| `gateway_idempotency_keys` | Optional deduplication keys for gateway-mediated write requests. |

Rules:

- Do not store raw per-request logs or request/response bodies in Postgres by default.
- Keep hot counters in Redis or the gateway's native telemetry path; persist rollups needed for billing, reliability, compliance, and trend reporting.
- Gateway route state must reference `apic_catalog.services`, `apic_catalog.service_environments`, and governance approvals.
- Gateway runtime decisions should use cached/published config and avoid live database dependency on the per-request hot path.
- Credential tables store references, fingerprints, rotation status, and audit pointers only.

### Gateway Config Publish Contract

Gateway runtime behavior must be driven by versioned published config, not ad hoc live table reads. The database stores authoring state and publish evidence; the runtime consumes a stable snapshot.

Publish flow:

1. A route, consumer, subscription, credential reference, or policy change is created through `apic_governance` and approved when provider-impacting.
2. The gateway control-plane module builds a deterministic config snapshot from `apic_catalog`, `apic_governance`, and future `apic_gateway` tables.
3. The snapshot receives a `config_version`, checksum, environment, created-by actor, approval reference, and rollback pointer.
4. The snapshot is written to a fast runtime store or gateway-native config channel.
5. Gateway instances report the active `config_version` and readiness status.
6. Rollback means republishing the previous known-good config version, not manually editing runtime state.

Required phase 1.5 records:

| Record | Required fields |
| --- | --- |
| `gateway_config_publish_snapshots` | `config_version`, `environment`, `status`, `checksum`, `source_approval_id`, `published_by`, `published_at`, `activated_at`, `rollback_of_version`, `failure_reason` |
| `gateway_instance_config_status` | `instance_id`, `environment`, `active_config_version`, `last_seen_at`, `readiness`, `drift_reason` |

Rules:

- Runtime gateway decisions use the active published config and local/cache state synchronously.
- Publishing, rollout confirmation, drift detection, and rollback evidence are asynchronous and durable.
- Management must show both desired config version and active gateway-reported version.
- A config version cannot be marked production-active until at least one gateway instance reports it, or a no-gateway environment exemption is recorded.

### Shared-Service Platform Core

Purpose: improve shared services without moving provider/business records into API Center ownership.

Schema: `shared_core`

Candidate tables:

| Table | Purpose |
| --- | --- |
| `shared_service_integrations` | Registered shared-service integrations such as payment, OTP, email, SMS, geo, and Google auth. |
| `shared_service_entitlements` | Which tribe/service/client may use which shared-service capability. |
| `shared_service_usage_rollups` | Cross-shared-service usage rollups for quota, chargeback, and operational reporting. |
| `provider_accounts` | Provider account references by service, environment, and provider mode. |
| `provider_secret_references` | Secret-manager references and rotation state for provider credentials. |
| `provider_webhook_events` | Normalized webhook intake envelope for provider event idempotency and processing state. |
| `idempotency_keys` | Cross-provider idempotency records for writes that must not be duplicated. |
| `outbox_events` | Reliable event publication queue for shared-service state changes. |

Rules:

- Existing `shared_*` provider tables remain owned by Shared Services.
- Shared-service schemas should continue hashing or referencing sensitive values rather than storing plaintext credentials or recipient secrets.
- API Center may read shared-service rollups through API contracts, but should not own shared provider transaction tables.

### Shared Services Platform Execution Track

The API Center migration must not rewrite provider-owned `shared_*` tables, but the long-term platform needs a separate execution track in `C:\Codes\apic\api-shared-services`. This track should be implemented after the phase 1 control-plane cutover unless a live compliance or chargeback requirement promotes it sooner.

Required capabilities:

| Capability | Owner | Sync or async | Required behavior |
| --- | --- | --- | --- |
| Shared-service integration registry | `api-shared-services`, future `shared_core.shared_service_integrations` | Sync for read, async for provider verification | Stores service id, provider, environment, mode, status, health endpoint, owner, and Management display metadata. |
| Entitlement checks | `api-shared-services` plus API Center gateway contract | Sync | Determines whether a tribe/service/client may call payment, OTP, email, SMS, geo, or Google auth. Must be cacheable for gateway hot path. |
| Provider account references | `shared_core.provider_accounts` | Sync for lookup, async for verification | Stores provider mode, account reference, environment, status, and owner. No plaintext credentials. |
| Provider secret references | `shared_core.provider_secret_references`, Secret Manager | Sync for runtime resolution, async for rotation evidence | Stores secret reference, fingerprint, rotation status, approval id, and audit pointer. |
| Idempotency keys | `shared_core.idempotency_keys` or provider-owned schema | Sync | Reserves write operations before provider calls and returns prior result for duplicate keys. |
| Webhook inbox | `shared_core.provider_webhook_events` or provider-owned webhook tables | Sync receipt, async processing | Verifies signature, stores provider event id and payload hash, prevents duplicates, and tracks processing state. |
| Outbox events | `shared_core.outbox_events` | Async | Publishes shared-service lifecycle events to API Center/data pipeline with retry and dead-letter state. |
| Usage rollups | `shared_core.shared_service_usage_rollups` | Async | Aggregates usage by tribe, service, provider, operation, environment, outcome, and time window for reliability, cost, chargeback, and compliance. |
| Provider reconciliation | `api-shared-services` workers | Async | Compares provider state against local rows, records drift, and creates Management alerts without blocking runtime traffic. |

Shared Services verification before product-complete claims:

- Supabase SQL migrations in `api-shared-services` are the canonical database history for shared-service schemas. Prisma shared-service migrations and `prisma/shared-services/schema.prisma` must be generated or synchronized from the approved SQL path, not used as a competing live migration authority.
- `api-shared-services` migrations create `shared_core` only when the execution track starts; API Center phase 1 does not create it.
- Existing `shared_payment`, `shared_otp`, `shared_email`, `shared_sms`, `shared_geo`, and `shared_gauth` data remains untouched by API Center migrations.
- Shared-service write paths have idempotency tests for payment/subscription, OTP send/verify, email send, SMS send, geo lookup, and Google auth callback where applicable.
- Webhook receipt tests prove duplicate provider events are accepted idempotently and not processed twice.
- Management `/shared-services`, `/shared-services/setup`, and `/shared-services/usage` show source freshness and degraded state when rollups or provider reconciliation are unavailable.

## Management Source-Backed Feature Matrix

APICenter Management must remain a consumer of API Center APIs, but every Management feature needs an explicit source of truth. A feature is not considered enterprise-ready until the source below is durable, queryable by service/environment/owner, and covered by a smoke or contract check.

| Management feature | Current UI/use case | Required source of truth | Durability requirement |
| --- | --- | --- | --- |
| Readiness | `/readiness`, overview checks | API Center readiness, registry, deployment config, Secret Manager auth checks | Must be source-backed before cutover. |
| Registry | `/registry`, service detail, tribe pages | `apic_catalog.organizations`, `services`, `service_environments`, `service_routes`, `service_scopes`, `service_dependencies`, `service_secret_references` | Must be source-backed before `REGISTRY_SOURCE=postgres`. |
| Registration requests | `/registration-requests`, Developer Portal registration | `apic_governance.registry_change_requests`, `apic_governance.approval_requests`, `apic_audit.audit_events` | Must be durable before provider-impacting registration approval. |
| Developer Portal quota requests | `/developer-portal`, quota increase request flow | `apic_governance.approval_requests`, `apic_governance.quota_policies`, `apic_runtime.quota_evaluations` | Must be durable before live quota self-service. |
| Quotas | `/quotas`, tribe detail quota tab | `apic_governance.quota_policies`, `apic_runtime.quota_evaluations`, future gateway rollups | Must keep decisions queryable by owner, target, route family, and environment. |
| Plans | `/plans`, entitlement assignment | `apic_governance.entitlement_plans`, `apic_governance.entitlement_assignments`, approval/audit rows | Must be durable before promotion gates depend on plans. |
| Lifecycle | `/lifecycle`, service lifecycle spine | Catalog, quotas, plans, approvals, health, pipeline evidence, audit | Must not infer readiness from volatile-only data. Missing durable evidence should show `attention` or `blocked`. |
| Promotions | `/promotions`, promotion evidence panel | `apic_governance.promotion_evidence_bundles`, approvals, health, smoke, quota, plan, pipeline evidence, audit | Add durable evidence bundles before claiming promotion history is audit-ready. |
| Compliance | `/compliance`, compliance export | `apic_audit.audit_events`, `apic_audit.evidence_snapshots`, `apic_governance.promotion_evidence_bundles` | Export must not depend on in-memory evidence bundles. |
| Operational trust | `/operational-trust` | Governance drift inputs, dependency map inputs, durable promotion evidence, scorecards, audit | Any unavailable source must be surfaced as unavailable, not silently treated as healthy. |
| Reliability | `/reliability`, tribe reliability | Gateway rollups, shared-service rollups, quota evaluations, audit, health snapshots | Durable rollups are required before reliability history exceeds Redis windows. |
| Cost | `/cost`, provider usage | `apic_runtime.shared_service_usage_rollups`, future provider cost imports, shared provider rows | Durable rollups are required before chargeback or trend reporting. |
| Alerts | `/alerts` | Gateway rollups, shared-service rollups, registry metadata, audit | Alerts can use Redis for near-real-time, but alert history needs durable snapshots if used for compliance. |
| API catalog and Marketplace | `/api-catalog`, `/marketplace` | Computed from `apic_catalog` plus governance/entitlement state | No standalone catalog tables in phase 1; projections must remain deterministic. |
| Dependencies | `/dependencies` | `apic_catalog.service_dependencies`, `apic_runtime.confluent_topics`, shared-service usage rollups | Persist dependency edges only if computed projections become too slow or need history. |
| Data pipeline | `/data-pipeline` | `apic_runtime.event_topic_onboarding_states`, `apic_runtime.pipeline_feedback_actions`, `apic_governance.event_schema_versions`, `apic_runtime.pipeline_decision_signals`, Athena evidence | Schema governance and decision signals need durable API Center records or explicit external-source contracts. |
| Shared services | `/shared-services`, `/shared-services/usage`, setup workflows | Existing `shared_*` schemas, future `shared_core`, API Center registry/dependency state | Shared provider tables remain owned by Shared Services; shared-core controls are additive. |
| Smoke tests | `/smoke-tests` | `apic_runtime.smoke_test_runs`, audit events, health snapshots | Provider-impacting smoke runs need audit and evidence links. |
| Audit | `/audit` | `apic_audit.audit_events` | Must be append-only, retained, partitioned, and queryable by actor/resource/time. |

## Management Source Freshness Contract

Every Management API response that mixes durable, volatile, external, or computed evidence must expose enough source metadata for the UI to label the state honestly.

Required source metadata shape:

```ts
type ManagementSourceMetadata = {
  sourceType: "durable" | "volatile" | "external" | "computed" | "unavailable";
  sourceName: string;
  durability: "postgres" | "redis-window" | "provider-api" | "athena" | "computed-projection" | "none";
  window?: "15m" | "1h" | "24h" | "7d" | "30d";
  lastRefreshedAt?: string;
  staleAfterSeconds?: number;
  degradedReason?: string;
  evidenceTable?: string;
  correlationId?: string;
};
```

Rules:

- A Management page may combine multiple sources, but each source must keep its own metadata.
- Durable Supabase sources can be shown as audit-ready only when the backing table, retention, and smoke/contract check are in place.
- Redis-windowed sources must display the selected window and must not be described as history beyond the window.
- External/Athena/provider sources must include last refresh time and degraded reason when unavailable.
- If a source is unavailable, the UI must show `unavailable` or `degraded`, not an empty healthy state.
- Compliance, operational trust, reliability, cost, and promotion pages must include source metadata in their route/API contract tests.

## Required Durable Evidence And Rollup Tables

These tables close the gap between Management features and durable product evidence. They are not all part of the first live control-plane rename, but the plan must track them so APICenter does not claim product completeness while critical evidence remains volatile.

| Table | Schema | Why it exists | Launch decision |
| --- | --- | --- | --- |
| `promotion_evidence_bundles` | `apic_governance` | Stores promotion gate snapshots for service/environment approvals, replacing in-memory evidence bundles. | `phase_1_5`; becomes `phase_1_blocker` if compliance export is marketed as audit-ready at cutover. |
| `event_schema_versions` | `apic_governance` | Durable event schema registry for environment, tribe, event type, schema version, compatibility mode, steward, status, and approval. | `phase_1_5`; becomes `phase_1_blocker` if prod validation reads API Center schema registry state. |
| `gateway_usage_rollups` | `apic_runtime` or future `apic_gateway` | Durable gateway request, latency, error, quota, and denial counters by route, consumer, service, environment, and window. | `phase_1_5`; required before reliability, cost, or compliance uses gateway history beyond Redis. |
| `shared_service_usage_rollups` | `apic_runtime` or future `shared_core` | Durable shared-service usage by tribe, shared service, provider, operation, environment, and window. | `phase_1_5`; required before chargeback, trend reporting, or historical shared-service reliability. |
| `pipeline_decision_signals` | `apic_runtime` | Durable action signals for stale pipelines, quality regressions, cost spikes, gateway denial spikes, and shared-service error spikes. | `phase_1_5`; required before Management decision signals are source-backed instead of Athena/fixture-backed. |
| `pipeline_query_runs` | `apic_runtime` | Stores Athena/query execution metadata, bytes scanned, output references, result purpose, and completion state. | `phase_1_5`; required before cost and evidence traceability need query-level provenance. |
| `event_schema_validations` | `apic_runtime` | Records accepted/rejected schema validation decisions without storing full event payloads. | `future`; promote to `phase_1_5` when validation history is required for audit or debugging. |
| `evidence_snapshots` | `apic_audit` | Immutable evidence packets for compliance exports, lifecycle evidence, operational trust snapshots, and promotion proofs. | `phase_1_5`; becomes `phase_1_blocker` if compliance exports are audit-ready at cutover. |

Rules for these tables:

- Store references, hashes, status, metadata, and evidence links; do not store raw request bodies, response bodies, secrets, or full event payloads by default.
- Partition or retain high-volume tables by time before launch: gateway rollups, shared-service rollups, quota evaluations, pipeline decision signals, query runs, schema validations, and audit evidence snapshots.
- Index every Management filter path: service id, owner tribe id, environment, status/outcome, route family, target service, provider, time window, and correlation id where applicable.
- Keep hot-path counters in Redis or gateway-native telemetry, then flush durable rollups asynchronously. Gateway request handling must not require a live Postgres write per request.
- Evidence snapshots are append-only. Corrections require a superseding snapshot linked to the prior snapshot, not an update in place.

## Evidence Capture Triggers

Compliance export should read previously captured durable evidence. It should not be the first place where promotion, policy, or operational evidence is assembled.

| Trigger | Evidence owner | Durable record | Sync or async | Required contents |
| --- | --- | --- | --- | --- |
| Service registration submitted | Governance | `registry_change_requests`, `audit_events` | Sync with mutation | Requested manifest hash, actor, environment, target service, risk flags. |
| Service registration approved/rejected | Governance and audit | `approval_requests`, `registry_change_requests`, `audit_events` | Sync with mutation | Decision, reviewer, reason, target environment, requested changes. |
| Quota policy created or changed | Governance | `quota_policies`, `approval_requests`, `audit_events` | Sync with mutation | Scope, target, mode, thresholds, approver, effective window. |
| Quota decision evaluated | Runtime operations | `quota_evaluations`, future gateway policy evaluations | Sync decision, async retained evidence | Owner, route family, target service, outcome, request count, limit, correlation id. |
| Secret rotation requested or executed | Auth/identity and audit | `service_secret_references`, `approval_requests`, `audit_events`, future evidence snapshot | Sync for state change, async for evidence packet | Secret reference only, fingerprint, rotation reason, emergency flag, approver. |
| Promotion gate evaluated | Audit/evidence | `promotion_evidence_bundles`, `evidence_snapshots` | Async snapshot | Approval, health, quota, plan, smoke, pipeline, audit, source freshness. |
| Compliance export requested | Audit/evidence | `evidence_snapshots`, `audit_events` | Sync read, async export artifact optional | Export parameters, actor, time range, source freshness, generated artifact reference. |
| Shared-service provider webhook received | Shared Services | `provider_webhook_events`, provider-owned runtime row, outbox event | Sync receipt, async processing | Provider event id, payload hash, signature status, processing state, provider mode. |
| Gateway config published | Gateway control plane | `gateway_config_publish_snapshots`, `audit_events` | Async publish with sync activation checks | Config version, checksum, source approvals, publisher, environment, active instance status. |
| Service deprecated or retired | Catalog/governance/audit | `service_lifecycle_events`, `approval_requests`, `audit_events`, evidence snapshot | Sync mutation, async snapshot | Retirement reason, affected consumers, target date, approver, dependency impact. |

Rules:

- Evidence records store hashes, references, decisions, and source metadata; they do not store raw request/response bodies or secret material.
- Evidence capture must be idempotent by workflow id, approval id, provider event id, config version, or correlation id.
- Corrections create a superseding evidence record linked to the prior record.
- Compliance export fails or labels the export incomplete when required durable evidence is missing for the requested claim.

## Service Usage Recording Decision

Current code records service usage, but not all of it is durable in Supabase yet.

| Usage path | Current behavior | Durable before enterprise-complete claims |
| --- | --- | --- |
| Tribe-to-tribe and tribe-to-shared proxy calls | `ProxyHandler` records gateway traffic after the response finishes. `GatewayTrafficService` stores hourly counters in Redis with in-memory fallback and 45-day TTL. | Add async durable `gateway_usage_rollups` or wire existing `usage_rollups` as the durable rollup sink before reliability, cost, or compliance claims depend on gateway history. |
| Shared-service calls | `ProxyHandler` records shared-service usage for `/shared/*` calls. `SharedServiceUsageService` stores Redis/in-memory hourly counters with 45-day TTL. | Add durable `shared_service_usage_rollups` before chargeback, provider cost trends, compliance evidence, or operational-trust history depends on shared-service usage. |
| Quota decisions | `TribeQuotaEnforcerService` persists quota decisions through Prisma when quota checks run. | Keep `quota_evaluations` as the durable quota-decision table and partition/retain it before launch. |
| Audit events for service calls | `ProxyHandler` records `tribe_service.call` and `shared_service.call`; `AuditEventsService` can dual-write to Postgres when database persistence is enabled. | Verify `apic_audit.audit_events` writes for successful and failed proxy calls before compliance exports treat them as durable. |
| Existing `usage_rollups` table | Prisma and legacy migrations define it, but the current gateway/shared-service usage services do not write to it directly. | Decide whether `usage_rollups` is the phase 1 durable sink or whether phase 1.5 creates separate `gateway_usage_rollups` and `shared_service_usage_rollups`. |

Rule: every service call should be observable immediately through metrics/Redis and audit, but the database is not the durable usage source until the async rollup writer is implemented and verified. Management must label usage views as Redis-windowed or degraded until durable rollups exist.

Phase 1 decision: use **Option B**. Keep gateway and shared-service usage history Redis-windowed during the control-plane schema cutover, preserve normalized observations in metrics/audit/cache, and create separate phase 1.5 durable rollup writers for `gateway_usage_rollups` and `shared_service_usage_rollups`. Do not wire the existing `apic_runtime.usage_rollups` table as the phase 1 sink until a replayable async writer, retention policy, and Management contract tests exist.

## Required Service Call Recording Contract

Every inbound call handled by API Center or future Gateway must produce a normalized service-call observation. The observation can be written to Redis/metrics on the hot path and flushed to Postgres asynchronously, but the field contract must be stable before live migration so Management, compliance, reliability, and cost features all reason about the same event shape.

| Field | Required for | Notes |
| --- | --- | --- |
| `correlation_id` | All calls | Generated or propagated once per request. Used for audit, logs, rollups, and support traces. |
| `request_id` | All calls | Runtime request id. May differ from `correlation_id` when a workflow has multiple calls. |
| `environment` | All calls | `test`, `uat`, `prod`, or approved future environment. |
| `caller_type` | All calls | `service`, `tribe`, `client_application`, `system`, or `unknown`. |
| `caller_id` | All calls when known | Service id, tribe id, client application id, or system actor id. |
| `source_service_id` | Tribe/service calls | The calling service when resolved from token, route, or registry context. |
| `target_type` | All calls | `api_service`, `shared_service`, `gateway_route`, `data_pipeline`, or `provider`. |
| `target_service_id` | API service calls | Registry service id for tribe-to-tribe or API catalog traffic. |
| `shared_service_id` | Shared-service calls | `payment`, `otp`, `email`, `sms`, `geo`, `gauth`, or future approved shared service id. |
| `route_family` | Gateway/proxy calls | Stable route grouping used by quotas, reliability, and rollups. |
| `http_method` | HTTP calls | Store method, never raw body. |
| `status_code` | HTTP calls | Upstream or gateway response code. |
| `outcome` | All calls | `allowed`, `blocked`, `success`, `client_error`, `server_error`, `timeout`, or `provider_error`. |
| `latency_ms` | All calls | End-to-end latency measured by the proxy/gateway layer. |
| `quota_evaluation_id` | Calls with quota checks | Link to retained quota decision when persisted. |
| `audit_event_id` | Calls with durable audit | Link to `apic_audit.audit_events` when available. |
| `rollup_key` | All rollup candidates | Deterministic key for idempotent hourly/daily aggregation. |

Recording rules:

- Do not store raw request bodies, response bodies, bearer tokens, provider secrets, OTP values, card data, webhook payloads, or personally sensitive recipient details in usage rollups.
- Gateway and proxy request handling must not require a synchronous Postgres write for nonessential analytics.
- Security, quota, lifecycle, entitlement, and idempotency admission decisions remain synchronous when they decide whether a call may proceed.
- A failed async usage-write must emit an operational alert and degraded source metadata; it must not make Management silently show zero usage.
- Durable rollup writers must be idempotent by `rollup_key`, time bucket, environment, caller, target, route family, and outcome.
- If API Center cannot resolve caller or target identity, it records `unknown` plus the correlation id and increments a data-quality counter for follow-up.

## Use Cases The Schema Must Support

1. **Registry as source of truth:** API Center can load services, environments, routes, scopes, dependencies, and secret references from Postgres after Redis/Postgres parity is verified.
2. **Provider-impacting changes:** A service registration, quota increase, route change, secret rotation, topic provisioning, sink change, or deprecation can be submitted, reviewed, approved, rejected, and audited.
3. **Everything tracked:** Each important state transition creates either a catalog lifecycle event, governance workflow row, runtime observation, or audit event.
4. **Quota and entitlement controls:** Operators can define quota policies, assign entitlement plans by owner/environment, and inspect per-request quota evaluation outcomes.
5. **Operational trust:** Health snapshots, smoke-test runs, usage rollups, provisioning jobs, and feedback actions can be queried without joining through governance tables.
6. **Shared-services separation:** Payment, OTP, email, SMS, geo, and Google auth provider tables stay in `shared_*` schemas and are not moved into APICenter control-plane schemas.
7. **Migration-safe rollout:** Old API Center pods can survive during rollout through compatibility views or a short migration window.
8. **Management UI readiness:** Management can show readiness, registry, approvals, quota policies, plans, runtime health, audit evidence, and migration status from stable APIs.
9. **Future provider swap:** Confluent/AWS-specific details can be tracked without forcing the catalog schema to change if Kafka or sink providers change.
10. **Compliance export:** Audit and governance records can answer who approved, what changed, when it changed, and which environment was affected.
11. **Gateway runtime control:** Gateway routes, consumers, subscriptions, credential references, policy bindings, usage rollups, and retained policy evaluations can be tracked without storing raw request bodies.
12. **Shared-service platform governance:** Shared-service entitlements, provider account references, usage rollups, idempotency, webhook processing, and outbox events can be managed without moving shared provider tables into API Center ownership.
13. **Management source-backed operations:** Readiness, lifecycle, operational trust, compliance, reliability, cost, data pipeline, developer portal, quotas, plans, and alerts have explicit API Center sources of truth.
14. **Durable evidence over volatile views:** Promotion evidence, compliance packets, event schema governance, pipeline decision signals, gateway rollups, and shared-service rollups are either persisted or clearly marked unavailable/degraded in Management.

## Edge Cases To Design For

- Live database has zero catalog services, but some operational rows may already exist from smokes or feedback tests.
- Some migrations may have been applied manually outside Supabase migration history.
- Supabase CLI can see one migration history while Prisma migration folders imply another.
- Existing app pods may query old schemas while the new migration is running.
- Raw SQL in services can bypass Prisma table mappings and must be found explicitly.
- `REGISTRY_SOURCE=postgres` fails if any required table is absent; rollout must keep Redis fallback available until checks pass.
- Pooler URL and direct DB URL can be confused. Runtime should use the pooler-compatible URL; schema migration and dump commands should use the migration-safe linked/direct connection.
- Prisma plus transaction pooling can behave differently when prepared statements or session features are used. Verify the current Prisma adapter settings before switching connection strings.
- High-write tables can grow quickly: `quota_evaluations`, `usage_rollups`, `health_snapshots`, `smoke_test_runs`, `audit_events`, and pipeline feedback records need retention and partitioning decisions before they become large.
- Time zones must use `timestamptz`; no local-time timestamps.
- Workflow status values need check constraints so misspellings do not create invisible states.
- Foreign keys need explicit indexes; Postgres does not create them automatically.
- Constraint migrations must use `DO $$ ... pg_constraint ... $$` guards because `ADD CONSTRAINT IF NOT EXISTS` is not supported.
- Tables exposed through Supabase Data API need RLS before granting `anon` or `authenticated`. These control-plane schemas should remain private unless a separate API design approves exposure.
- Audit rows should be append-only. Updates and deletes should be denied for the app role except a tightly controlled retention/archive role.
- Failed migrations after partial DDL need a documented stop condition; do not continue applying later migrations after an unexpected failure.
- Rollback should prefer restoring old app config to Redis source first. Restoring a database backup is a last resort for destructive data issues.
- Service deletion must distinguish `disabled`, `archived`, and `purged`; hard delete should be explicit and audited.
- Owner changes must not orphan quotas, plans, routes, dependencies, secret references, or event-topic ownership.
- Migration must not move `shared_*` schemas into API Center ownership.
- Management must not render volatile evidence as durable evidence; in-memory, Redis-only, fixture, or Athena-only sources need explicit source labels and unavailable/degraded states.
- Gateway and shared-service rollups can be flushed asynchronously, but the plan must define the owner, schedule, retention, and replay behavior before those rollups support reliability, cost, or compliance views.
- Event schema governance must distinguish draft, approved, rejected, deprecated, and test-discovery states so prod validation never depends on a mutable local file.

## Pre-Live-Migration Requirements

Current live preflight note (2026-06-26): local `supabase/.temp/project-ref`, Codex Supabase MCP, and explicit target confirmation all point at live project `hguyivbodlrmooayuxwt` (`api-center-live`) with `APICENTER_ENVIRONMENT_NAME=live`. The local gitignored `.env` provides the redacted least-privilege `api_center_app` live DB connection, DB password, compatibility-view rollout approval, API Center/Management URLs, and Redis URL. `SUPABASE_ACCESS_TOKEN` is no longer treated as a blocker because linked Supabase CLI OAuth and the direct `DATABASE_URL` path are sufficient for the current evidence commands. Live migrations were applied through `20260625234334_grant_registry_child_delete_privileges.sql`; live API Center now reads registry state from Postgres and reports 22 registered services.

Approval packet artifact recorded: `docs/operations/supabase-migration-approval-packet-2026-06-26.json` and `docs/operations/supabase-migration-approval-packet-2026-06-26.md` were regenerated with `node -r dotenv/config scripts/build-migration-approval-packet.js --out docs/operations/supabase-migration-approval-packet-2026-06-26.json --md-out docs/operations/supabase-migration-approval-packet-2026-06-26.md`; focused packet/input tests passed. The packet aggregates preflight, role discovery, grant alignment, row-count, static DDL guard, schema-verifier, rollout strategy, linked migration history, safe rollout mode, registry parity, rollback, advisor, backup, dry-run, and readiness evidence, and currently reports 16 of 16 approval gates ready with zero blockers. It remains an operator checklist, not an approval.

Redacted preflight artifact recorded: `docs/operations/supabase-live-preflight-2026-06-26.json` was regenerated with `dotenv/config`; it confirms local Supabase config project id `api-center-control-plane`, linked project ref `hguyivbodlrmooayuxwt`, Codex MCP project ref `hguyivbodlrmooayuxwt`, expected project ref `hguyivbodlrmooayuxwt`, environment `live`, redacted `DATABASE_URL`, redacted `SUPABASE_DB_PASSWORD`, safe rollout flags, and no preflight blockers.

- [x] Confirm the target Supabase project reference and environment name in writing.

Target-project safety evidence recorded: `scripts/live-migration-preflight.js` captures an optional Codex Supabase MCP project ref from `CODEX_SUPABASE_MCP_PROJECT_REF` or `CODEX_SUPABASE_MCP_URL`, plus executable target confirmation from `SUPABASE_TARGET_PROJECT_REF`/`EXPECTED_SUPABASE_PROJECT_REF` and `APICENTER_ENVIRONMENT_NAME`/`SUPABASE_TARGET_ENVIRONMENT`. `scripts/build-migration-approval-packet.js` marks the target-project gate ready only when the linked ref, expected ref, optional MCP ref, and environment name are consistent. Verification recorded: `supabase projects list` showed `api-center-live` as `hguyivbodlrmooayuxwt`; `supabase link --project-ref hguyivbodlrmooayuxwt --skip-pooler` updated local metadata; regenerated preflight and approval artifacts now mark the target-project gate ready.
- [x] Confirm the app is allowed to enter a controlled migration window, or approve one-release compatibility views.

Rollout-strategy evidence artifact recorded: `docs/operations/migration-rollout-strategy-2026-06-26.json` was regenerated with `dotenv/config` after `.env` set `APICENTER_MIGRATION_ROLLOUT_STRATEGY=compatibility_views` and `APICENTER_COMPATIBILITY_VIEWS_APPROVED=true`; `npm run db:rollout-strategy:evidence:test` previously passed. The artifact proves all 23 expected compatibility views exist in the enterprise migration with `security_invoker = true`, has no blockers, and marks the `rollout_strategy` gate ready.
- [x] Confirm `DATABASE_ENABLED`, `DATABASE_DUAL_WRITE`, `REGISTRY_SOURCE`, and `REGISTRY_DUAL_WRITE` values for the live API Center environment.
- [x] Confirm whether live registry rows are still zero or produce a row-count export before migration.

Row-count evidence artifact recorded: `docs/operations/supabase-row-counts-2026-06-26.json` was regenerated with the direct redacted `DATABASE_URL` path after `scripts/collect-row-count-evidence.js` gained a direct Postgres collector. `node scripts/collect-row-count-evidence.test.js` passed. The live artifact is ready and records current counts including `api_center.services=22`, `api_center.service_lifecycle_events=3434`, `api_center.service_dependencies=61`, `api_center.service_routes=56`, `api_center.service_scopes=32`, `api_center.organizations=1`, `api_center_ops.pipeline_feedback_actions=5`, and zero rows for current audit/health/smoke/usage tables.
- [x] Create a Supabase backup or schema/data dump covering all `api_center*` and `shared_*` schemas.

Backup readiness artifact recorded: `docs/operations/supabase-backup-readiness-2026-06-26.json` was regenerated with `dotenv/config` using the local PostgreSQL 18 `pg_dump.exe` fallback after Supabase CLI dump required Docker Desktop in this environment. The artifact derives the backup schema set from API Center plus Shared Services migrations: `api_center`, `api_center_ops`, `api_center_audit`, `shared_email`, `shared_gauth`, `shared_geo`, `shared_otp`, `shared_payment`, and `shared_sms`; it records a non-empty ignored dump at `supabase/backups/supabase-live-backup-2026-06-26.sql` and marks the backup gate ready. `scripts/collect-supabase-backup-evidence.js` rejects empty dump files so failed backups cannot satisfy approval.
- [x] Run a dry-run migration after the live dump is available.

Dry-run readiness artifact recorded: `docs/operations/supabase-dry-run-readiness-2026-06-26.json` was regenerated with `dotenv/config` and `--run-dry-run` after backup evidence became ready. The artifact confirms Supabase CLI `2.105.0` supports `supabase db push --dry-run --linked`, records the exact pending migrations that would be pushed, and marks the dry-run gate ready without applying DDL.
- [x] Run Supabase advisors or document why advisors are unavailable in the installed CLI.

Advisor readiness artifact recorded: `docs/operations/supabase-advisors-readiness-2026-06-26.json` was regenerated with `--run-advisors` after revoking `EXECUTE` on `public.rls_auto_enable()` from `anon`, `authenticated`, and `public`. Supabase advisors now report `No issues found`, so the advisor gate is ready.
- [x] Run Prisma generate, typecheck, unit tests, registry tests, quota tests, approval tests, and build.

Verification recorded: `npm run db:generate` initially failed through the dead proxy `127.0.0.1:9`; rerunning with proxy environment variables cleared and escalated network access generated Prisma Client v7.8.0. `npm run typecheck` passed. Focused registry/quota/approval/governance tests passed with `npm test -- --runInBand src/registry/postgres-registry-store.service.spec.ts src/registry/registration-requests.service.spec.ts src/registry/registration-requests.controller.spec.ts src/registry/registry.controller.spec.ts src/quotas/tribe-quota-policy.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/approvals/approval-request.service.spec.ts src/approvals/approval-request.controller.spec.ts src/entitlements/tribe-plan.service.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts src/analytics/audit-events.service.spec.ts` for 12 suites and 68 tests. Full unit tests passed with `npm test -- --runInBand` for 114 suites and 524 tests. `npm run build` initially failed on Windows `EPERM` unlinking `dist/app.module.js.map`; the escalated rerun passed.
- [x] Capture old and new readiness results for API Center and Management.

Readiness evidence artifacts recorded: `docs/operations/readiness-prelive-2026-06-26.json`, `docs/operations/readiness-old-2026-06-26.json`, and `docs/operations/readiness-new-2026-06-26.json` were regenerated after switching the gitignored Management evidence URL to the reachable deployed alias `https://api-center-management-test.itsandbox.site`. API Center live/ready checks and Management home/deployment-config checks all returned 200, and old/new readiness are ready.
- [x] Capture explicit app runtime role names and reject migrations that discover roles dynamically during DDL.

Grant-alignment evidence artifact recorded: `docs/operations/grant-alignment-2026-06-26.json` was regenerated after provisioning the least-privilege `api_center_app` role, rotating the gitignored local `DATABASE_URL` to that role, and rerunning live role discovery. The artifact confirms the migration grants target explicit role `api_center_app`, the discovered runtime role is `api_center_app`, and the migration contains no forbidden dynamic role-selection pattern; the grant-alignment gate is ready.
- [x] Confirm renamed tables have enterprise-named indexes and constraints, or create the missing enterprise-named objects.

Verification recorded: `npm run db:verify:enterprise-static:test` passed 8 static-checker tests, and `npm run db:verify:enterprise-static` passed against `supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql`. The checker verifies required enterprise index names, required check-constraint names, derived leading-index coverage for foreign-key columns, and rejects legacy object creation such as `service_registration_requests_*`, `tribe_quota_*`, `tribe_plan_*`, and `topic_onboarding_states_*` names. Live application is still covered by the unchecked database verifier/dry-run gates.
- [x] Confirm retention comments, partition DDL, or written low-volume exceptions for audit, quota, usage, health, smoke, and pipeline feedback tables.

Verification recorded: `npm run db:verify:enterprise-static` verifies `retention=` comments for `apic_audit.audit_events`, `apic_runtime.quota_evaluations`, `apic_runtime.usage_rollups`, `apic_runtime.health_snapshots`, `apic_runtime.smoke_test_runs`, and `apic_runtime.pipeline_feedback_actions`; the same command also verifies private API exposure config, public revokes, audit delete denial DDL, and absence of phase 1 `apic_gateway`, `shared_core`, or `shared_*` provider-table DDL. Live application is still covered by the unchecked migration dry-run/advisor/verifier gates.
- [x] Capture the Management source-backed feature matrix result for readiness, registry, lifecycle, operational trust, compliance, reliability, cost, data pipeline, quotas, plans, developer portal, shared services, audit, and alerts.

Verification recorded: `scripts/smoke-routes.test.mjs` now enforces source-aware API route smoke checks for gateway traffic, shared-service usage, audit events, compliance export, promotion evidence, and data-pipeline health/quality; Management route/schema tests passed with `npm test -- scripts/smoke-routes.test.mjs src/lib/schemas/operations.test.ts src/lib/schemas/data-pipeline.test.ts src/app/api/local/analytics/gateway-traffic/route.test.ts src/app/api/local/analytics/shared-service-usage/route.test.ts src/app/api/local/audit/events/route.test.ts src/app/api/local/compliance/export/route.test.ts src/app/api/local/operations/lifecycle/route.test.ts` for 8 files and 20 tests. The first sandboxed run hit Windows `spawn EPERM`; the escalated rerun passed.
- [x] Capture the Management source freshness contract result for durable, volatile, external, computed, and unavailable sources.

Verification recorded: `src/lib/schemas/operations.ts` defines the Management source metadata shape for durable, volatile, external, computed, and unavailable source types; operations and data-pipeline schema tests preserve durable Postgres, Redis-windowed volatile, Athena external, and fixture/local degraded metadata; the same focused Management contract command above passed.
- [x] Confirm sync versus async workflow ownership for auth, registry lookup, quota admission, proxying, idempotency, provider calls, webhook receipt, audit, rollups, evidence, alerts, and pipeline analytics.

Verification recorded: `docs/database-control-plane.md` contains the Sync Vs Async Workflow Ownership matrix and documents request-time paths versus async evidence/rollup work; proxy/usage tests passed as part of the pre-live normalized service-call verification, proving gateway/shared-service counters stay off synchronous Postgres writes.
- [x] Confirm gateway config publishing remains out of phase 1 DDL unless promoted, and document desired/active config-version behavior for phase 1.5.

Verification recorded: `docs/database-control-plane.md` documents the Gateway Config Publish Contract, and `rg` over `supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql`, `prisma/schema.prisma`, and `docs/database-control-plane.md` found `apic_gateway` only in documentation, not phase 1 DDL.
- [x] Confirm Shared Services execution track remains separate from API Center phase 1 and that `shared_core` is not created by the API Center migration.

Verification recorded: `docs/database-control-plane.md` documents the Shared Services Platform Execution Boundary; `api-shared-services/docs/shared-services-platform-control-plane-plan.md` exists and states Shared Services owns future `shared_core`; `rg` over API Center phase 1 migration SQL found no `create schema shared_core`, `create table shared_*`, or `alter table shared_*` DDL.
- [x] Decide which durable evidence and rollup tables are `phase_1_blocker`, `phase_1_5`, or `future`; Management must label non-durable sources as unavailable or degraded until backing tables exist.

Verification recorded: the plan records launch-phase decisions for promotion evidence, event schema versions, gateway/shared-service rollups, pipeline decision signals, query runs, event schema validations, and Management source labels; API Center and Management source-metadata tests passed in the pre-live source metadata verification.
- [x] Capture the normalized service-call recording contract test results for tribe-to-tribe calls, tribe-to-shared calls, failed upstream calls, quota-blocked calls, and unknown-caller fallback.

Verification recorded: API Center normalized service-call recording and usage metadata contract passed with `npm test -- --runInBand src/shared/proxy-handler.spec.ts src/analytics/gateway-traffic.service.spec.ts src/analytics/shared-service-usage.service.spec.ts src/analytics/analytics.controller.spec.ts src/analytics/audit-events.service.spec.ts` for 5 suites and 50 tests. Management route contract preservation passed with `npm test -- src/app/api/local/analytics/gateway-traffic/route.test.ts src/app/api/local/analytics/shared-service-usage/route.test.ts src/app/api/local/audit/events/route.test.ts` from `C:\Codes\apic\apicenter-management` for 3 files and 5 tests after rerunning without the unsupported Jest-only `--runInBand` flag; the first Vitest run hit Windows `spawn EPERM`, and the escalated rerun passed.
- [x] Confirm API Center analytics, compliance, promotion, data-pipeline, and audit endpoints emit source metadata; Management local routes must preserve that metadata or mark the source unavailable/degraded.

Verification recorded: API Center source-metadata endpoints passed with `npm test -- --runInBand src/analytics/analytics.controller.spec.ts src/compliance/compliance-export.controller.spec.ts src/operations/promotion-evidence-bundle.controller.spec.ts src/data-pipeline/pipeline-health.controller.spec.ts src/analytics/audit-events.service.spec.ts` for 5 suites and 19 tests. The same Management local analytics/audit route tests above prove source metadata is preserved through local route schemas for gateway traffic, shared-service usage, and audit events.
- [x] Decide whether service usage history uses existing `apic_runtime.usage_rollups` in phase 1 or separate phase 1.5 `gateway_usage_rollups` and `shared_service_usage_rollups`; do not claim durable usage history until one path is implemented and verified.
- [x] Keep rollback config ready: `REGISTRY_SOURCE=redis`, `DATABASE_DUAL_WRITE=false`, and previous API Center image tag.

Rollback readiness artifact recorded: `docs/operations/api-center-rollback-readiness-2026-06-26.json` was regenerated with explicit rollback values `REGISTRY_SOURCE=redis`, `DATABASE_DUAL_WRITE=false`, and previous image `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:migration-5271227-20260623`. The rollback gate is ready and records the redeploy command target without changing live traffic.

## File Structure

- Modify: `C:\Codes\apic\api-center\prisma\schema.prisma`
- Create: `C:\Codes\apic\api-center\supabase\migrations\<generated>_enterprise_control_plane_schemas.sql`
- Modify: `C:\Codes\apic\api-center\supabase\config.toml`
- Modify: `C:\Codes\apic\api-center\src\registry\registration-requests.service.ts`
- Modify: `C:\Codes\apic\api-center\src\registry\postgres-registry-store.service.ts`
- Modify: `C:\Codes\apic\api-center\src\quotas\tribe-quota-policy.service.ts`
- Modify: `C:\Codes\apic\api-center\src\quotas\tribe-quota-enforcer.service.ts`
- Modify: `C:\Codes\apic\api-center\src\entitlements\tribe-plan.service.ts`
- Modify: `C:\Codes\apic\api-center\src\approvals\approval-request.service.ts`
- Create: `C:\Codes\apic\api-center\scripts\verify-control-plane-schema.ts`
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`
- Modify: `C:\Codes\apic\api-center\docs\developer\registry-persistence-runbook.md`
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\README.md`

## Task 1: Freeze Inputs And Confirm Live State

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-06-25-apicenter-enterprise-supabase-migration.md`

- [x] **Step 1: Capture git state**

```powershell
cd C:\Codes\apic\api-center
git -c core.fsmonitor=false status --short
git branch --show-current
```

Expected: working tree state is recorded before schema implementation starts.

- [x] **Step 2: Capture current migration folders**

```powershell
cd C:\Codes\apic\api-center
Get-ChildItem -Name .\supabase\migrations
Get-ChildItem -Name .\prisma\migrations
```

Expected: both lists are saved into implementation notes before editing migrations.

Verification recorded: `git branch --show-current` returned `main`; `git log -1 --oneline` returned `512551d chore: organize enterprise config layout`; `git -c core.fsmonitor=false status --short` captured the current dirty worktree including the enterprise migration plan, schema visualizations, verifier, source metadata, gateway-control-plane evidence service, and Supabase enterprise migration. Migration folders captured 12 Supabase migration SQL files and 8 Prisma migration directories; Supabase migration history now includes `20260625162216_enterprise_control_plane_schemas.sql`, while Prisma history still includes older control-plane migrations through `20260618000000_add_service_environments`.

- [x] **Step 3: Capture live schema row counts before any DDL**

```powershell
node .\scripts\verify-control-plane-schema.ts --row-counts
```

Expected: row counts and missing tables are recorded before any schema change.

Implementation recorded: `scripts/verify-control-plane-schema.ts --row-counts` runs a read-only inventory across `api_center`, `api_center_ops`, `api_center_audit`, `apic_catalog`, `apic_governance`, `apic_runtime`, and `apic_audit`; it prints row counts plus missing enterprise tables and compatibility views. Current live row-count evidence is captured through the direct redacted `DATABASE_URL` path in `docs/operations/supabase-row-counts-2026-06-26.json`.

- [x] **Step 3B: Add redacted row-count evidence wrapper**

Verification recorded: `npm run db:row-counts:evidence:test` passed, and `npm run db:row-counts:evidence -- --out docs/operations/supabase-row-counts-2026-06-26.json` generated a sanitized operator artifact. The current artifact records `DATABASE_URL` as missing and therefore does not execute the live verifier; Step 3 remains unchecked until the same command runs in the live operator shell and captures actual counts.

Verification recorded: row-count evidence tests passed after adding the direct Postgres collector, and the regenerated packet now reports 16 of 16 gates ready with the row-count gate ready.

- [x] **Step 3A: Implement read-only row-count verifier mode**

Verification recorded: `npm run typecheck` passed after adding `--row-counts` support to `scripts/verify-control-plane-schema.ts`. The mode connects with `DATABASE_URL`, counts existing APIC legacy and enterprise schema objects, and reports missing enterprise tables and compatibility views without applying DDL.


- [x] **Step 4: Capture explicit app roles and grants**

Implementation recorded: `scripts/discover-control-plane-roles.js` now provides a read-only, redacted role/grant discovery command for this gate. `npm run db:discover:roles:test` passed and `npm run db:discover:roles -- --out docs/operations/supabase-role-discovery-2026-06-26.json` generated an artifact showing this shell still lacks `DATABASE_URL`; live role capture remains unchecked until the command runs against the target Supabase database.

Run this query against the live Supabase project and the restored dry-run database before generating grant DDL:

```sql
select
  table_schema,
  grantee,
  string_agg(distinct privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema in ('api_center', 'api_center_ops', 'api_center_audit', 'apic_catalog', 'apic_governance', 'apic_runtime', 'apic_audit')
  and grantee not in ('postgres', 'supabase_admin', 'service_role', 'anon', 'authenticated')
group by table_schema, grantee
order by table_schema, grantee;
```

Expected: the implementation notes name the exact runtime app role or roles that need grants. The generated migration must use those explicit role names and must not contain role-discovery logic, `candidate_count`, or a guessed role name. If no app role exists, create a separate approved role/grant migration before the schema move.

## Task 2: Establish Migration Source Of Truth

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`
- Modify: `C:\Codes\apic\api-center\docs\developer\registry-persistence-runbook.md`

- [x] **Step 1: Add source-of-truth rule**

```markdown
Supabase SQL migrations under `supabase/migrations` are the canonical live database history. Prisma migrations are not used as the live deployment mechanism for APICenter control-plane schemas. `prisma/schema.prisma` must be kept in sync with Supabase migrations so application code remains typed and generated.
```

- [x] **Step 2: Add future migration command sequence**

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:new -- enterprise_control_plane_schemas
npm run db:migration:push:dry
npm run db:generate
```

Expected: migration filenames are generated by Supabase CLI, not invented by hand.

Task 2 verification recorded: `docs/database-control-plane.md` and `docs/developer/registry-persistence-runbook.md` now state that Supabase SQL migrations under `api-center/supabase/migrations` are the live database authority, Prisma migrations are client/type history only, and future schema changes must use `npm run db:migration:new -- <descriptive_name>`, `npm run db:migration:push:dry`, and `npm run db:generate`.

## Task 3: Create Enterprise Schema Migration

**Files:**
- Create: `C:\Codes\apic\api-center\supabase\migrations\<generated>_enterprise_control_plane_schemas.sql`

- [x] **Step 1: Generate the migration file**

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:new -- enterprise_control_plane_schemas
```

- [x] **Step 2: Add target schemas**

```sql
create schema if not exists apic_catalog;
create schema if not exists apic_governance;
create schema if not exists apic_runtime;
create schema if not exists apic_audit;
```

- [x] **Step 3: Add a preflight conflict guard**

Run this query in the dry-run database before moving tables. It must return zero rows.

```sql
with table_map(source_schema, source_table, target_schema, target_table) as (
  values
    ('api_center', 'organizations', 'apic_catalog', 'organizations'),
    ('api_center', 'services', 'apic_catalog', 'services'),
    ('api_center', 'service_environments', 'apic_catalog', 'service_environments'),
    ('api_center', 'service_routes', 'apic_catalog', 'service_routes'),
    ('api_center', 'service_scopes', 'apic_catalog', 'service_scopes'),
    ('api_center', 'service_dependencies', 'apic_catalog', 'service_dependencies'),
    ('api_center', 'service_lifecycle_events', 'apic_catalog', 'service_lifecycle_events'),
    ('api_center', 'tribe_secret_refs', 'apic_catalog', 'service_secret_references'),
    ('api_center_ops', 'service_registration_requests', 'apic_governance', 'registry_change_requests'),
    ('api_center_ops', 'approval_requests', 'apic_governance', 'approval_requests'),
    ('api_center_ops', 'tribe_api_quota_policies', 'apic_governance', 'quota_policies'),
    ('api_center_ops', 'tribe_plan_definitions', 'apic_governance', 'entitlement_plans'),
    ('api_center_ops', 'tribe_plan_assignments', 'apic_governance', 'entitlement_assignments'),
    ('api_center_ops', 'provisioning_jobs', 'apic_runtime', 'provisioning_jobs'),
    ('api_center_ops', 'topic_onboarding_states', 'apic_runtime', 'event_topic_onboarding_states'),
    ('api_center', 'confluent_topics', 'apic_runtime', 'confluent_topics'),
    ('api_center', 's3_sink_topics', 'apic_runtime', 's3_sink_topics'),
    ('api_center_ops', 'health_snapshots', 'apic_runtime', 'health_snapshots'),
    ('api_center_ops', 'smoke_test_runs', 'apic_runtime', 'smoke_test_runs'),
    ('api_center_ops', 'usage_rollups', 'apic_runtime', 'usage_rollups'),
    ('api_center_ops', 'tribe_api_quota_decisions', 'apic_runtime', 'quota_evaluations'),
    ('api_center_ops', 'pipeline_feedback_actions', 'apic_runtime', 'pipeline_feedback_actions'),
    ('api_center_audit', 'audit_events', 'apic_audit', 'audit_events')
)
select *
from table_map
where to_regclass(format('%I.%I', source_schema, source_table)) is not null
  and to_regclass(format('%I.%I', target_schema, target_table)) is not null;
```

Expected: zero rows. If any row appears, stop and choose a data merge/backfill path for that table before proceeding.

- [x] **Step 4: Move and rename every mapped table with data preservation**

```sql
do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('api_center', 'organizations', 'apic_catalog', 'organizations'),
      ('api_center', 'services', 'apic_catalog', 'services'),
      ('api_center', 'service_environments', 'apic_catalog', 'service_environments'),
      ('api_center', 'service_routes', 'apic_catalog', 'service_routes'),
      ('api_center', 'service_scopes', 'apic_catalog', 'service_scopes'),
      ('api_center', 'service_dependencies', 'apic_catalog', 'service_dependencies'),
      ('api_center', 'service_lifecycle_events', 'apic_catalog', 'service_lifecycle_events'),
      ('api_center', 'tribe_secret_refs', 'apic_catalog', 'service_secret_references'),
      ('api_center_ops', 'service_registration_requests', 'apic_governance', 'registry_change_requests'),
      ('api_center_ops', 'approval_requests', 'apic_governance', 'approval_requests'),
      ('api_center_ops', 'tribe_api_quota_policies', 'apic_governance', 'quota_policies'),
      ('api_center_ops', 'tribe_plan_definitions', 'apic_governance', 'entitlement_plans'),
      ('api_center_ops', 'tribe_plan_assignments', 'apic_governance', 'entitlement_assignments'),
      ('api_center_ops', 'provisioning_jobs', 'apic_runtime', 'provisioning_jobs'),
      ('api_center_ops', 'topic_onboarding_states', 'apic_runtime', 'event_topic_onboarding_states'),
      ('api_center', 'confluent_topics', 'apic_runtime', 'confluent_topics'),
      ('api_center', 's3_sink_topics', 'apic_runtime', 's3_sink_topics'),
      ('api_center_ops', 'health_snapshots', 'apic_runtime', 'health_snapshots'),
      ('api_center_ops', 'smoke_test_runs', 'apic_runtime', 'smoke_test_runs'),
      ('api_center_ops', 'usage_rollups', 'apic_runtime', 'usage_rollups'),
      ('api_center_ops', 'tribe_api_quota_decisions', 'apic_runtime', 'quota_evaluations'),
      ('api_center_ops', 'pipeline_feedback_actions', 'apic_runtime', 'pipeline_feedback_actions'),
      ('api_center_audit', 'audit_events', 'apic_audit', 'audit_events')
    ) as t(source_schema, source_table, target_schema, target_table)
  loop
    if to_regclass(format('%I.%I', item.source_schema, item.source_table)) is not null
       and to_regclass(format('%I.%I', item.target_schema, item.target_table)) is null then
      execute format('alter table %I.%I set schema %I', item.source_schema, item.source_table, item.target_schema);
      if item.source_table <> item.target_table then
        execute format('alter table %I.%I rename to %I', item.target_schema, item.source_table, item.target_table);
      end if;
    end if;
  end loop;
end $$;
```

Expected: every existing legacy table moves into its owner schema without data loss.

- [x] **Step 5: Create any target table that has no legacy source**

For every missing target table after Step 4, copy the canonical `create table`, index, and constraint definition from the existing Supabase or Prisma migration that introduced the legacy table, then change only the schema/table name to the target name from the Target Table Map.

Run this query after adding the missing-table DDL. It must return zero rows.

```sql
with required_table(target_schema, target_table) as (
  values
    ('apic_catalog', 'organizations'),
    ('apic_catalog', 'services'),
    ('apic_catalog', 'service_environments'),
    ('apic_catalog', 'service_routes'),
    ('apic_catalog', 'service_scopes'),
    ('apic_catalog', 'service_dependencies'),
    ('apic_catalog', 'service_lifecycle_events'),
    ('apic_catalog', 'service_secret_references'),
    ('apic_governance', 'registry_change_requests'),
    ('apic_governance', 'approval_requests'),
    ('apic_governance', 'quota_policies'),
    ('apic_governance', 'entitlement_plans'),
    ('apic_governance', 'entitlement_assignments'),
    ('apic_runtime', 'provisioning_jobs'),
    ('apic_runtime', 'event_topic_onboarding_states'),
    ('apic_runtime', 'confluent_topics'),
    ('apic_runtime', 's3_sink_topics'),
    ('apic_runtime', 'health_snapshots'),
    ('apic_runtime', 'smoke_test_runs'),
    ('apic_runtime', 'usage_rollups'),
    ('apic_runtime', 'quota_evaluations'),
    ('apic_runtime', 'pipeline_feedback_actions'),
    ('apic_audit', 'audit_events')
)
select *
from required_table
where to_regclass(format('%I.%I', target_schema, target_table)) is null;
```

- [x] **Step 6: Add compatibility views for every legacy table if a one-release rollout is used**

```sql
create schema if not exists api_center;
create schema if not exists api_center_ops;
create schema if not exists api_center_audit;

create or replace view api_center.organizations as select * from apic_catalog.organizations;
create or replace view api_center.services as select * from apic_catalog.services;
create or replace view api_center.service_environments as select * from apic_catalog.service_environments;
create or replace view api_center.service_routes as select * from apic_catalog.service_routes;
create or replace view api_center.service_scopes as select * from apic_catalog.service_scopes;
create or replace view api_center.service_dependencies as select * from apic_catalog.service_dependencies;
create or replace view api_center.service_lifecycle_events as select * from apic_catalog.service_lifecycle_events;
create or replace view api_center.tribe_secret_refs as select * from apic_catalog.service_secret_references;
create or replace view api_center.confluent_topics as select * from apic_runtime.confluent_topics;
create or replace view api_center.s3_sink_topics as select * from apic_runtime.s3_sink_topics;

create or replace view api_center_ops.service_registration_requests as select * from apic_governance.registry_change_requests;
create or replace view api_center_ops.approval_requests as select * from apic_governance.approval_requests;
create or replace view api_center_ops.tribe_api_quota_policies as select * from apic_governance.quota_policies;
create or replace view api_center_ops.tribe_plan_definitions as select * from apic_governance.entitlement_plans;
create or replace view api_center_ops.tribe_plan_assignments as select * from apic_governance.entitlement_assignments;
create or replace view api_center_ops.provisioning_jobs as select * from apic_runtime.provisioning_jobs;
create or replace view api_center_ops.topic_onboarding_states as select * from apic_runtime.event_topic_onboarding_states;
create or replace view api_center_ops.health_snapshots as select * from apic_runtime.health_snapshots;
create or replace view api_center_ops.smoke_test_runs as select * from apic_runtime.smoke_test_runs;
create or replace view api_center_ops.usage_rollups as select * from apic_runtime.usage_rollups;
create or replace view api_center_ops.tribe_api_quota_decisions as select * from apic_runtime.quota_evaluations;
create or replace view api_center_ops.pipeline_feedback_actions as select * from apic_runtime.pipeline_feedback_actions;

create or replace view api_center_audit.audit_events as select * from apic_audit.audit_events;
```

Expected: every legacy table name in the Target Table Map resolves during the compatibility release. If the rollout uses a maintenance window instead, record that decision and do not run old pods after the table move.

- [x] **Step 7A: Add grant-alignment evidence wrapper**

Verification recorded: `npm run db:grant-alignment:evidence:test` passed, and `node -r dotenv/config scripts/collect-grant-alignment-evidence.js --out docs/operations/grant-alignment-2026-06-26.json` regenerated a sanitized artifact. The artifact proves live role discovery found `api_center_app`, the migration grants target that explicit role, and no forbidden dynamic role-discovery pattern such as `candidate_count`, `information_schema.role_table_grants`, role-selection loops, or `limit 1` role selection appears in the migration DDL. The regenerated packet now reports 16 of 16 gates ready.

- [x] **Step 7: Add least-privilege grants using explicit discovered roles**

Use only the app role names captured in Task 1. The generated migration must not discover roles at runtime and must not contain `candidate_count`, `information_schema.role_table_grants` role-selection logic, or a guessed role name.

Verification recorded: live role discovery found `api_center_app`; grant-alignment evidence proves the migration grants target that explicit role; live verifier modes prove the applied grants, default privileges, registry child-delete grants, and audit delete denial.

If Task 1 discovers `api_center_app` as the only runtime app role, the migration contains this exact grant shape:

```sql
grant usage on schema apic_catalog, apic_governance, apic_runtime, apic_audit to api_center_app;
grant select, insert, update on all tables in schema apic_catalog to api_center_app;
grant select, insert, update on all tables in schema apic_governance to api_center_app;
grant select, insert, update on all tables in schema apic_runtime to api_center_app;
grant select, insert on apic_audit.audit_events to api_center_app;
revoke delete on all tables in schema apic_audit from api_center_app;
alter default privileges in schema apic_catalog grant select, insert, update on tables to api_center_app;
alter default privileges in schema apic_governance grant select, insert, update on tables to api_center_app;
alter default privileges in schema apic_runtime grant select, insert, update on tables to api_center_app;
alter default privileges in schema apic_audit grant select, insert on tables to api_center_app;
```

If Task 1 discovers a different runtime role, replace `api_center_app` with the exact discovered role name in the generated migration before approval. If Task 1 discovers multiple runtime roles, repeat the grant block for each role and document why each role needs app-level access. Read-only analyst/reporting roles must get a separate explicit grant block and must not receive insert/update privileges.

- [x] **Step 8: Normalize renamed index and constraint names**

Moving and renaming tables does not automatically rename indexes or constraints. Normalize names in the migration so Task 8 verifies the final enterprise names instead of legacy names.

```sql
alter index if exists apic_governance.service_registration_requests_status_created_idx rename to registry_change_requests_status_created_idx;
alter index if exists apic_governance.service_registration_requests_service_idx rename to registry_change_requests_service_idx;
alter index if exists apic_governance.service_registration_requests_owner_idx rename to registry_change_requests_owner_idx;
alter table if exists apic_governance.registry_change_requests rename constraint service_registration_requests_status_check to registry_change_requests_status_check;

alter index if exists apic_governance.tribe_quota_policies_owner_status_idx rename to quota_policies_owner_status_idx;
alter index if exists apic_governance.tribe_quota_policies_scope_target_idx rename to quota_policies_scope_target_idx;

alter index if exists apic_governance.tribe_plan_assignments_owner_env_status_idx rename to entitlement_assignments_owner_env_status_idx;
alter index if exists apic_governance.tribe_plan_assignments_plan_env_idx rename to entitlement_assignments_plan_env_idx;

alter index if exists apic_runtime.topic_onboarding_states_env_owner_idx rename to event_topic_onboarding_states_env_owner_idx;
alter index if exists apic_runtime.topic_onboarding_states_updated_idx rename to event_topic_onboarding_states_updated_idx;

alter index if exists apic_runtime.tribe_quota_decisions_owner_created_idx rename to quota_evaluations_owner_created_idx;
alter index if exists apic_runtime.tribe_quota_decisions_outcome_created_idx rename to quota_evaluations_outcome_created_idx;
alter index if exists apic_runtime.tribe_quota_decisions_correlation_idx rename to quota_evaluations_correlation_idx;
```

Expected: no verifier check depends on legacy index or constraint names after the migration. If a legacy index is absent because the source table did not exist, create the enterprise-named index in Step 9.

- [x] **Step 9: Add ownership indexes, check constraints, and retention comments**

Ensure every foreign key and Management filter path is indexed before cutover: service id, owner tribe id, environment, status/outcome, route family, target service, provider, time window, and correlation id. Add check constraints for status/outcome/mode columns where the current migration already constrains those values.

Expected: the schema verifier in Task 8 can prove required indexes, check constraints, grants, and compatibility views exist.

Task 3 local DDL verification recorded: `supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql` contains the enterprise schemas, conflict guard, mapped table move/rename block, fallback `create table if not exists` DDL, security-invoker compatibility views, enterprise-named index/constraint normalization, required Management-path indexes, check constraints, and retention comments. Step 7 remains unchecked until Task 1 discovers the real app role and grants are approved against that role.

- [x] **Step 9A: Verify every foreign-key column has leading index coverage**

Verification recorded: `npm run db:verify:enterprise-static:test` passed 8 tests, and `npm run db:verify:enterprise-static` passed after adding derived FK-index checks to `scripts/check-enterprise-migration-static.js` and adding indexes for `service_lifecycle_events.service_id`, `confluent_topics.owner_service_id`, `health_snapshots.service_id`, `smoke_test_runs.service_id`, `smoke_test_runs.tribe_service_id`, `usage_rollups.consumer_service_id`, and `usage_rollups.target_service_id`. The regenerated verifier evidence retains `staticRun.status=0`; live verifier modes also pass against the applied target database.

## Task 4: Update Prisma Schema To Enterprise Names

**Files:**
- Modify: `C:\Codes\apic\api-center\prisma\schema.prisma`

- [x] **Step 1: Update datasource schemas**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  schemas  = ["apic_catalog", "apic_governance", "apic_runtime", "apic_audit"]
}
```

- [x] **Step 2: Use enterprise Prisma model names**

```prisma
model RegistryChangeRequest { @@map("registry_change_requests") @@schema("apic_governance") }
model QuotaPolicy { @@map("quota_policies") @@schema("apic_governance") }
model EntitlementPlan { @@map("entitlement_plans") @@schema("apic_governance") }
model EntitlementAssignment { @@map("entitlement_assignments") @@schema("apic_governance") }
model EventTopicOnboardingState { @@map("event_topic_onboarding_states") @@schema("apic_runtime") }
model QuotaEvaluation { @@map("quota_evaluations") @@schema("apic_runtime") }
model ConfluentTopic { @@map("confluent_topics") @@schema("apic_runtime") }
model S3SinkTopic { @@map("s3_sink_topics") @@schema("apic_runtime") }
```

- [x] **Step 3: Generate the client**

```powershell
cd C:\Codes\apic\api-center
npm run db:generate
```

Expected: Prisma client generation succeeds without schema validation errors.

## Task 5: Update Application Code References

**Files:**
- Modify: `C:\Codes\apic\api-center\src\registry\registration-requests.service.ts`
- Modify: `C:\Codes\apic\api-center\src\quotas\tribe-quota-policy.service.ts`
- Modify: `C:\Codes\apic\api-center\src\quotas\tribe-quota-enforcer.service.ts`
- Modify: `C:\Codes\apic\api-center\src\entitlements\tribe-plan.service.ts`
- Modify: `C:\Codes\apic\api-center\src\approvals\approval-request.service.ts`

- [x] **Step 1: Find raw schema references**

```powershell
cd C:\Codes\apic\api-center
rg -n "api_center|api_center_ops|api_center_audit|tribeApiQuota|tribePlan|service_registration_requests|topic_onboarding_states" src test prisma docs -S
```

Expected: every remaining hit is migrated, documented as compatibility behavior, or intentionally left in an old migration file.

- [x] **Step 2: Replace raw SQL and Prisma model access**

```text
api_center_ops.service_registration_requests -> apic_governance.registry_change_requests
tribeApiQuotaPolicy -> quotaPolicy
tribeApiQuotaDecision -> quotaEvaluation
tribePlanDefinition -> entitlementPlan
tribePlanAssignment -> entitlementAssignment
```

- [x] **Step 3: Keep public API payloads stable**

Keep `ownerTribeId` in request/response payloads during this database-only rename unless a versioned API change is approved.

## Task 6: Add Tracking And Audit Coverage

**Files:**
- Modify: `C:\Codes\apic\api-center\src\registry\registration-requests.service.ts`
- Modify: `C:\Codes\apic\api-center\src\approvals\approval-request.service.ts`
- Modify: `C:\Codes\apic\api-center\src\quotas\tribe-quota-enforcer.service.ts`

- [x] **Step 1: Use durable action names**

```text
registry.service.create_requested
registry.service.update_requested
registry.service.disable_requested
registry.service.archive_requested
registry.service.delete_requested
approval.request.approved
approval.request.rejected
quota.policy.created
quota.policy.updated
quota.evaluation.allowed
quota.evaluation.denied
entitlement.assignment.created
entitlement.assignment.updated
runtime.topic.provision_requested
runtime.topic.provisioned
runtime.sink.binding_created
secret.reference.rotated
```

- [x] **Step 2: Require evidence fields in audit events**

```json
{
  "actor_type": "human|service|system",
  "actor_id": "string",
  "action": "registry.service.update_requested",
  "resource_type": "service|quota_policy|entitlement_assignment|approval_request|event_topic|data_sink",
  "resource_id": "string",
  "environment": "test|uat|prod",
  "correlation_id": "string",
  "metadata": { "before": {}, "after": {}, "reason": "string" }
}
```

- [x] **Step 3: Fail closed for required audit writes**

Provider-impacting actions must not return success unless the governance row and audit row are written.

- [x] **Step 3A: Add required audit writer for provider-impacting governance actions**

Verification recorded: `AuditEventsService.recordRequired` now validates actor, action family, resource type, resource id, environment, and correlation id, and throws on configured Postgres audit-write failures. Registration create/decision, registry lifecycle create/update/disable/archive/delete, approval create/approve/reject, quota policy create/update/disable, entitlement assignment update, and secret rotation now await required audit writes instead of swallowing failures. Focused tests passed with `npm test -- --runInBand src/analytics/audit-events.service.spec.ts src/registry/registration-requests.controller.spec.ts src/registry/registry.controller.spec.ts src/approvals/approval-request.controller.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts src/secrets/tribe-secret-rotation.service.spec.ts`; `npm run typecheck` also passed. Task 6 exact action-name coverage was completed by the later runtime, quota, and entitlement sub-slices.

- [x] **Step 3B: Add required audit evidence for runtime topic and sink onboarding**

Verification recorded: `TopicOnboardingStateService.upsert` now records required runtime audit events for `runtime.topic.provision_requested`, `runtime.topic.provisioned`, and `runtime.sink.binding_created`; `TopicOnboardingStateController` forwards request correlation ids into the service. The runtime audit path fails closed when `AuditEventsService.recordRequired` rejects. Focused tests passed with `npm test -- --runInBand src/data-pipeline/topic-onboarding-state.service.spec.ts src/analytics/audit-events.service.spec.ts src/registry/registration-requests.controller.spec.ts src/registry/registry.controller.spec.ts src/approvals/approval-request.controller.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts src/secrets/tribe-secret-rotation.service.spec.ts`; `npm run typecheck` also passed. Task 6 exact action-name coverage was completed by the later quota and entitlement sub-slice.

- [x] **Step 3C: Align quota denial and entitlement assignment create/update evidence**

Verification recorded: enforced quota blocks now emit the planned `quota.evaluation.denied` audit action while preserving the durable quota decision outcome `blocked`; quota audit records now include resource type, resource id, runtime environment, and correlation id metadata. Plan assignment creation now emits `entitlement.assignment.created`, and a narrow assignment status update path emits required `entitlement.assignment.updated` audit evidence with fail-closed behavior. Focused tests passed with `npm test -- --runInBand src/entitlements/tribe-plan.service.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts`; broader Task 6 regression passed with `npm test -- --runInBand src/data-pipeline/topic-onboarding-state.service.spec.ts src/analytics/audit-events.service.spec.ts src/registry/registration-requests.controller.spec.ts src/registry/registry.controller.spec.ts src/approvals/approval-request.controller.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/entitlements/tribe-plan.service.spec.ts src/entitlements/tribe-plan-admin.controller.spec.ts src/secrets/tribe-secret-rotation.service.spec.ts` for 10 suites and 62 tests; `npm run typecheck` also passed.

## Task 7: Add Security And Access Posture

**Files:**
- Modify: `C:\Codes\apic\api-center\supabase\migrations\<generated>_enterprise_control_plane_schemas.sql`
- Modify: `C:\Codes\apic\api-center\supabase\config.toml`
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`

- [x] **Step 1: Keep control-plane schemas private**

```toml
[api]
schemas = ["public", "graphql_public"]
```

- [x] **Step 2: Revoke broad public access**

```sql
revoke all on schema apic_catalog, apic_governance, apic_runtime, apic_audit from public;
revoke all on all tables in schema apic_catalog from public;
revoke all on all tables in schema apic_governance from public;
revoke all on all tables in schema apic_runtime from public;
revoke all on all tables in schema apic_audit from public;
```

- [x] **Step 3: Document RLS stance**

```markdown
APIC control-plane schemas are private server-side schemas. Browser clients do not query them directly through Supabase Data API. If any APIC control-plane table is later exposed to `anon` or `authenticated`, RLS must be enabled first with owner/environment predicates and indexed policy columns.
```

Task 7 verification recorded: `supabase/config.toml` exposes only `public` and `graphql_public`; the enterprise migration revokes broad `public` access from `apic_catalog`, `apic_governance`, `apic_runtime`, and `apic_audit`; `docs/database-control-plane.md` now documents the private server-side/RLS stance and requires owner/environment RLS before any future `anon` or `authenticated` exposure.

## Task 7A: Add Retention And Partitioning Launch Decisions

**Files:**
- Modify: `C:\Codes\apic\api-center\supabase\migrations\<generated>_enterprise_control_plane_schemas.sql`
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`
- Modify: `C:\Codes\apic\api-center\scripts\verify-control-plane-schema.ts`

- [x] **Step 1: Record the concrete phase 1 retention policy**

Add this retention matrix to `docs/database-control-plane.md` and copy the same policy into table comments in the migration:

| Table | Minimum retention | Partition decision before live | Reason |
| --- | --- | --- | --- |
| `apic_audit.audit_events` | 400 days | Monthly partition required before audit-ready compliance claims; low-volume exception allowed only with written approval | Compliance and investigation evidence |
| `apic_runtime.quota_evaluations` | 180 days | Monthly partition required before enforced quota traffic is high-volume; low-volume observe-mode exception allowed with row-count threshold | Quota history and appeals |
| `apic_runtime.usage_rollups` | 400 days | Monthly partition or rollup-only table accepted; raw per-request storage is not allowed | Reliability, cost, and chargeback history |
| `apic_runtime.health_snapshots` | 90 days | No partition required unless row-count forecast exceeds 1 million rows in 90 days | Operational readiness trend |
| `apic_runtime.smoke_test_runs` | 180 days | No partition required unless row-count forecast exceeds 1 million rows in 180 days | Promotion and readiness evidence |
| `apic_runtime.pipeline_feedback_actions` | 365 days | No partition required in phase 1; revisit when automated feedback volume exceeds 100k rows/month | Pipeline decision audit |

Expected: every high-volume table has a retention duration, partition decision, and row-count threshold before live approval.

- [x] **Step 2: Add retention comments or partition DDL**

If the table is not partitioned in phase 1, add comments that make the approved exception machine-checkable:

```sql
comment on table apic_audit.audit_events is 'retention=400d; partition=monthly_required_before_audit_ready; exception=requires_written_approval';
comment on table apic_runtime.quota_evaluations is 'retention=180d; partition=monthly_required_before_high_volume_enforcement; exception=observe_mode_low_volume';
comment on table apic_runtime.usage_rollups is 'retention=400d; partition=monthly_or_rollup_only; raw_request_storage=forbidden';
comment on table apic_runtime.health_snapshots is 'retention=90d; partition=row_count_threshold_1000000_per_90d';
comment on table apic_runtime.smoke_test_runs is 'retention=180d; partition=row_count_threshold_1000000_per_180d';
comment on table apic_runtime.pipeline_feedback_actions is 'retention=365d; partition=row_count_threshold_100000_per_month';
```

Expected: `scripts/verify-control-plane-schema.ts --require-retention-policy` can read `pg_description` and fail if a required table has no retention comment or approved partition.

- [x] **Step 3: Add purge/archive ownership**

Document the maintenance owner role for retention work. The app runtime role must not delete audit rows. If purge/archive SQL is needed, it must run under a separately approved retention-maintainer role and must exclude legal-hold or compliance-lock records.

Expected: live approval names the retention maintainer, the first review date, and the rollback behavior for accidental purge jobs.

Task 7A verification recorded: `docs/database-control-plane.md` contains the phase 1 retention matrix and retention-maintainer ownership rule; `supabase/migrations/20260625162216_enterprise_control_plane_schemas.sql` records machine-checkable `retention=` table comments and denies audit deletes to the runtime app role. The live approval gate still must name the real maintainer role and first review date before enabling purge/archive jobs.


## Task 8: Add Schema Verification Script

**Files:**
- Create: `C:\Codes\apic\api-center\scripts\verify-control-plane-schema.ts`
- Modify: `C:\Codes\apic\api-center\package.json`

- [x] **Step 1: Create a verifier that checks required tables**

Required tables:

```text
apic_catalog.organizations
apic_catalog.services
apic_catalog.service_environments
apic_catalog.service_routes
apic_catalog.service_scopes
apic_catalog.service_dependencies
apic_catalog.service_lifecycle_events
apic_catalog.service_secret_references
apic_governance.registry_change_requests
apic_governance.approval_requests
apic_governance.quota_policies
apic_governance.entitlement_plans
apic_governance.entitlement_assignments
apic_runtime.provisioning_jobs
apic_runtime.event_topic_onboarding_states
apic_runtime.confluent_topics
apic_runtime.s3_sink_topics
apic_runtime.quota_evaluations
apic_runtime.health_snapshots
apic_runtime.smoke_test_runs
apic_runtime.usage_rollups
apic_runtime.pipeline_feedback_actions
apic_audit.audit_events
```

The script must connect with `DATABASE_URL`, query `information_schema.tables`, print missing objects, and exit non-zero if anything is absent.

- [x] **Step 2: Verify compatibility views when compatibility mode is selected**

Required legacy views:

```text
api_center.organizations
api_center.services
api_center.service_environments
api_center.service_routes
api_center.service_scopes
api_center.service_dependencies
api_center.service_lifecycle_events
api_center.tribe_secret_refs
api_center.confluent_topics
api_center.s3_sink_topics
api_center_ops.service_registration_requests
api_center_ops.approval_requests
api_center_ops.tribe_api_quota_policies
api_center_ops.tribe_plan_definitions
api_center_ops.tribe_plan_assignments
api_center_ops.provisioning_jobs
api_center_ops.topic_onboarding_states
api_center_ops.health_snapshots
api_center_ops.smoke_test_runs
api_center_ops.usage_rollups
api_center_ops.tribe_api_quota_decisions
api_center_ops.pipeline_feedback_actions
api_center_audit.audit_events
```

The verifier must accept `--require-compat-views`. When that flag is present, query `information_schema.views` and fail if any compatibility view is absent.

- [x] **Step 3: Verify indexes and check constraints**

The verifier must check `pg_indexes` and `pg_constraint` for the critical launch objects:

```text
service_environments_service_id_idx
service_environments_env_status_idx
registry_change_requests_status_created_idx
registry_change_requests_service_idx
registry_change_requests_owner_idx
approval_requests_status_created_idx
approval_requests_action_env_idx
approval_requests_target_idx
quota_policies_owner_status_idx
quota_policies_scope_target_idx
quota_evaluations_owner_created_idx
quota_evaluations_outcome_created_idx
quota_evaluations_correlation_idx
pipeline_feedback_actions_env_target_idx
pipeline_feedback_actions_status_created_idx
pipeline_feedback_actions_owner_idx
pipeline_feedback_actions_correlation_idx
audit_events_created_idx
audit_events_resource_idx
audit_events_actor_idx
```

Expected: every required index and status/outcome check constraint exists under the new owner schema names.

- [x] **Step 4: Reject legacy index and constraint names after normalization**

The verifier must query `pg_indexes` and `pg_constraint` and fail if any normalized object still uses a legacy name after the schema migration:

```text
service_registration_requests_status_created_idx
service_registration_requests_service_idx
service_registration_requests_owner_idx
service_registration_requests_status_check
tribe_quota_policies_owner_status_idx
tribe_quota_policies_scope_target_idx
tribe_quota_decisions_owner_created_idx
tribe_quota_decisions_outcome_created_idx
tribe_quota_decisions_correlation_idx
tribe_plan_assignments_owner_env_status_idx
tribe_plan_assignments_plan_env_idx
topic_onboarding_states_env_owner_idx
topic_onboarding_states_updated_idx
```

Expected: the verifier proves final enterprise object names, not only table names.

- [x] **Step 5: Verify retention policy comments or partitions**

The verifier must accept `--require-retention-policy`. When present, query `pg_description` and `pg_partitioned_table` for the retention-managed tables:

```text
apic_audit.audit_events
apic_runtime.quota_evaluations
apic_runtime.usage_rollups
apic_runtime.health_snapshots
apic_runtime.smoke_test_runs
apic_runtime.pipeline_feedback_actions
```

Expected: each table has either a partition strategy or a retention comment matching Task 7A. Missing retention metadata fails live approval.


- [x] **Step 6: Verify grants, audit delete denial, and private schema exposure**

The verifier must accept `--app-role <role>`. With that role, query `information_schema.role_table_grants` and fail if:

```text
- app role lacks usage/select/insert/update needed by app-owned tables.
- app role can delete from apic_audit.audit_events.
- anon or authenticated has direct grants on apic_catalog, apic_governance, apic_runtime, or apic_audit tables.
- supabase/config.toml exposes apic_catalog, apic_governance, apic_runtime, or apic_audit through [api].schemas.
```

- [x] **Step 7: Add package script**

```json
{
  "scripts": {
    "db:verify:control-plane": "tsx scripts/verify-control-plane-schema.ts"
  }
}
```

- [x] **Step 8A: Add consolidated verifier evidence wrapper**

Verification recorded: `npm run db:verifier:evidence:test` passed, and `node -r dotenv/config scripts/collect-verifier-evidence.js --out docs/operations/supabase-verifier-readiness-2026-06-26.json --fail-on-blockers` regenerated a sanitized artifact. The artifact runs the static enterprise migration verifier in-process and executes the required live verifier commands for base, compatibility-view, and retention-policy modes as `api_center_app`; all live verifier modes now pass after applying the enterprise migration, normalization migration, and registry child-delete grant migration. The regenerated packet now reports 16 of 16 gates ready.

- [x] **Step 8: Run the verifier in all required modes**

```powershell
cd C:\Codes\apic\api-center
npm run db:verify:control-plane -- --app-role <discovered-app-role>
npm run db:verify:control-plane -- --app-role <discovered-app-role> --require-compat-views
npm run db:verify:control-plane -- --app-role <discovered-app-role> --require-retention-policy
```

Expected: the verifier proves tables, compatibility views, critical indexes, normalized object names, retention metadata, check constraints, grants, audit delete denial, and private schema exposure before live migration approval.

Verifier evidence artifact recorded: `docs/operations/supabase-verifier-readiness-2026-06-26.json` was regenerated with `dotenv/config`; `npm run db:verifier:evidence:test` passed. The static enterprise migration verifier passed inside the artifact and live verifier commands passed as `api_center_app` for base, compatibility-view, and retention-policy modes. The approval packet includes this artifact as a ready `schema_verifier` gate.

Static migration gate recorded: the regenerated approval packet also reads the same verifier artifact as `static_migration_guard`, which is ready because `staticRun.status` is `0`. This does not satisfy the live `schema_verifier` gate; it only separates proven static DDL safety from live database verification.

Current run note: Task 8 Step 8 is checked. The verifier has `DATABASE_URL` and discovered app role `api_center_app`; it proves the required `apic_*` tables, compatibility views, indexes, constraints, retention metadata, app-role grants, audit delete denial, and private-schema exposure guard on the live database.

## Task 9: Test And Build Before Live Migration

**Files:**
- Test: `C:\Codes\apic\api-center\src\registry\postgres-registry-store.service.spec.ts`
- Test: `C:\Codes\apic\api-center\src\registry\registration-requests.service.spec.ts`
- Test: `C:\Codes\apic\api-center\src\quotas\tribe-quota-policy.service.spec.ts`
- Test: `C:\Codes\apic\api-center\src\quotas\tribe-quota-enforcer.service.spec.ts`
- Test: `C:\Codes\apic\api-center\src\approvals\approval-request.service.spec.ts`

- [x] **Step 1: Run focused tests**

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/postgres-registry-store.service.spec.ts src/registry/registration-requests.service.spec.ts src/quotas/tribe-quota-policy.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/approvals/approval-request.service.spec.ts
```

- [x] **Step 2: Run build**

```powershell
cd C:\Codes\apic\api-center
npm run build
```

- [x] **Step 3: Search for stale table names**

```powershell
cd C:\Codes\apic\api-center
rg -n "api_center_ops|service_registration_requests|tribe_api_quota|tribe_plan_|topic_onboarding_states" src prisma docs -S
```

Expected: only historical migration references and explicit compatibility documentation remain.

Verification recorded: `npm test -- --runInBand src/registry/postgres-registry-store.service.spec.ts src/registry/registration-requests.service.spec.ts src/quotas/tribe-quota-policy.service.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/approvals/approval-request.service.spec.ts` passed 5 suites and 24 tests. `npm run build` initially hit Windows EPERM unlinking `dist/app.module.d.ts`; rerun with elevated filesystem access passed. `npm run db:generate` initially hit the dead proxy `127.0.0.1:9`; rerun with proxy env vars cleared passed. Strict runtime stale-name search over `src` and `prisma/schema.prisma` returned no legacy runtime table references; remaining broad-search hits are historical migrations, compatibility migration SQL, compatibility docs, the public `TRIBE_API_QUOTA_EXCEEDED` error code, and the enterprise `event_topic_onboarding_states` name.

## Task 10: Add Management Source-Backed Verification Gates

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-06-25-apicenter-enterprise-supabase-migration.md`
- Modify: `C:\Codes\apic\apicenter-management\package.json`
- Test: `C:\Codes\apic\apicenter-management\scripts\smoke-routes.mjs`
- Create: `C:\Codes\apic\api-center\src\analytics\gateway-traffic.service.spec.ts`

- [x] **Step 1: Document the Management source-backed matrix**

Add a section to `docs/database-control-plane.md` that mirrors the Management Source-Backed Feature Matrix from this plan. The document must state that a Management feature is enterprise-ready only when its source is durable, queryable by the filters used by the UI, and covered by a route/API smoke check.

Expected: the database control-plane document contains a Management feature matrix and lists degraded/volatile source behavior.

- [x] **Step 2: Extend the Management smoke gate**

Run from `C:\Codes\apic\apicenter-management`:

```powershell
npm run smoke:routes
```

Expected: route smoke covers the Management pages and local API routes for readiness, registry, lifecycle, operational trust, compliance, reliability, cost, data pipeline, quotas, plans, developer portal, shared services, audit, and alerts.

- [x] **Step 3: Add the missing gateway traffic source contract test**

Create `src/analytics/gateway-traffic.service.spec.ts` before running the Management source tests. Required assertions:

```text
- records a successful tribe proxy request into the selected hourly window.
- records a failed shared-service proxy request into 4xx/5xx counters.
- returns Redis-windowed or in-memory-windowed data only; it must not claim durable Supabase history.
- exposes enough fields for Management to label the source as volatile until durable rollups exist.
```

- [x] **Step 4: Add API Center contract checks for Management sources**

Run from `C:\Codes\apic\api-center`:

```powershell
npm test -- src/operations/promotion-evidence-bundle.service.spec.ts src/compliance/compliance-export.controller.spec.ts src/analytics/gateway-traffic.service.spec.ts src/analytics/shared-service-usage.service.spec.ts src/data-pipeline/event-schema-registry.service.spec.ts src/data-pipeline/pipeline-feedback.service.spec.ts
```

Expected: tests identify which Management sources are durable, volatile, fixture-backed, or externally sourced.

- [x] **Step 5: Record phase 1 versus phase 1.5 durable evidence decisions**

Confirm these decisions remain correct for each table in Required Durable Evidence And Rollup Tables:

```text
phase_1_blocker: must exist before live cutover
phase_1_5: must exist before product-complete claims
future: only needed when feature is enabled
```

Expected: no durable evidence table has an unreviewed launch status.

## Task 11: Add Modular Monolith Boundary Gates

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`
- Modify: `C:\Codes\apic\api-center\scripts\check-boundaries.js`
- Modify: `C:\Codes\apic\api-center\package.json`
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-06-25-apicenter-enterprise-supabase-migration.md`

- [x] **Step 1: Document bounded-context ownership**

Add a `Modular Monolith Boundary Rules` section to `docs/database-control-plane.md` with the bounded-context matrix from this plan. The document must state owner module paths, owner schemas, allowed cross-context access paths, and future extraction criteria.

Expected: every schema in `apic_catalog`, `apic_governance`, `apic_runtime`, `apic_audit`, future `apic_gateway`, and future `shared_core` has exactly one owning context.

- [x] **Step 2: Enforce source-level boundaries**

Update `scripts/check-boundaries.js` so it fails when new code imports domain internals across bounded contexts. Allowed cross-context access is through exported module services, controller/API contracts, documented read models, or event/outbox contracts.

Minimum boundary groups:

```text
catalog_registry: src/registry, src/catalog
governance: src/approvals, src/quotas, src/entitlements, src/developer-portal, src/policy
runtime_operations: src/analytics, src/health, src/forecasting, src/operations
audit_evidence: src/compliance plus audit/evidence services
data_pipeline_governance: src/data-pipeline, src/kafka-governance
gateway_control_plane: future src/gateway-control-plane plus gateway/proxy contracts
shared_service_platform: src/shared-services plus api-shared-services API contracts
auth_identity: src/auth, src/secrets
shared_kernel: src/shared, src/config, src/database, src/metrics
```

Public contract allowlist for the first boundary gate:

```text
*.module.ts
*.types.ts
*.dto.ts
src/openapi/**
src/contracts/**
src/shared/**
src/config/**
src/database/prisma.service.ts
```

Explicitly forbidden for new cross-context imports:

```text
*.service.ts from another bounded context unless exported through that context's module contract
*.repository.ts from another bounded context
*.controller.ts from another bounded context
schema-qualified raw SQL against another context's owner schema
Prisma model writes against another context's owner schema
```

Expected: direct imports from another context's internal files fail unless they are explicitly listed as public contracts. Existing violations discovered by the first run must be documented as temporary exceptions with an owner and removal path.

- [x] **Step 3: Enforce schema ownership in review**

Add a schema ownership check to the boundary gate or document the manual review query. New Prisma model mappings and raw SQL must match the owning context in the matrix.

Expected: no new table is added to a schema without an owning bounded context and no module writes another context's owner schema directly.

- [x] **Step 4: Run boundary checks before migration approval**

```powershell
cd C:\Codes\apic\api-center
npm run check:boundaries
```

Expected: boundary check passes, or every allowed exception is documented with a removal path.

Verification: `npm run check:boundaries:test` and `npm run check:boundaries` passed locally after adding the boundary gate.

- [x] **Step 5: Add extraction readiness checklist**

Add this checklist to `docs/database-control-plane.md` for any future microservice split:

```text
- Owner schema and grants are isolated.
- Public API contract is versioned and tested.
- Event contract or outbox contract is versioned and tested.
- Management route smoke covers degraded/unavailable states.
- Observability, alerts, rollback, and replay behavior are documented.
- No other bounded context depends on private tables or private classes.
```

Expected: future service splits are a release decision, not a rewrite.

## Task 11A: Add Sync, Freshness, Gateway Publish, And Shared-Service Contracts

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-06-25-apicenter-enterprise-supabase-migration.md`
- Modify: `C:\Codes\apic\api-center\src\analytics\analytics.controller.ts`
- Modify: `C:\Codes\apic\api-center\src\compliance\compliance-export.controller.ts`
- Modify: `C:\Codes\apic\api-center\src\operations\promotion-evidence-bundle.service.ts`
- Modify: `C:\Codes\apic\api-center\src\data-pipeline\pipeline-health.controller.ts`
- Modify: `C:\Codes\apic\api-center\src\data-pipeline\pipeline-governance.service.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts` or the current shared API schema file for Management response metadata
- Test: `C:\Codes\apic\apicenter-management\scripts\smoke-routes.mjs`
- Future modify: `C:\Codes\apic\api-shared-services\docs\database-control-plane.md` or equivalent Shared Services database/platform plan when the shared-core execution track starts

- [x] **Step 1: Document sync versus async workflow ownership**

Add the Sync vs Async Decision Matrix from this plan to `docs/database-control-plane.md`. The document must state that runtime auth, route lookup, entitlement/quota admission, idempotency reservation, provider result calls, and webhook receipt are synchronous; usage rollups, evidence snapshots, alerts, cost trends, provider reconciliation, and pipeline analytics are asynchronous.

Expected: no workflow is described as both sync and async without explaining which part is request-time and which part is background evidence or rollup work.

- [x] **Step 2: Add Management source freshness metadata to API contracts**

Add `ManagementSourceMetadata` to the API Center response contracts first, then validate the same shape in Management. API Center must emit source metadata from analytics, compliance export, promotion evidence, data-pipeline health, and pipeline governance responses; Management must not invent durability labels that were not supplied or explicitly mapped from the upstream source.

Required fields:

```ts
type ManagementSourceMetadata = {
  sourceType: "durable" | "volatile" | "external" | "computed" | "unavailable";
  sourceName: string;
  durability: "postgres" | "redis-window" | "provider-api" | "athena" | "computed-projection" | "none";
  window?: "15m" | "1h" | "24h" | "7d" | "30d";
  lastRefreshedAt?: string;
  staleAfterSeconds?: number;
  degradedReason?: string;
  evidenceTable?: string;
  correlationId?: string;
};
```

Expected: API Center tests fail if the upstream endpoint omits source metadata, and Management route/API tests fail if volatile or unavailable data is displayed without that metadata.

- [x] **Step 3: Document gateway config publish mechanics**

Add the Gateway Config Publish Contract to `docs/database-control-plane.md`: approval creates authoring state, publish creates a versioned snapshot with checksum, gateway instances report active config version, and rollback republishes the previous known-good version.

Expected: future `apic_gateway` work has a publish/activate/rollback model before any gateway-specific migration is generated.

- [x] **Step 4: Create the Shared Services platform execution plan before creating `shared_core`**

Create or update the Shared Services plan in `C:\Codes\apic\api-shared-services` before any `shared_core` DDL exists. The plan must state that Supabase SQL migrations are the canonical shared-service database history, Prisma shared-service schema files are generated/synchronized clients, and no API Center migration may create or alter `shared_core`. The plan must include integration registry, entitlements, provider account refs, provider secret refs, idempotency keys, webhook inbox, outbox events, usage rollups, provider reconciliation, Management degraded-state behavior, and a no-touch diff against existing `shared_*` provider schemas.

Expected: API Center phase 1 keeps `shared_*` untouched; shared-core work proceeds as a separate Shared Services-owned migration track with its own migration authority, dry run, rollback, and no-touch verification.

- [x] **Step 5: Add evidence trigger tests before claiming audit-ready exports**

Add tests proving that registration approval, quota policy change, quota evaluation, secret rotation, promotion gate evaluation, compliance export, shared-service webhook receipt, gateway config publish, and retirement each create or reference the expected audit/evidence records.

- [x] Registration approval and rejection emit `registration_request.approved` and `registration_request.rejected` audit records with actor, service, owner tribe, request ID, and outcome metadata.
- [x] Quota policy create/update/disable emits `quota.policy.updated` and `quota.policy.disabled` audit records with owner tribe, policy, mode, actor, and correlation metadata.
- [x] Quota admission writes durable `quota_evaluations` evidence and emits non-blocking `quota.evaluation.*` audit records with policy, window, outcome, and correlation metadata.
- [x] Secret rotation emits `secret.rotation_started`, `secret.new_secret_verified`, and `secret.old_secret_revoked` audit records without plaintext secret material.
- [x] Promotion gate evaluation emits `promotion.evidence.generated` audit records with section statuses and source metadata.
- [x] Compliance export preserves audit and promotion-evidence source metadata so volatile evidence is labeled instead of presented as durable.
- [x] PayMongo shared-service webhook receipt emits `shared_service.webhook.received` audit records after signature validation without storing webhook bodies, signatures, or secret material.
- [x] Gateway config publish has a phase 1.5 contract-level evidence service that emits `gateway.config.published` audit records without adding phase 1 gateway DDL.
- [x] Service retirement emits `service.retired` lifecycle audit records with approval request and affected consumers.

Verification recorded: `npm test -- --runInBand src/quotas/tribe-quota-admin.controller.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/secrets/tribe-secret-rotation.service.spec.ts src/operations/promotion-evidence-bundle.controller.spec.ts src/registry/registry.controller.spec.ts src/registry/registration-requests.controller.spec.ts src/shared-services/payment-webhook.controller.spec.ts src/compliance/compliance-export.controller.spec.ts src/gateway-control-plane/gateway-config-publish-evidence.service.spec.ts src/analytics/audit-events.service.spec.ts` passed 10 suites and 42 tests; `npm run typecheck` passed.

Expected: compliance export either reads durable pre-captured evidence or labels missing evidence as incomplete; it does not silently assemble volatile in-memory evidence as audit-ready.

- [x] **Step 6: Extend smoke routes for source freshness and degraded states**

Run from `C:\Codes\apic\apicenter-management`:

```powershell
npm run smoke:routes
```

Expected: smoke coverage includes source metadata and degraded/unavailable states for `/compliance`, `/operational-trust`, `/reliability`, `/cost`, `/promotions`, `/shared-services/usage`, and `/data-pipeline`.

## Task 11B: Add Service-Call Recording And Usage Durability Gates

**Files:**
- Modify: `C:\Codes\apic\api-center\src\shared\proxy-handler.ts`
- Modify: `C:\Codes\apic\api-center\src\analytics\gateway-traffic.service.ts`
- Modify: `C:\Codes\apic\api-center\src\analytics\shared-service-usage.service.ts`
- Modify: `C:\Codes\apic\api-center\src\analytics\analytics.controller.ts`
- Modify: `C:\Codes\apic\api-center\src\analytics\audit-events.service.ts`
- Modify: `C:\Codes\apic\api-center\src\operations\consumer-scorecard.controller.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts` and route/client schemas that parse analytics responses
- Test: `C:\Codes\apic\api-center\src\shared\proxy-handler.spec.ts`
- Test: `C:\Codes\apic\api-center\src\analytics\gateway-traffic.service.spec.ts`
- Test: `C:\Codes\apic\api-center\src\analytics\shared-service-usage.service.spec.ts`
- Test: `C:\Codes\apic\api-center\src\analytics\analytics.controller.spec.ts`
- Test: `C:\Codes\apic\apicenter-management\src\app\api\local\analytics\gateway-traffic\route.test.ts`
- Test: `C:\Codes\apic\apicenter-management\src\app\api\local\analytics\shared-service-usage\route.test.ts`

- [x] **Step 1: Write failing proxy recording tests**

Add test cases proving that a successful tribe-to-tribe proxy call and a failed tribe-to-shared proxy call produce usage observations with these fields: `correlation_id`, `environment`, `caller_type`, `caller_id`, `source_service_id`, `target_type`, `target_service_id` or `shared_service_id`, `route_family`, `http_method`, `status_code`, `outcome`, `latency_ms`, and `rollup_key`.

Run from `C:\Codes\apic\api-center`:

```powershell
npm test -- --runInBand src/shared/proxy-handler.spec.ts
```

Expected: tests fail until the proxy emits the normalized service-call observation for both API service and shared-service targets.

- [x] **Step 2: Normalize usage observations in the proxy**

Update `ProxyHandler` so gateway traffic, shared-service usage, and audit calls are fed from one normalized observation object. The implementation must keep the current after-response behavior for nonessential analytics and must not introduce a synchronous Postgres write on the proxy hot path.

Expected: existing proxy behavior stays intact, but usage/audit recording no longer depends on separate ad hoc field mappings.

- [x] **Step 3: Add source metadata to usage services**

Update `GatewayTrafficService` and `SharedServiceUsageService` to expose source metadata alongside rollup rows:

```ts
{
  sourceType: "volatile",
  sourceName: "gateway-traffic-redis-window" | "shared-service-usage-redis-window" | "gateway-traffic-memory-window" | "shared-service-usage-memory-window",
  durability: "redis-window",
  window: "15m" | "1h" | "24h" | "7d" | "30d",
  lastRefreshedAt: string,
  staleAfterSeconds: number,
  degradedReason?: string,
  correlationId?: string
}
```

Expected: Redis-backed and in-memory fallback paths are distinguishable, and Management can label in-memory fallback as degraded.

- [x] **Step 4: Preserve metadata through API Center analytics endpoints**

Update analytics controller responses for `/analytics/gateway-traffic`, `/analytics/shared-service-usage`, `/analytics/provider-usage`, `/analytics/alerts`, and `/analytics/audit/events` so each response includes source metadata without removing existing `meta.window`, `meta.timestamp`, or `meta.correlationId` fields.

Expected: existing clients keep working, and new clients can distinguish durable audit, Redis-windowed usage, computed alerts, and unavailable/degraded sources.

- [x] **Step 5: Preserve metadata through Management local routes and schemas**

Update Management Zod schemas and local API route tests so metadata from API Center is parsed and preserved. Management may map older API Center responses to `sourceType: "unavailable"` only when the upstream truly omits metadata, and the UI must label that state as degraded.

Expected: Management does not invent `durable` labels for gateway traffic, shared-service usage, compliance evidence, promotion evidence, or data-pipeline sources.

- [x] **Step 6: Decide the phase 1 durable usage sink**

Choose one of these before live approval:

```text
Option A: Wire existing apic_runtime.usage_rollups as the phase 1 durable sink for both gateway and shared-service usage.
Option B: Keep usage durable history out of phase 1, label usage views as Redis-windowed, and create separate phase 1.5 gateway_usage_rollups and shared_service_usage_rollups.
```

Expected: reliability, cost, chargeback, compliance, and operational-trust pages either use a verified durable sink or display Redis-windowed/degraded labels.

- [x] **Step 7: Run focused usage and Management contract tests**

Run from `C:\Codes\apic\api-center`:

```powershell
npm test -- --runInBand src/shared/proxy-handler.spec.ts src/analytics/gateway-traffic.service.spec.ts src/analytics/shared-service-usage.service.spec.ts src/analytics/analytics.controller.spec.ts src/analytics/audit-events.service.spec.ts
```

Run from `C:\Codes\apic\apicenter-management`:

```powershell
npm test -- --runInBand src/app/api/local/analytics/gateway-traffic/route.test.ts src/app/api/local/analytics/shared-service-usage/route.test.ts src/app/api/local/audit/events/route.test.ts
```

Expected: API Center records service-call observations consistently, and Management contract tests fail if source metadata is dropped.

## Task 12: Live Migration Dry Run

**Files:**
- Read: `C:\Codes\apic\api-center\supabase\migrations\<generated>_enterprise_control_plane_schemas.sql`

- [x] **Step 1: Verify Supabase CLI version and current docs**

```powershell
cd C:\Codes\apic\api-center
supabase --version
Invoke-WebRequest -UseBasicParsing https://supabase.com/changelog.md | Select-Object -ExpandProperty Content | Select-String -Pattern "breaking-change|db|migration|pooler|rls"
```

Verification recorded: local `supabase --version` is `2.105.0` after rerunning with elevated access because the CLI attempted to write telemetry under `C:\Users\anton\.supabase`. Current Supabase CLI docs were reviewed at `https://supabase.com/docs/reference/cli/introduction`; the docs list database dump/push/pull, migration list/new/repair/squash/up, and global flags such as `--workdir`, `--yes`, and output formats. Current Supabase changelog was reviewed at `https://supabase.com/changelog`; the relevant 2026-04-28 breaking change says new `public` tables are not automatically exposed to the Data/GraphQL APIs, so this plan keeps APIC control-plane schemas private and uses explicit app-role grants rather than relying on Data API exposure.

- [x] **Step 2A: Add redacted linked migration-list evidence wrapper**

Verification recorded: `node scripts/collect-supabase-migration-list-evidence.test.js` passed after preserving blank remote cells for local-only migrations and adding a direct DB fallback. `node -r dotenv/config scripts/collect-supabase-migration-list-evidence.js --run-linked --out docs/operations/supabase-migration-list-2026-06-26.json` regenerated a sanitized artifact with the linked migration-history gate ready. The regenerated packet now reports 16 of 16 gates ready.

- [x] **Step 2: List linked migrations**

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:list
```

Migration-list evidence artifact recorded: `docs/operations/supabase-migration-list-2026-06-26.json` was regenerated with `--run-linked`; `node scripts/collect-supabase-migration-list-evidence.test.js` passed. The artifact confirms Supabase CLI `2.105.0` supports `supabase migration list --linked` and `--local`, and records linked history: remote migrations `20260515000000`, `20260516000000`, `20260517000000`, and `20260519000000` are applied; later local migrations through `20260625162216` are not yet remote. The regenerated approval packet includes this artifact as the ready `migration_history` gate.

Current run note: linked migration listing now succeeds with the live linked project and records the remote/local split. The enterprise migration `20260625162216` remains local-only, as expected before approval.

- [x] **Step 3: Run dry-run**

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:push:dry
```

Expected: dry-run shows the enterprise migration and no unexpected destructive changes.

- [x] **Step 4: Run advisors when available**

```powershell
cd C:\Codes\apic\api-center
supabase db advisors
```

Expected: no critical security or performance advisor findings remain open. Current evidence: after revoking public execute on `public.rls_auto_enable()`, `supabase db advisors --linked` reports `No issues found`.

## Task 13: Live Migration Execution

**Files:**
- Modify live Supabase database only after explicit approval.

- [x] **Step 1: Create pre-migration backup**

```powershell
cd C:\Codes\apic\api-center
New-Item -ItemType Directory -Force -Path .\supabase\backups
supabase db dump --linked --schema api_center,api_center_ops,api_center_audit --file .\supabase\backups\2026-06-25-before-enterprise-control-plane.sql
```

- [x] **Step 2A: Add safe rollout evidence wrapper**

Verification recorded: `npm run db:safe-rollout:evidence:test` passed, and `npm run db:safe-rollout:evidence -- --out docs/operations/api-center-safe-rollout-2026-06-26.json` generated a sanitized artifact. The artifact verifies the expected pre-apply safe rollout values: `DATABASE_ENABLED=true`, `DATABASE_DUAL_WRITE=true`, `REGISTRY_SOURCE=redis`, and `REGISTRY_DUAL_WRITE=true`. The live deployment has since been cut over to `REGISTRY_SOURCE=postgres` after schema verifier and registry parity passed. The regenerated packet now reports 16 of 16 gates ready.

- [x] **Step 2: Put registry into safe rollout mode**

```text
DATABASE_ENABLED=true
DATABASE_DUAL_WRITE=true
REGISTRY_SOURCE=redis
REGISTRY_DUAL_WRITE=true
```

Expected: Redis remains the read source while Postgres schema migration is applied.

Safe rollout evidence artifact recorded: `docs/operations/api-center-safe-rollout-2026-06-26.json` was generated with `npm run db:safe-rollout:evidence -- --out docs/operations/api-center-safe-rollout-2026-06-26.json`; `npm run db:safe-rollout:evidence:test` passed. The artifact confirms safe rollout values from the gitignored `.env`: `DATABASE_ENABLED=true`, `DATABASE_DUAL_WRITE=true`, `REGISTRY_SOURCE=redis`, and `REGISTRY_DUAL_WRITE=true`. The approval packet includes this artifact as the ready `safe_rollout` gate.

- [x] **Step 3: Apply migration after approval**

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:push
```

- [x] **Step 4: Verify schema**

```powershell
cd C:\Codes\apic\api-center
npm run db:verify:control-plane
```

Expected: `APIC control-plane schema verification passed`.

- [x] **Step 5A: Add Redis/Postgres registry parity evidence wrapper**

Verification recorded: `npm run db:registry-parity:evidence:test` passed, and `node scripts/collect-registry-parity-evidence.js --out docs/operations/registry-parity-2026-06-26.json --fail-on-blockers` regenerated a sanitized artifact using the live API Center registry snapshot and direct Postgres projection. The artifact reports 22 API registry entries, 22 Postgres registry entries, zero missing rows, zero mismatches, `ready=true`, and no blockers. The regenerated packet now reports 16 of 16 gates ready.

Registry parity evidence artifact recorded: `docs/operations/registry-parity-2026-06-26.json`. The approval packet now includes this artifact as the ready `registry_parity` gate. The parity collector uses API Center's authenticated registry snapshot as the source-side comparison because the operator shell cannot reach private Redis directly.

- [x] **Step 5: Verify registry parity before source switch**

```powershell
cd C:\Codes\apic\api-center
npm run registry:verify
```

Expected: Redis and Postgres registry views match for services, environments, routes, scopes, dependencies, and secret references.

## Task 14: Deploy And Cut Over

**Files:**
- Modify deployment environment only after migration verification passes.

- [x] **Step 1: Deploy API Center build that uses new Prisma names**

Run the existing GKE build/deploy flow for API Center with the verified commit.

Expected: new API Center pods start without missing-table errors.

Verification recorded: built and deployed `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:supabase-registry-sourcefix-512551d-20260626075800`; GKE rollout completed, readiness returned HTTP 200, and registry readiness reports 22 services.

- [x] **Step 2: Keep Redis as registry source for first health check**

```text
REGISTRY_SOURCE=redis
DATABASE_DUAL_WRITE=true
```

- [x] **Step 3: Switch test environment to Postgres source**

```text
REGISTRY_SOURCE=postgres
DATABASE_DUAL_WRITE=true
```

Expected: readiness passes and registry endpoints return the same services as Redis.

Verification recorded: live API Center Secret Manager version 10 uses the least-privilege `api_center_app` DB URL with `REGISTRY_SOURCE=postgres`, `DATABASE_ENABLED=true`, `DATABASE_DUAL_WRITE=true`, and `REGISTRY_DUAL_WRITE=true`; readiness passed and registry parity passed with 22 of 22 entries matching Postgres.

- [x] **Step 4: Verify Management UI readiness**

```powershell
Invoke-RestMethod https://api-center-management-test.itsandbox.site/api/local/readiness
Invoke-RestMethod https://api-center-management-test.itsandbox.site/api/local/registry/services
```

Expected: readiness reports `ok=true`; registry endpoint succeeds and reports the expected service count.

## Task 15: Cleanup Compatibility Layer

**Files:**
- Create: `C:\Codes\apic\api-center\supabase\migrations\<generated>_drop_legacy_control_plane_views.sql`
- Modify: `C:\Codes\apic\api-center\docs\database-control-plane.md`

- [x] **Step 1: Wait one stable deployment**

Criteria: no running API Center or Management deployment queries `api_center`, `api_center_ops`, or `api_center_audit` directly for one release window.

Current readiness evidence: `docs/operations/compat-cleanup-readiness-2026-06-26.json` reports zero API Center or Management runtime legacy-schema references and ready supporting artifacts. The stability evidence artifact `docs/operations/compat-cleanup-stability-2026-06-26.json` uses Kubernetes deployment evidence from `docs/operations/compat-cleanup-k8s-2026-06-26.json` because API Center reports the placeholder `imageTag=local`; the live pods reached the required stable window before cleanup approval and apply.

Verification recorded: `npm run db:compat-cleanup:k8s`, `npm run db:compat-cleanup:stability`, and `npm run db:compat-cleanup:readiness` were regenerated after the live pods reached a 60-minute stable window; cleanup approval is recorded through `APICENTER_COMPATIBILITY_CLEANUP_APPROVED=true`.

- [x] **Step 2: Generate cleanup migration**

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:new -- drop_legacy_control_plane_views
```

Verification recorded: Supabase CLI generated `supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql`. The migration is local only and must not be pushed while Step 4 remains open.

- [x] **Step 3: Drop every compatibility view created in Task 3**

```sql
drop view if exists api_center_audit.audit_events;

drop view if exists api_center_ops.pipeline_feedback_actions;
drop view if exists api_center_ops.tribe_api_quota_decisions;
drop view if exists api_center_ops.usage_rollups;
drop view if exists api_center_ops.smoke_test_runs;
drop view if exists api_center_ops.health_snapshots;
drop view if exists api_center_ops.topic_onboarding_states;
drop view if exists api_center_ops.provisioning_jobs;
drop view if exists api_center_ops.tribe_plan_assignments;
drop view if exists api_center_ops.tribe_plan_definitions;
drop view if exists api_center_ops.tribe_api_quota_policies;
drop view if exists api_center_ops.approval_requests;
drop view if exists api_center_ops.service_registration_requests;

drop view if exists api_center.s3_sink_topics;
drop view if exists api_center.confluent_topics;
drop view if exists api_center.tribe_secret_refs;
drop view if exists api_center.service_lifecycle_events;
drop view if exists api_center.service_dependencies;
drop view if exists api_center.service_scopes;
drop view if exists api_center.service_routes;
drop view if exists api_center.service_environments;
drop view if exists api_center.services;
drop view if exists api_center.organizations;
```

Verification recorded: `npm run db:compat-cleanup:migration-static:test` and `npm run db:compat-cleanup:migration-static` passed. The static verifier requires every expected `drop view if exists` statement plus empty legacy schema drops for `api_center_audit`, `api_center_ops`, and `api_center`; it rejects cascade and non-view destructive DDL.

- [x] **Step 4: Dry-run and apply after approval**

```powershell
cd C:\Codes\apic\api-center
npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-2026-06-26.json
npm run db:compat-cleanup:command-packet -- --out docs/operations/compat-cleanup-command-packet-2026-06-26.json --md-out docs/operations/compat-cleanup-command-packet-2026-06-26.md
npm run db:migration:push:dry
```

Expected: dry-run only drops legacy compatibility views.

Verification recorded: `npm run db:migration:push:dry` reported exactly one pending cleanup migration, `npm run db:migration:push` applied `20260626002247_drop_legacy_control_plane_views.sql`, and the live post-apply schema check found no remaining `api_center`, `api_center_ops`, or `api_center_audit` schemas. `npm run db:verifier:evidence -- --post-compat-cleanup --out docs/operations/supabase-verifier-readiness-2026-06-26.json` passed with live modes `base`, `legacy_schemas_absent`, and `retention_policy`; refreshed readiness and command packet artifacts are ready with zero blockers.

## Rollback Strategy

Fast rollback, preferred:

```text
REGISTRY_SOURCE=redis
DATABASE_DUAL_WRITE=false
Deploy previous API Center image tag
Keep new schemas in place
```

Use this when app code has trouble but the migration applied cleanly.

Database rollback, last resort:

```text
Stop writes
Restore Supabase backup
Redeploy previous API Center image tag
Set REGISTRY_SOURCE=redis
Re-run readiness and registry checks
```

Use this only if data is corrupted or DDL left the database unusable.

## Final Verification Checklist

- [x] Supabase dry-run reviewed.
- [x] Supabase advisors reviewed or documented as unavailable.
- [x] Backup exists and restore path is known.
- [x] `apic_catalog`, `apic_governance`, `apic_runtime`, and `apic_audit` exist.
- [x] Required tables exist in target schemas.
- [x] Renamed indexes and constraints use enterprise names; legacy names are rejected by the verifier.
- [x] Explicit app roles and default privileges are applied; generated DDL contains no runtime role-discovery logic.
- [x] Retention policy comments, partitions, or approved low-volume exceptions exist for high-volume tables.
- [x] FK columns have explicit indexes.

Live evidence recorded: the enterprise migration SQL has derived FK-index coverage, the static verifier fails on any missing FK leading index, and `docs/operations/supabase-verifier-readiness-2026-06-26.json` proves the applied live database has the expected indexes.
- [x] Status columns have check constraints.

Live evidence recorded: `apic_runtime.pipeline_feedback_actions.status` now has `pipeline_feedback_actions_status_check`, `npm run db:verify:enterprise-static:test` fails when a required or future `status` column lacks an inline check constraint, and the live verifier proves the applied target database has the same constraints.
- [x] Audit table denies deletes to the app role.

Live evidence recorded: `npm run db:verify:enterprise-static:test` fails when the audit delete denial is missing, and the live verifier proves the applied target database denies deletes to the discovered app role.
- [x] Control-plane schemas are not exposed to Supabase Data API.

Live evidence recorded: `npm run db:verify:enterprise-static:test` fails if `supabase/config.toml` exposes `apic_*` schemas or if migration DDL grants private APIC schemas to `anon`/`authenticated`; the live verifier also proves no direct `anon`/`authenticated` grants exist on private APIC tables.
- [x] Prisma client generation passes.

Verification recorded: `npm run db:generate` passed after clearing dead proxy environment variables and rerunning with network access.

- [x] Focused tests pass.

Verification recorded: focused registry/quota/approval/governance tests passed for 12 suites and 68 tests; full API Center unit tests passed for 114 suites and 524 tests.

- [x] Build passes.

Verification recorded: `npm run build` passed after rerunning with escalated filesystem access because the first run hit Windows `EPERM` while unlinking `dist/app.module.js.map`.
- [x] Registry parity passes.
- [x] API Center readiness passes.
- [x] Management readiness passes.
- [x] Management source-backed matrix reviewed and degraded/unavailable sources labeled.

Verification recorded: Management source-aware route/schema contract tests passed with `npm test -- scripts/smoke-routes.test.mjs src/lib/schemas/operations.test.ts src/lib/schemas/data-pipeline.test.ts src/app/api/local/analytics/gateway-traffic/route.test.ts src/app/api/local/analytics/shared-service-usage/route.test.ts src/app/api/local/audit/events/route.test.ts src/app/api/local/compliance/export/route.test.ts src/app/api/local/operations/lifecycle/route.test.ts` for 8 files and 20 tests; the smoke route contract includes source metadata JSON path checks for gateway traffic, shared-service usage, audit, compliance export, promotion evidence, and data-pipeline health/quality.
- [x] Management source freshness metadata exists for mixed durable, volatile, external, computed, and unavailable sources.

Verification recorded: Management schema tests preserve durable Postgres audit metadata, Redis-windowed volatile usage metadata, Athena external pipeline metadata, and fixture/local degraded metadata; `managementSourceMetadataSchema` accepts the full contract shape including unavailable/computed types, degraded reason, evidence table, and correlation id.
- [x] API Center upstream endpoints emit source metadata before Management validates or displays it.

Verification recorded: API Center analytics, compliance, promotion, data-pipeline, and audit source-metadata tests passed with the pre-live source-metadata command recorded above; Management local analytics/audit route tests preserved upstream source metadata.
- [x] Normalized service-call recording contract is tested for API service calls, shared-service calls, failed calls, quota-blocked calls, and unknown-caller fallback.

Verification recorded: API Center proxy, usage, analytics, and audit tests plus Management local analytics/audit route tests passed with the pre-live normalized service-call command recorded above.
- [x] Sync/async decision matrix reviewed and no request-time path depends on nonessential Postgres writes.

Verification recorded: `docs/database-control-plane.md` contains the Sync Vs Async Workflow Ownership matrix; normalized proxy/usage tests passed, and the matrix explicitly keeps gateway/shared-service usage counters as async rollups using Redis hot counters and future durable writers.
- [x] Gateway config publish contract documented before future `apic_gateway` DDL.

Verification recorded: `docs/database-control-plane.md` contains the Gateway Config Publish Contract, and the API Center phase 1 migration SQL does not create `apic_gateway` DDL.
- [x] Shared Services platform execution track documented before future `shared_core` DDL.

Verification recorded: `api-shared-services/docs/shared-services-platform-control-plane-plan.md` documents Shared Services ownership, future `shared_core` scope, migration authority, dry run, no-touch diff, backup/rollback, and Management degraded-state behavior before any API Center `shared_core` DDL.
- [x] Shared Services migration authority is documented and existing `shared_*` provider schemas have a no-touch diff.

Verification recorded: the Shared Services platform plan documents that Supabase SQL migrations in `api-shared-services` are canonical for shared-service schemas; `rg` against API Center phase 1 migration SQL found no `create table shared_*`, `alter table shared_*`, `drop table shared_*`, or `shared_core` DDL.
- [x] Evidence capture triggers reviewed before compliance exports are called audit-ready.

Verification recorded: focused evidence trigger tests passed with `npm test -- --runInBand src/compliance/compliance-export.controller.spec.ts src/operations/promotion-evidence-bundle.controller.spec.ts src/gateway-control-plane/gateway-config-publish-evidence.service.spec.ts src/registry/registry.controller.spec.ts src/registry/registration-requests.controller.spec.ts src/quotas/tribe-quota-admin.controller.spec.ts src/quotas/tribe-quota-enforcer.service.spec.ts src/secrets/tribe-secret-rotation.service.spec.ts src/shared-services/payment-webhook.controller.spec.ts src/analytics/audit-events.service.spec.ts src/data-pipeline/event-schema-registry.service.spec.ts` for 11 suites and 52 tests.
- [x] Promotion evidence and compliance exports do not depend on in-memory evidence bundles for audit-ready claims.

Verification recorded: compliance export tests assert source metadata distinguishes durable audit rows from volatile `promotion-evidence-memory-bundles`; the plan records `promotion_evidence_bundles` as `phase_1_5` and a blocker only if compliance export is marketed as audit-ready at cutover.
- [x] Gateway/shared-service rollup durability decision recorded before reliability, cost, or compliance claims use those metrics.

Verification recorded: `docs/database-control-plane.md` records Option B: keep usage durable history out of phase 1, label usage views Redis-windowed/degraded, and create phase 1.5 `gateway_usage_rollups` and `shared_service_usage_rollups` before reliability, cost, chargeback, compliance, or operational-trust history depends on those metrics.
- [x] Event schema governance durability decision recorded before production schema validation depends on registry state.

Verification recorded: the plan records `event_schema_versions` as `phase_1_5`, blocker only if prod validation reads API Center schema registry state, and `event_schema_validations` as future until validation history is needed; event schema registry tests passed in the focused evidence command.
- [x] Live logs show no missing-table errors.

Missing-table log evidence artifact recorded: `docs/operations/missing-table-log-scan-2026-06-26.json` was generated from current GKE API Center logs; it scanned for Postgres `42P01`/`UndefinedTable`, Prisma `P2021`, and generic missing-table patterns while redacting secrets, and reports `ready=true`.
- [x] Compliance export smoke passes against API Center or Management and proves durable audit source metadata.

Compliance export smoke evidence artifact recorded: `docs/operations/compliance-export-smoke-2026-06-26.json` was generated against live API Center `/api/v1/admin/compliance/export`; it redacts admin credentials, requires source metadata, and proves durable audit source metadata from `apic_audit.audit_events`.
- [x] Post-cutover logs show no audit dual-write failures, Prisma query errors, or Postgres connection/query errors.

Post-cutover error log evidence artifact recorded: `docs/operations/postcutover-error-log-scan-2026-06-26.json` was generated from current GKE API Center logs; it scans for audit dual-write failures, Prisma request/query errors, and Postgres connection/query error patterns while redacting secrets, and reports `ready=true`.
- [x] Rollback config and previous image tag are recorded.

## Self-Review

- Spec coverage: This plan covers schema naming, migration source of truth, live migration gates, compatibility behavior, app code references, security, verification, rollback, cleanup, approved Gateway/shared-core bounded contexts, Management source-backed features, sync/async workflow ownership, source freshness metadata, normalized service-call recording, gateway config publishing, Shared Services execution tracking, explicit role grants, index/constraint normalization, retention/partition launch policy, evidence capture triggers, and durable evidence/rollup gaps.
- Placeholder scan: The plan intentionally avoids unknown migration filenames because Supabase CLI must generate the timestamped names.
- Type consistency: Target names are consistent across schema map, Prisma model names, raw SQL updates, verification script, and live checks.
- Scope check: This plan is focused on API Center control-plane database migration. Gateway and shared-core tables are documented as approved future contexts; durable Management evidence tables are tracked with phase decisions; the phase 1 live migration still preserves `shared_*` ownership and does not create future schemas unless explicitly promoted to phase_1_blocker.

---

## Whole-Codebase Review Addendum

This addendum comes from reviewing the API Center backend, Management UI routes, and Shared Services database usage. It corrects the migration scope before any live Supabase changes are approved.

### Critical Corrections Before Live Migration

1. **Fix registry foreign-key typing before any DDL is generated.**
   Current Prisma uses `Service.id` as a UUID primary key and `Service.serviceId` as the stable external service identifier. Any replacement DDL must not define `service_environments.service_id text references apic_catalog.services(id)`. Either keep `service_id uuid references apic_catalog.services(id)` or intentionally reference `services.service_id` through a named unique key and use a clearer column name such as `service_key`.

2. **Verify durable audit before cutover.**
   `AuditEventsService` now dual-writes to `apic_audit.audit_events` when `DATABASE_ENABLED=true`, while Redis remains the recent-event cache/fallback and the interceptor still emits Kafka audit messages. Live cutover must verify Postgres audit writes and reads before compliance, reliability, or operational-trust views treat Supabase as the durable audit source.

3. **Keep mutable governance/runtime writes behind Prisma models.**
   Registration requests, pipeline feedback actions, and topic onboarding state now use Prisma models instead of schema-qualified raw SQL. Future schema movement should happen through Prisma mapping changes, not scattered SQL strings.

4. **Do not rename provider-specific runtime tables in phase 1.**
   The code and docs are currently Confluent/S3 specific. Keep `confluent_topics` and `s3_sink_topics` as provider-specific tables under `apic_runtime` for the live migration. Add provider-neutral views later only after the product supports multiple event or sink providers.

5. **Compatibility must cover every moved table, or the migration needs a maintenance window.**
   Four compatibility views are not enough. Every table read by Prisma or raw SQL needs a compatibility strategy: registry tables, service environments/routes/scopes/dependencies/lifecycle events, secret refs, topics, sink topics, provisioning jobs, registration requests, pipeline feedback actions, topic onboarding state, quota policies/decisions, plan definitions/assignments, approval requests, health snapshots, smoke test runs, usage rollups, and audit events if Postgres-backed audit is added.

6. **Make promotion evidence durable before compliance depends on it.**
   Promotion evidence bundles are currently composed on demand and retained in process memory. Compliance exports and operational-trust views must use durable evidence snapshots or clearly mark promotion evidence as non-durable.

7. **Do not treat Redis-only usage as historical reliability or cost evidence.**
   Gateway and shared-service counters can stay hot-path optimized in Redis, but reliability, cost, scorecard, and compliance views need durable rollups or explicit degraded-state labels.

8. **Add event schema governance to the durable model.**
   Event schema versions, compatibility mode, approval status, steward, and validation decisions need a durable source before prod event governance depends on them.


9. **Make sync versus async behavior explicit per workflow.**
   Auth, route lookup, policy admission, idempotency reservation, provider result calls, and webhook receipt are request-time concerns. Audit rollups, evidence snapshots, provider reconciliation, alerts, reliability, cost, and pipeline analytics are background concerns unless the workflow explicitly requires transactional audit.

10. **Add Management source freshness metadata.**
   Management must not collapse durable, Redis-windowed, Athena, provider, computed, and unavailable sources into the same display contract. Each mixed-source response needs source type, durability, last refresh, window, stale threshold, degraded reason, and evidence table where applicable.

11. **Define gateway config publishing before creating gateway tables.**
   Future `apic_gateway` work needs versioned publish snapshots, checksums, active instance reporting, drift detection, and rollback-by-version before it becomes a runtime control plane.

12. **Give Shared Services its own execution track.**
   Protecting `shared_*` from API Center migration is necessary but not enough long term. The shared-service platform needs a separate `api-shared-services` plan for `shared_core`, entitlements, provider refs, idempotency, webhooks, outbox, usage rollups, and reconciliation.

13. **Capture evidence at workflow milestones, not at export time.**
   Compliance export should read durable evidence produced by approvals, quota changes, secret rotations, promotion gates, gateway config publishes, shared-service webhooks, and retirement workflows. Missing evidence must make the export incomplete or degraded.


14. **Normalize renamed index and constraint names.**
   Moving a table to a new schema and renaming it does not rename its existing indexes or constraints. The migration must explicitly rename or recreate enterprise-named objects so verification is deterministic.

15. **Use explicit app roles in grant DDL.**
   Role discovery belongs in Task 1, not inside the live migration. The generated migration must grant to exact discovered role names, set default privileges, and fail review if it contains role-candidate discovery logic.

16. **Turn retention and partitioning into executable launch policy.**
   High-volume tables need retention comments, partition DDL, or written low-volume exceptions before live approval. The verifier must check retention metadata, not only table existence.

17. **Emit source freshness from API Center, not only Management.**
   Management cannot honestly label durability if API Center upstream endpoints return opaque data. API Center analytics, compliance, promotion, and data-pipeline responses must emit source metadata first.

18. **Give Shared Services its own migration authority and no-touch diff.**
   Future `shared_core` work must be owned by `api-shared-services`, use its own canonical Supabase SQL migration path, keep Prisma schema synchronized, and prove existing `shared_*` provider schemas are unchanged by API Center phase 1.

### Things We Do Not Need To Add Now

- Standalone API catalog or marketplace tables. `ApiProductService` currently projects products from registry data.
- A persisted runtime dependency-map table. `RuntimeDependencyMapService` computes this from registry services and topics.
- Separate persisted lifecycle/evidence bundle tables in phase 1. The current lifecycle and promotion evidence endpoints compose existing registry, quota, plan, approval, and pipeline-health sources.
- Shared Services provider-table rewrites. `shared_*` schemas belong to shared services, especially PayMongo runtime data, and must be left untouched by this migration. The approved future `shared_core` schema is additive and should be planned separately.
- Raw gateway request storage in Postgres. Gateway traffic and shared-service usage are currently Redis/windowed counters. Add durable gateway rollups in `apic_gateway` only when billing, reliability, compliance, or trend reporting requires them.
- Database storage for provider secrets. Store only references, ownership, rotation state, and approval/audit history.
- UI-only Management state. The Management app should remain a consumer of API Center state, not a second persistence layer.
- Gateway and shared-core future tables in the phase 1 live migration. `apic_gateway` and `shared_core` are approved long-term bounded contexts, but they should not block the immediate control-plane schema cutover.

### Former Missing Items Status

This table tracks the earlier "Things Missing From The Plan" list item by item. Items marked `Covered` are represented in code, the plan, or both. Items marked `Pre-live required` still need live Supabase inventory or generated migration SQL before approval.

| Former missing item | Status | Where it is handled |
| --- | --- | --- |
| Durable audit tracking path | Covered, pre-live retention required | `AuditEventsService` dual-writes to `apic_audit.audit_events` when `DATABASE_ENABLED=true`. The live migration still needs partition/retention DDL and cutover verification. |
| Developer Portal quota-increase flow | Covered | `quota.increase` is listed as a required approval action and must be smoke-tested through Developer Portal before cutover. |
| Compliance export use case | Covered, durable evidence required | Compliance is tied to durable audit plus promotion evidence. Add durable promotion evidence bundles/evidence snapshots before exports are audit-ready. |
| Reliability and operational trust use cases | Covered, durable rollups required | The use-case gate includes registry, quotas, audit, health, smoke tests, and usage data; gateway/shared-service usage must be durable before historical reliability claims. |
| Promotion evidence use case | Covered, durable evidence required | The plan requires approval, health, quota, plan, and pipeline evidence to be queryable by service/environment; promotion evidence bundles must not remain in-memory for audit-ready use. |
| Secret lifecycle use case | Covered | The plan tracks secret references, rotation approvals, emergency rotation, and audit history without storing secret material. |
| Deprecation and retirement use case | Covered | Lifecycle events and approval history remain tied to services and service environments. |
| Policy-engine/evaluation tracking | Covered | Policy changes and enforcement actions require durable approval/audit history; computed decisions do not need separate duplicated tables unless retained as evaluations. |
| High-volume retention strategy | Pre-live required | The plan requires concrete partition/retention settings for `audit_events`, `tribe_api_quota_decisions`, `usage_rollups`, and future durable rollups before launch. |
| Cross-repo preflight | Covered, Control Tower removed | API Center tests/build, Management contract/build checks, and Shared Services no-touch dry run remain. Control Tower is intentionally removed from this API Center migration plan. |
| Actual role discovery | Pre-live required | The plan requires discovering the real app role/grants before using `api_center_app` or any equivalent role in DDL. |

### Remaining Pre-Live Inputs

These are not codebase-discovery gaps. They are live-environment facts that must be collected before approval because they depend on the actual Supabase project state.

- Live Supabase inventory: current schemas, tables, indexes, constraints, policies, extensions, publications, grants, and row counts.
- Supabase CLI/docs validation: current CLI version, migration command behavior, advisor availability, and any relevant Supabase changelog items before generating final migration SQL.
- Exact migration artifacts: generated migration filename from `supabase migration new`, final DDL, rollback SQL, data backfill SQL, and view/compatibility SQL.
- Actual app roles and grants: discover the real database role used by API Center instead of assuming `api_center_app`.
- Compatibility decision per table: for every moved table, choose compatibility view, coordinated app deploy, or maintenance-window cutover. Renamed writable views may require `INSTEAD OF` triggers, so avoid renames unless they are worth that cost.
- Retention and partition policy: concrete partitioning/retention settings for `audit_events`, `tribe_api_quota_decisions`, `usage_rollups`, and any future durable analytics rollups.
- Data parity baseline: pre-migration and post-migration counts/checksums for zero-row and non-zero-row tables.
- Management app contract check: confirm every Management route still works against the new API behavior and schema-backed responses.
- Shared Services no-touch check: confirm `shared_*` schemas and PayMongo runtime data are untouched by API Center migrations.
- Cutover values: previous image tag, new image tag, old/new `DATABASE_URL`, feature flags, rollback command, and exact cutover window.
- Post-cutover monitoring: missing-table log scan, failed audit-write alerts, Prisma query errors, readiness checks, and compliance export smoke test.
- Live operator command packet: `docs/operations/supabase-live-command-packet-2026-06-26.md` orders the current approval blockers into target confirmation, pre-approval evidence, safe rollout/readiness, approval checkpoint, apply/cutover, and post-cutover monitoring phases.

### Phase 1 Source-Of-Truth Classification

| Category | Phase 1 Source | Notes |
| --- | --- | --- |
| Registry catalog | Supabase Postgres | Organizations, services, environments, routes, scopes, dependencies, lifecycle events. |
| Governance requests | Supabase Postgres | Registration requests, approvals, quota policy changes, plan changes. |
| Runtime provisioning | Supabase Postgres | Provisioning jobs, topic onboarding state, pipeline feedback actions. |
| Provider-specific runtime assets | Supabase Postgres | Keep `confluent_topics` and `s3_sink_topics` names in phase 1. |
| Audit/compliance | Supabase Postgres plus Kafka | Requires explicit dual-write before it is considered durable. |
| Promotion evidence packets | Future `apic_governance.promotion_evidence_bundles` plus `apic_audit.evidence_snapshots` | Required before compliance exports treat promotion evidence as durable. |
| Event schema governance | Future `apic_governance.event_schema_versions` plus optional runtime validations | Required before prod event-schema decisions depend on API Center registry state. |
| Pipeline decision signals | Future `apic_runtime.pipeline_decision_signals` and `apic_runtime.pipeline_query_runs` | Required before Management decision signals are considered source-backed instead of Athena/fixture-backed. |
| Gateway traffic counters | Redis/windowed cache for hot path; durable rollups required for history | Do not store raw per-request logs by default. Persist `gateway_usage_rollups` before using gateway history for reliability, cost, or compliance. |
| Shared service usage counters | Redis/windowed cache for hot path; durable rollups required for history | Shared provider records remain in `shared_*`. Persist `shared_service_usage_rollups` before chargeback, trend reporting, or compliance usage. |
| Marketplace/catalog products | Computed projection | Derived from registry and governance state. |
| Dependency maps | Computed projection | Derived from registry and event-topic relationships. |
| Forecasting/cost views | Computed or external evidence | Persist only final rollups if the product needs historical trend analysis. |
| Gateway control plane | Phase 1.5 `apic_gateway` schema plus gateway-native hot path | Service-ready source for gateway routes, route versions, consumers, client apps, subscriptions, credential references, policy bindings, config publish snapshots, and durable rollups. |
| Shared-service platform controls | Phase 1.5 `shared_core` schema | Service-ready source for shared-service integrations, entitlements, provider account refs, provider secret refs, usage rollups, idempotency keys, webhook envelopes, and outbox events. |

### Required Pre-Live Review Gates

- DDL gate: generated migrations use lower `snake_case`, correct UUID/text FK types, named constraints, indexed foreign keys, and no invalid `ADD CONSTRAINT IF NOT EXISTS` syntax.
- Data gate: dry-run row counts match for every moved table, including zero-row tables.
- Compatibility gate: every legacy schema/table reference has a working view, synonym strategy, or coordinated code deploy.
- Audit gate: compliance exports can retrieve durable audit history beyond the Redis window.
- Use-case gate: registry, requests, approvals, quotas, plans, developer portal, lifecycle evidence, compliance export, reliability, promotions, data pipeline, and secret rotation workflows are smoke-tested.
- Management gate: every Management route has a durable, external, volatile, or unavailable source label; no UI treats volatile evidence as durable.
- Evidence gate: promotion evidence bundles, compliance snapshots, event schema governance, pipeline signals, gateway rollups, and shared-service rollups have explicit launch-phase decisions.
- Usage durability gate: proxy calls are recorded in metrics/Redis/audit today, but reliability, cost, chargeback, and compliance claims must use durable rollups only after `usage_rollups`, `gateway_usage_rollups`, or `shared_service_usage_rollups` writes are implemented and verified.
- Bounded-context gate: Shared Services schemas are verified as untouched.
- Modular-monolith gate: `npm run check:boundaries` passes and every schema has one owning bounded context.
- Phase 1.5 planning gate: `apic_gateway` and `shared_core` get separate module ownership, migrations, grants, retention policies, API contracts, release gates, and smoke tests after the phase 1 control-plane cutover is stable.
- Rollback gate: rollback scripts, restore point, old app image, and old environment variables are ready before migration starts.
