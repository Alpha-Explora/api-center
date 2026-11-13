---
title: Control plane rebuild, execution plan
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, agents]
last_verified: "2026-11-14"
verification: repository
sources: [docs/superpowers/specs/2026-11-14-control-plane-rebuild-design.md, docs/superpowers/plans/2026-11-14-control-plane-slice-1.md, apps/gateway/src/domains/control-plane, apps/management/src, packages/runtime/src, packages/sdk/src, supabase/migrations]
---
# Control plane rebuild, execution plan

Delivers the approved [control plane rebuild design](../specs/2026-11-14-control-plane-rebuild-design.md) after [slice 1](2026-11-14-control-plane-slice-1.md). Each slice lands with its migration, gateway code, tests and documentation. Deployment, real-project cutover and legacy deletion are operator actions recorded in [Operator gates](#operator-gates); they are not performed from the repository.

## Slices

| # | Slice | Outcome |
| --- | --- | --- |
| 2 | Runtime adoption | SMS, OTP, geo and Google sign-in verify the signed context; all 14 supported shared-service operations are catalogued |
| 3 | Console identity and roles | The gateway verifies the signed-in member (Google ID token forwarded by the console) and enforces organization roles (owner, admin, developer, viewer), teams and project roles. Legacy `operator`/`observer` map to `developer`/`viewer` |
| 4 | Tenant isolation | Control-plane queries run in transactions with `apicenter.organization_id` set; RLS policies restrict `cp_*` rows to that organization for `api_center_app`. Credential resolution uses one narrow `SECURITY DEFINER` lookup |
| 5 | Plans, quotas and usage | Project entitlements, conjunctive project and shared-ceiling limits reserved atomically in PostgreSQL, deduplicated usage records, bounded test defaults, live blocked without policy |
| 6 | Live environments and capability configuration | Live environment provisioning with a readiness checklist and single-use approval; live applications, grants and credentials; per-environment email sender and Google OAuth configuration through the control plane |
| 7 | Payments | Application credentials with `payments:*` grants call the payment facade; payment principal derives from the application; historical resources keep their owner through legacy mappings; live payments stay limited to the bootstrap organization's merchant binding |
| 8 | Published APIs | Optional per-environment API publication (upstream, routes, actions); cross-project grants need the publisher's approval; `/api/v1/apis/:apiId/*` forwards with a signed context publishers verify |
| 9 | Event destinations | Per-environment Pub/Sub destinations with an explicit recipient application and event filters; payment events carry the new ownership tuple in a versioned payload |
| 10 | Migration | Inventory with blockers, idempotent backfill with legacy mappings, finite grant snapshots, assignment fencing, shadow decisions, audited cutover and guarded rollback |
| 11 | Console | Project-first screens: projects, environments, capabilities, applications, grants, credentials, teams and members, migration dashboard |
| 12 | SDK 3 and contracts | `apiKey` authentication, published-API context verification helper, versioned event parsing, OpenAPI security scheme for application keys |
| 13 | Workload identity | Exact issuer/subject/audience bindings let Cloud Run service accounts call without a stored key |

## Operator gates

These need real environments and are not claimed by repository checks:

- Apply migrations to staging, then production.
- Generate and install runtime context keys (`scripts/control-plane/generate-runtime-context-key.cjs`) on the gateway and every runtime.
- Run the migration inventory against production data, resolve blockers, shadow for a representative window, then cut over project by project (test before live).
- Publish SDK 3; collect consumer acknowledgement of versioned events.
- Delete legacy tribe routes, tables and SDK paths only after every assignment is `new` and the deprecation window has passed.

## Progress

- [x] Slice 1 — committed `ae6c3a6`.
- [x] Slice 2 — SMS, OTP, geo and Google sign-in verify the signed context (`createRuntimeContextGate`, `readRuntimeApplicationContext`, `callerIdempotencyScope`); 14 operations catalogued. Valid, tampered and misaddressed contexts tested against the real SMS, OTP and geo apps.
- [x] Slice 3 — `ConsoleActorGuard` verifies the member's Google ID token (`X-APICenter-User-Token`, `MANAGEMENT_GOOGLE_CLIENT_IDS`) behind platform authentication; identity subject linked on first use; owner/admin/developer/viewer roles, teams and project roles enforced on every control-plane route; last owner protected. Migration `20261114000200`.
- [x] Slice 4 — every control-plane query runs in `withTenant` (transaction-local `apicenter.organization_id`); RLS policies on all `cp_*` tables for `api_center_app`; `cp_credential_organization` is the only pre-tenant lookup. Integration tests run the services as a NOBYPASSRLS login role: no rows without a tenant, no cross-tenant reads, 42501 on cross-tenant writes. Operator gate: the production `DATABASE_URL` role must be a NOBYPASSRLS member of `api_center_app` for RLS to apply. Migration `20261114000300`.
