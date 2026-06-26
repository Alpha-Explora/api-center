# API Center Control-Plane Database

API Center control-plane state now lives in Supabase Postgres through owner
schemas managed by SQL migrations in `api-center/supabase/migrations`. Prisma is
the typed application client, not the live migration authority.

This database stores durable management state: registry records, service
environments, route metadata, scopes, dependencies, approvals, quotas, plans,
audit records, promotion evidence, smoke-test runs, and operational rollups. It
does not replace Redis for hot runtime cache paths, and it does not replace the
approved event/export stores for raw data-plane payloads.

## Current Live State

- Registry source of truth: Postgres through `apic_catalog`.
- Redis remains the hot cache and fallback source for rollback or degraded
  operation.
- Legacy compatibility schemas `api_center`, `api_center_ops`, and
  `api_center_audit` were removed by
  `supabase/migrations/20260626002247_drop_legacy_control_plane_views.sql`.
- Shared-service provider schemas remain owned by `api-shared-services`; API
  Center code must use Shared Services APIs/contracts instead of direct provider
  table access.

## Owner Schemas

| Schema | Owner context | Purpose |
| --- | --- | --- |
| `apic_catalog` | Catalog and registry | Durable registry records, environments, service routes, scopes, dependencies, shared-service links, lifecycle events, and secret references. |
| `apic_governance` | Governance | Approval requests, lifecycle governance, policies, plans, entitlements, quota policies, secret-rotation workflow state, promotion bundles, and event schema versions. |
| `apic_runtime` | Runtime operations | Health snapshots, smoke-test runs, quota evaluations, gateway rollups, shared-service rollups, pipeline feedback actions, decision signals, and query-run provenance. |
| `apic_audit` | Audit and evidence | Append-only audit events and durable evidence snapshots for compliance, promotion, and investigation records. |

Secrets stay in GCP Secret Manager or the approved secret provider. Postgres
stores only references and metadata, such as secret names, rotation state, actor,
approval, and audit identifiers.

## Shared-Service Boundary

Shared-service provider and business records are owned by the sibling repo:

```text
C:\Codes\apic\api-shared-services\supabase\migrations
```

Shared Services owns existing `shared_*` schemas and any future `shared_core`
schema. API Center migrations must not create, alter, backfill, or drop those
schemas without a Shared Services-owned migration plan, backup/rollback plan,
and no-touch diff.

## Access And RLS Stance

APIC control-plane schemas are private server-side schemas. Browser clients do
not query them directly through the Supabase Data API, and
`supabase/config.toml` exposes only `public` and `graphql_public` through the
local API config.

The enterprise migrations revoke broad `public` access from `apic_catalog`,
`apic_governance`, `apic_runtime`, and `apic_audit`. If any APIC control-plane
table is later exposed to `anon` or `authenticated`, RLS must be enabled first
with owner/environment predicates and indexes on the policy columns.

## Retained Commands

Use these commands for ordinary control-plane database maintenance:

```powershell
cd C:\Codes\apic\api-center
npm run db:migration:new -- <descriptive_name>
npm run db:migration:push:dry
npm run db:migration:push
npm run db:verify:control-plane -- --app-role <discovered_app_role>
npm run db:generate
npm run db:backfill:registry
npm run registry:verify
```

Use `npm run db:verify:control-plane -- --forbid-legacy-schemas` when checking
that legacy `api_center*` compatibility schemas remain absent.

## Future Migration Checklist

1. Create the migration with `npm run db:migration:new -- <descriptive_name>`.
2. Write SQL under `supabase/migrations`; do not invent migration filenames by
   hand.
3. Update `prisma/schema.prisma` and regenerate the Prisma client when runtime
   code needs typed access to the changed shape.
4. Verify ownership boundaries: one bounded context per `apic_*` or
   `shared_core` table, no direct writes across owner schemas, and no direct
   `shared_*` provider-table access from API Center.
5. Run `npm run db:verify:control-plane -- --app-role <discovered_app_role>`.
6. Run `npm run db:migration:push:dry` and review the SQL plan before live
   approval.
7. Apply with `npm run db:migration:push` only after approval, rollback notes,
   and verification commands are recorded.

## Rollback Flags

Rollback is a read-source and write-path decision, not a schema deletion:

```text
REGISTRY_SOURCE=redis
DATABASE_ENABLED=true
DATABASE_DUAL_WRITE=true
```

This keeps Redis as the startup source while Postgres continues receiving
writes for inspection. If Postgres writes are failing and blocking registry
changes, set `DATABASE_DUAL_WRITE=false` and keep `REGISTRY_SOURCE=redis`.

## Retention And Partitioning

High-volume tables need retention rules before being treated as durable product
evidence:

| Table family | Minimum retention | Launch rule |
| --- | --- | --- |
| Audit events and evidence snapshots | 400 days | Append-only; purge/archive only through a separately approved retention maintainer role. |
| Gateway and shared-service rollups | 400 days | Hourly/daily rollups only; do not store raw per-request data in Postgres. |
| Quota evaluations and policy decisions | 180 days | Partition or retain by volume threshold before enforced high-volume traffic. |
| Health snapshots and smoke-test runs | 90 to 180 days | Store enough evidence for promotion and reliability review. |
| Pipeline decisions and query runs | 365 days | Preserve source metadata, query identifiers, steward action, and freshness. |

The API Center runtime role must not delete audit rows. Legal-hold or
compliance-lock records must be excluded from purge/archive jobs.

## Modular Monolith Boundaries

API Center remains a modular monolith until a bounded context needs independent
scaling, deployment, ownership, security isolation, or failure isolation.
Microservice readiness is created by enforcing schema and module boundaries now.

| Bounded context | Owner schema/store | Allowed access path |
| --- | --- | --- |
| Catalog and registry | `apic_catalog`, Redis registry cache | Registry module APIs, API contracts, read models, or events. |
| Governance | `apic_governance` | Approval, quota, entitlement, policy, and lifecycle service contracts. |
| Runtime operations | `apic_runtime`, Redis windows, telemetry | Runtime services, rollup APIs, source metadata contracts, or events. |
| Audit and evidence | `apic_audit` | Audit append APIs, evidence snapshot APIs, compliance export APIs, or immutable events. |
| Data-pipeline governance | `apic_governance`, `apic_runtime`, external evidence stores | Schema governance APIs, topic onboarding APIs, decision-signal events, or read models. |
| Gateway control plane | Future `apic_gateway` or gateway-native config store | Versioned config publish contracts and runtime read-only snapshots. |
| Shared-service platform | `shared_*`, future `shared_core` owned by `api-shared-services` | Shared-service APIs, usage contracts, and no-touch provider-table boundaries. |

Run `npm run check:boundaries` before service-extraction work and before any
schema change that crosses a bounded-context boundary.

## Management Source-Backed Feature Matrix

Management views are enterprise-ready only when their source is durable,
queryable by the filters used by the UI, and covered by route/API smoke or
contract checks.

| Management feature | Source of truth |
| --- | --- |
| Readiness | API Center readiness and registry health. |
| Registry and catalog | `apic_catalog` plus Redis hot cache/fallback metadata. |
| Registration and lifecycle requests | `apic_governance` approval and lifecycle tables plus audit events. |
| Developer portal quota requests | Approval requests, quota policies, quota evaluations, and audit events. |
| Promotions | Approval, health, quota, plan, smoke, pipeline, and evidence snapshot records. |
| Compliance | `apic_audit.audit_events`, evidence snapshots, promotion evidence, and export metadata. |
| Operational trust | Drift, dependency, scorecard, promotion evidence, health, and audit sources. |
| Reliability | Gateway/shared-service rollups, quota decisions, health, smoke tests, and audit. |
| Cost | Shared-service usage rollups and future provider cost imports. |
| Data pipeline | Topic onboarding, feedback actions, event schema versions, decision signals, query runs, and external evidence. |
| Shared services | Shared Services APIs and `shared_*` provider schemas owned outside API Center. |

Volatile, fixture, Redis-windowed, computed, external-only, or unavailable
sources must be labeled through source metadata and must not be shown as durable
Supabase history.

## Sync Vs Async Ownership

Request-time paths stay synchronous only when the caller cannot proceed without
the answer. Evidence, rollups, alerts, exports, and analytics should be
asynchronous or read from precomputed durable/external sources.

| Workflow | Mode | Rule |
| --- | --- | --- |
| Token issuance and validation | Sync | Gateway cannot proxy until auth succeeds or fails. |
| Registry route lookup | Sync from cache/published config | Runtime routing must not depend on a live Postgres read per request. |
| Entitlement and quota admission | Sync decision, async evidence | Allow/deny happens before proxying; evidence can flush after the decision. |
| Idempotency reservation | Sync | Duplicate prevention must happen before upstream/provider writes. |
| Provider calls and webhooks | Sync receipt, async reconciliation | Acknowledge safely, then reconcile and publish durable events asynchronously. |
| Audit for governance mutations | Transactional or immediate async | Provider-impacting actions should not be approved without audit evidence. |
| Gateway/shared-service counters | Async rollup | Do not add Postgres latency to every proxy request. |
| Evidence snapshots and compliance exports | Async capture, sync read | Exports read captured evidence; they must not invent audit-ready evidence on demand. |
| Alerts, cost trends, provider reconciliation, analytics | Async | UI must show freshness and degraded/unavailable labels when sources lag or fail. |

## Gateway Control-Plane Direction

Gateway-specific DDL remains outside the current API Center cleanup unless
explicitly promoted. The future gateway control plane should use a publish model
instead of runtime live-table reads:

1. Approval creates authoring state for routes, consumers, subscriptions,
   policies, and credential references.
2. Publish creates an immutable versioned config snapshot with checksum, source
   approvals, actor, environment, and created timestamp.
3. Gateway instances load the published snapshot into gateway-native hot-path
   config and report active config version, checksum, and loaded timestamp.
4. Drift checks compare desired published config to active gateway reports.
5. Rollback republishes or reactivates the previous known-good snapshot; it does
   not edit historical snapshots in place.

## Known Phase 1.5 Gaps

These are planned product-platform improvements, not blockers for the completed
control-plane schema migration:

- Durable gateway and shared-service rollup writers with replay and retention.
- Promotion evidence bundles and evidence snapshot capture for compliance
  exports.
- Event schema version governance with compatibility mode, steward, environment,
  and validation history.
- Pipeline query run provenance and decision signals that can be filtered by
  service and environment.
- Gateway config publish snapshots if gateway control-plane ownership is moved
  into API Center later.
