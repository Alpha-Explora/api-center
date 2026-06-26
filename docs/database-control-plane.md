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

The enterprise control-plane migration uses explicit owner schemas so future service extraction can be done by bounded context instead of by table-by-table cleanup.

| Schema | Owner context | Purpose |
| --- | --- | --- |
| `apic_catalog` | Catalog and registry | Durable registry records, environments, service routes, scopes, dependencies, shared-service links, and service secret references |
| `apic_governance` | Governance | Approval requests, lifecycle governance, policies, plans, entitlements, quota policies, secret rotation workflow state, and event schema versions |
| `apic_runtime` | Runtime operations | Health snapshots, smoke-test runs, quota evaluations, gateway/shared-service rollups, pipeline feedback actions, decision signals, and query-run provenance |
| `apic_audit` | Audit and evidence | Append-only audit events and durable evidence snapshots for compliance and promotion records |
| `apic_gateway` | Future gateway control plane | Future routes, consumers, subscriptions, policy bindings, credential refs, config publish snapshots, and gateway rollups |

Secrets stay in GCP Secret Manager or the approved secret provider. Postgres stores only references and metadata, such as `api-center-tribe-secret-<tribe-id>`.

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


## Enterprise Schema Migration Source Of Truth

Supabase SQL migrations in `api-center/supabase/migrations` are the canonical live database history for API Center control-plane schemas. Prisma migrations are retained as application-client history only and must not be used as a competing live migration authority.

The enterprise owner schemas are:

| Schema | Purpose |
| --- | --- |
| `apic_catalog` | Service catalog, environments, routes, scopes, dependencies, lifecycle events, and secret references. |
| `apic_governance` | Human or policy workflow state: registry change requests, approvals, quota policies, entitlement plans, and assignments. |
| `apic_runtime` | Operational observations and derived runtime state: provisioning jobs, topic onboarding, Confluent/S3 state, health, smoke tests, usage rollups, quota evaluations, and pipeline feedback actions. |
| `apic_audit` | Append-only audit evidence. |

The legacy `api_center`, `api_center_ops`, and `api_center_audit` names are compatibility-view names only during the migration window. New code should use the enterprise schemas and the verifier must reject legacy index or constraint names after normalization.

### Compatibility View Cleanup

The generated cleanup migration is `supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql`. It drops only the legacy compatibility views and must not be pushed to the linked Supabase project until the cleanup-readiness gate is ready.

Required local checks before approval:

```powershell
cd C:\Codes\apic\api-center
npm run db:compat-cleanup:stability -- --out docs/operations/compat-cleanup-stability-2026-06-26.json
npm run db:compat-cleanup:readiness -- --out docs/operations/compat-cleanup-readiness-2026-06-26.json --fail-on-blockers
npm run db:compat-cleanup:migration-static
npm run db:compat-cleanup:command-packet -- --out docs/operations/compat-cleanup-command-packet-2026-06-26.json --md-out docs/operations/compat-cleanup-command-packet-2026-06-26.md
```

The stability gate requires `APICENTER_COMPATIBILITY_CLEANUP_WINDOW_STARTED_AT`, `APICENTER_COMPATIBILITY_CLEANUP_DEPLOYMENT_REVISION`, and either `APICENTER_COMPATIBILITY_CLEANUP_WINDOW_ENDED_AT` or the collector run time after the window completes. It can infer the window from readiness uptime only when the readiness artifact includes a non-placeholder API Center image tag and a Management deployment id. A live `imageTag` of `local` is intentionally rejected as insufficient deployment identity. The readiness gate must confirm one stable deployment window, explicit cleanup approval, zero API Center or Management runtime legacy-schema references, ready post-cutover log scans, ready verifier evidence, and a static-clean drop-view migration. The cleanup command packet must remain blocked until that readiness artifact is ready. After that, run `npm run db:migration:push:dry` and review that the dry run only drops the compatibility views before any live push.

Future migration sequence:

1. Create a migration with `npm run db:migration:new -- <descriptive_name>`.
2. Write schema changes in Supabase SQL under `supabase/migrations`.
3. Update Prisma schema/client mappings after SQL is reviewed.
4. Run `npm run db:verify:control-plane -- --app-role <discovered-app-role>` against the target database.
5. Run compatibility and retention variants when the migration depends on them:
   `npm run db:verify:control-plane -- --app-role <discovered-app-role> --require-compat-views`
   `npm run db:verify:control-plane -- --app-role <discovered-app-role> --require-retention-policy`
6. Only then run `npm run db:migration:push:dry` and request approval for the live push.

Shared-service provider schemas remain owned by `api-shared-services`. API Center migrations must not create or alter `shared_core` or existing `shared_*` provider tables without a Shared Services-owned migration plan and no-touch diff.

## Access And RLS Stance

APIC control-plane schemas are private server-side schemas. Browser clients do not query them directly through the Supabase Data API, and `supabase/config.toml` exposes only `public` and `graphql_public` through `[api].schemas`.

The enterprise migration revokes broad `public` access from `apic_catalog`, `apic_governance`, `apic_runtime`, and `apic_audit`. If any APIC control-plane table is later exposed to `anon` or `authenticated`, RLS must be enabled first with owner/environment predicates and indexes on the policy columns. Views used for one-release compatibility are created with `security_invoker = true` and remain server-side compatibility objects, not browser-facing APIs.

## Phase 1 Retention And Partitioning Policy

| Table | Minimum retention | Partition decision before live | Reason |
| --- | --- | --- | --- |
| `apic_audit.audit_events` | 400 days | Monthly partition required before audit-ready compliance claims; low-volume exception allowed only with written approval | Compliance and investigation evidence |
| `apic_runtime.quota_evaluations` | 180 days | Monthly partition required before enforced quota traffic is high-volume; low-volume observe-mode exception allowed with row-count threshold | Quota history and appeals |
| `apic_runtime.usage_rollups` | 400 days | Monthly partition or rollup-only table accepted; raw per-request storage is not allowed | Reliability, cost, and chargeback history |
| `apic_runtime.health_snapshots` | 90 days | No partition required unless row-count forecast exceeds 1 million rows in 90 days | Operational readiness trend |
| `apic_runtime.smoke_test_runs` | 180 days | No partition required unless row-count forecast exceeds 1 million rows in 180 days | Promotion and readiness evidence |
| `apic_runtime.pipeline_feedback_actions` | 365 days | No partition required in phase 1; revisit when automated feedback volume exceeds 100k rows/month | Pipeline decision audit |

The phase 1 migration records these decisions as machine-checkable table comments. If the table is not partitioned, the comment must include a `retention=` marker and the approved exception or row-count threshold. The app runtime role must not delete audit rows. Purge or archive jobs must run under a separately approved retention-maintainer role, exclude legal-hold or compliance-lock records, and name the first review date before live approval.

## Retention Maintenance Ownership

Retention purge or archive jobs must run under a separately approved `apic_retention_maintainer`-style role, not the API Center runtime app role. The live migration approval must name the real maintainer role, first review date, legal-hold/compliance-lock exclusion rule, dry-run query, and rollback behavior before any purge job is enabled.

## Phase 1 Usage Durability Decision

Gateway and shared-service usage remain Redis-windowed during the phase 1 control-plane schema cutover. API Center records normalized service-call observations through metrics, Redis/in-memory counters, and audit events, but Management must not treat usage history as durable Supabase evidence until the async rollup writer exists and is verified.

Decision: use separate phase 1.5 durable rollups instead of wiring `apic_runtime.usage_rollups` as the phase 1 sink.

- `gateway_usage_rollups` will store durable gateway request, latency, error, quota, and denial counters by route, consumer/caller, service, environment, window, outcome, and rollup key.
- `shared_service_usage_rollups` will store durable shared-service usage by caller, shared service, provider, operation, environment, window, outcome, and rollup key.
- The phase 1 migration may keep or move the legacy `usage_rollups` table for compatibility, but it is not the source of truth for gateway/shared-service history until a replayable writer, retention policy, and route/API contract tests are added.
- Reliability, cost, chargeback, compliance, and operational-trust views must show Redis-windowed or degraded labels until those durable rollups are live.

## Modular Monolith Boundary Rules

API Center stays a modular monolith until a bounded context proves it needs independent scaling, deployment, ownership, security isolation, or failure isolation. Microservice readiness is achieved by enforcing module and schema boundaries now, while keeping one deployable until the product boundaries are stable.

| Bounded context | Owner module paths | Owner schema or store | Allowed access path | Future extraction trigger |
| --- | --- | --- | --- | --- |
| Catalog and registry | `src/registry`, `src/catalog` | `apic_catalog`, Redis registry cache | Public registry module/service contracts, API contracts, read models, or events | Independent catalog ownership, high write volume, or gateway config publishing needs separate release control |
| Governance | `src/approvals`, `src/quotas`, `src/entitlements`, `src/developer-portal`, `src/policy` | `apic_governance` | Public governance services, approval APIs, quota/entitlement APIs, policy contracts, or events | Approval/policy workflow needs independent release, compliance ownership, or security isolation |
| Runtime operations | `src/analytics`, `src/health`, `src/forecasting`, selected `src/operations` | `apic_runtime`, Redis windows, telemetry | Runtime operations services, source metadata contracts, rollup APIs, or events | Rollup/telemetry volume needs independent scaling or replay workers |
| Audit and evidence | `src/compliance`, audit analytics services, promotion evidence contracts | `apic_audit`, future evidence tables | Audit append APIs, evidence snapshot APIs, compliance export APIs, or immutable events | Audit retention, legal hold, or compliance export requires separate trust boundary |
| Data-pipeline governance | `src/data-pipeline`, `src/kafka-governance` | `apic_governance`, `apic_runtime`, Athena evidence | Schema governance APIs, topic onboarding APIs, decision-signal events, or read models | Data pipeline operations need independent steward ownership or cloud-data-plane scaling |
| Gateway control plane | Future `src/gateway-control-plane`, current gateway/proxy contracts | `apic_gateway`, gateway-native config cache | Versioned gateway config publish contracts and runtime read-only snapshots | Runtime gateway config needs independent deployment, rollback, or multi-gateway distribution |
| Shared-service platform | `src/shared-services`, external `api-shared-services` contracts | Existing `shared_*`, future `shared_core` | Shared-service APIs, usage rollup contracts, and no-touch provider table boundaries | Shared services need independent product ownership, provider isolation, or scale separate from API Center |
| Auth and identity | `src/auth`, `src/secrets` | Secret provider, Redis token/session state, secret reference tables | Auth module APIs, guard contracts, secret reference APIs, and audit events | Identity/security isolation or dedicated credential operations require separate release authority |
| Shared kernel | `src/shared`, `src/config`, `src/database`, `src/metrics` | No business schema ownership | Infrastructure utilities only | Extract as libraries only; never as a business microservice |

Boundary gate rules:

- A bounded context may write only its owner schema unless the write is performed through another context's public service contract or an explicit outbox/event contract.
- Cross-context imports are limited to modules, DTOs, types, documented read models, event contracts, and explicitly allowlisted public service contracts.
- Direct imports of another context's repositories, controllers, or internal service files are forbidden for new code.
- Schema-qualified raw SQL against another context's owner schema is forbidden for production source code.
- Every new `apic_*` or `shared_core` Prisma schema mapping must have exactly one bounded-context owner.

Before any bounded context is split into a microservice, confirm this extraction checklist:

- Owner schema and grants are isolated.
- Public API contract is versioned and tested.
- Event contract or outbox contract is versioned and tested.
- Management route smoke covers degraded and unavailable states.
- Observability, alerts, rollback, and replay behavior are documented.
- No other bounded context depends on private tables or private classes.

Run `npm run check:boundaries` before live migration approval and before any service-extraction work.

## Management Source-Backed Feature Matrix

APICenter Management remains a consumer of API Center, Gateway, and Shared Services APIs. A Management feature is enterprise-ready only when its source is durable, queryable by the filters used by the UI, and covered by route/API smoke or contract checks. Volatile, fixture, Redis-windowed, Athena-only, computed, or unavailable sources must be labeled through `meta.sourceMetadata` and must not be shown as durable Supabase history.

| Management feature | Source of truth | Required source label before durable backing exists |
| --- | --- | --- |
| Readiness | API Center readiness and registry health | Unavailable/degraded when API Center cannot be reached |
| Registry and catalog | `apic_catalog`, Redis registry cache during migration | Redis/cache source until Postgres cutover and parity pass |
| Registration requests | `apic_governance.registry_change_requests`, approvals, audit | Durable before provider-impacting approval |
| Developer portal quota requests | Approval requests, quota policies, quota evaluations | Durable approval/audit required before self-service live use |
| Lifecycle | Catalog, quotas, plans, approvals, health, pipeline evidence, audit | Missing durable evidence shows attention or blocked |
| Promotions | Promotion evidence, approvals, health, quota, plan, smoke, pipeline evidence, audit | Volatile until durable promotion evidence bundles or evidence snapshots exist |
| Compliance | `apic_audit.audit_events`, future `apic_audit.evidence_snapshots`, promotion evidence | Export is incomplete/degraded when durable evidence is missing |
| Operational trust | Drift, dependencies, scorecards, promotion evidence, audit | Unavailable sources must be visible, not treated as healthy |
| Reliability | Gateway/shared-service rollups, quota decisions, audit, health | Redis-windowed/degraded until durable rollup writers exist |
| Cost | Shared-service usage rollups and future provider cost imports | Redis-windowed/degraded until durable cost/usage rollups exist |
| Data pipeline | Event onboarding, feedback actions, schema versions, decision signals, Athena evidence | Athena/external or fixture/volatile source labels required |
| Shared services | Shared Services APIs, `shared_*` provider schemas, future `shared_core` | API Center must not query provider tables directly |
| Audit | `apic_audit.audit_events` with Redis/memory fallback | Durable only when Postgres audit read succeeds |
| Alerts | Runtime/usage/audit signals and computed projections | Computed or volatile unless backed by durable alert snapshots |

The Management smoke route gate now covers page identity plus local API source metadata for gateway traffic, shared-service usage, audit events, and data-pipeline routes. The smoke gate should fail if a source-aware route omits `meta.sourceMetadata`.

## Sync Vs Async Workflow Ownership

Request-time paths stay synchronous only when the caller cannot proceed without the answer. Evidence, rollups, alerts, exports, and analytics should be asynchronous or read from precomputed durable/external sources.

| Workflow | Mode | Source or mechanism | Rule |
| --- | --- | --- | --- |
| Token issuance and validation | Sync | Auth module, token/session state, secret provider | Gateway cannot proxy until auth succeeds or fails |
| Registry route lookup | Sync from cache/published config | Redis registry cache, future gateway config snapshot, `apic_catalog` | Runtime routing must not depend on a live Postgres read per request |
| Entitlement and quota admission | Sync decision, async evidence | Published policy/config, governance state, quota evaluations | Allow/deny happens before proxying; evidence can flush after the decision |
| Idempotency reservation | Sync | Redis or a gateway/shared-service idempotency store | Duplicate prevention must happen before upstream/provider writes |
| Provider result calls and webhook receipt | Sync receipt, async processing | Shared Services API and webhook inbox/outbox | Acknowledge receipt safely, then reconcile and publish durable events asynchronously |
| Audit for governance mutations | Transactional or immediate async | `apic_audit.audit_events` plus optional Kafka | Provider-impacting actions should not be approved without audit evidence |
| Gateway/shared-service usage counters | Async rollup | Redis hot counters, future durable rollup writers | Do not add Postgres latency to every proxy request |
| Evidence snapshots and compliance exports | Async capture, sync read | Future `evidence_snapshots`, promotion bundles, audit | Exports read already-captured evidence; they should not invent audit-ready evidence on demand |
| Alerts, cost trends, provider reconciliation, pipeline analytics | Async | Rollups, provider APIs, Athena, computed projections | UI must show freshness and degraded/unavailable labels when sources lag or fail |

## Gateway Config Publish Contract

Gateway-specific DDL remains out of phase 1 unless explicitly promoted. The future `apic_gateway` control plane must use a publish model instead of runtime live-table reads.

1. Approval creates authoring state for routes, consumers, subscriptions, policies, and credential references.
2. Publish creates an immutable versioned config snapshot with checksum, source approvals, actor, environment, and created timestamp.
3. Gateway instances load the published snapshot into gateway-native hot-path config and report active config version, checksum, and loaded timestamp.
4. Drift checks compare desired published config to active gateway reports.
5. Rollback republishes or reactivates the previous known-good snapshot; it does not edit historical snapshots in place.
6. Management must show desired version, active version, drift, failed publish, and rollback evidence before any gateway control-plane split.

## Shared Services Platform Execution Boundary

Shared Services owns `shared_*` provider schemas and any future `shared_core` schema. API Center phase 1 must not create, alter, or backfill `shared_core`, and must not touch existing provider tables except through Shared Services APIs or approved contracts.

The separate Shared Services execution plan must cover migration authority, dry run, backup/rollback, no-touch diff against existing provider schemas, integration registry, entitlements, provider account references, provider secret references, idempotency keys, webhook inbox, outbox events, usage rollups, provider reconciliation, and Management degraded-state behavior. API Center may document the dependency, but Shared Services must own the Supabase SQL migration and live rollout.
