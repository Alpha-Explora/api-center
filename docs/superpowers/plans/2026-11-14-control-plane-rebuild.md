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
- [x] Slice 5 — project plans (code-owned catalogue; starter is test-only), project quota policies and shared ceilings over explicit project sets, bounded test default (`CONTROL_PLANE_TEST_DAILY_REQUESTS`, 1,000/day), live blocked without a plan. Budgets reserved with conditional upserts in one tenant transaction; a request key (scoped Idempotency-Key or request ID) is counted once; 429 `QUOTA_EXCEEDED` with Retry-After. PostgreSQL tests: exactly the limit admitted under concurrency; a rejected request charges no budget. Usage records and per-environment summaries. Migration `20261114000400`.
- [x] Slice 6 — live environments start in `provisioning`; readiness checks (live-capable plan, enabled capability, live application, explicit grant); activation consumes one `environment.activate_live` approval targeted at the project in the same transaction; the database refuses an active live environment without an approval ID. Live credentials only after activation; suspend/resume per environment. Email sender and Google OAuth app configuration forward to the runtimes for control-plane projects. Also fixed: the approvals table rejected `quota.increase` and `payments.live_access`, which the code already uses. Migration `20261114000500`.
- [x] Slice 7 — `ak_` credentials call `/api/v1/payments` with explicit `payments:*` grants (the facade's existing scope strings; `authorizeAction`). The payment principal is the application under its resolved resource owner. `cp_resource_owner_mappings` keeps a migrated project's legacy (tribe, project) owner, carried in the signed context (`own_grp`, `own_prj`) to every runtime. Payments require `PAYMENTS_MERCHANT_ORGANIZATION_IDS`, checked on enable and on every request. Legacy `apic_` payment keys are unchanged. Migration `20261114000600`.
- [x] Slice 8 — optional published APIs per environment (upstream, operations, actions) behind `/api/v1/apis/:apiId/*`; application credentials only. Same-project grants are direct; cross-project grants need an access request decided by the API project's admins (no self-approval); a database trigger keeps API grants inside one organization and environment kind. The publisher receives only the signed context (audience `apicenter-api:<apiId>`). Upstreams must be https and publicly routable, checked at publish time and before every forward (SSRF guard); `CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS=true` relaxes this outside production only. Migration `20261114000700`.
- [x] Slice 9 — per-environment payment event destinations for one recipient application, provisioned through the existing payment Pub/Sub provisioner (HTTPS Cloud Run push with OIDC, dead-lettering, environment match) and filtered to that application; failures are recorded, not hidden; disabling leaves the subscription for the operator to drain. The versioned event payload is part of slice 12. Also added `tests/e2e/control-plane-wiring.e2e-spec.ts`, which boots the real AppModule and checks routes reach the right guards. Migration `20261114000800`.
- [x] Slice 10 — migration machinery. Inventory reads the legacy model through its contexts' public services and plans it purely (`migration/legacy-plan.ts`): projects, tribes as member-less teams, applications per service environment, published APIs from declared routes, grants snapshotted from the registry's own access and scope rules against a fixed catalog revision, payment access from active key scopes, plans, project quotas, and tribe ceilings over exactly the tribe's projects; unrepresentable access is a blocker, narrowing is listed as an approximation. The plan digest is the revision; backfill refuses a changed source and is idempotent through `cp_legacy_mappings`; migrated environments keep their legacy record owner. `cp_control_plane_assignments` fences writes both ways (legacy registry writes refused after cutover; control-plane writes refused before). Before cutover, legacy JWT calls are shadowed and differences recorded; cutover needs the expected fence, test before live, and no unresolved mismatch; afterwards legacy JWT callers are authorized by their mapped application's grants and forwarded with the signed context. Rollback is refused once control-plane state exists since cutover. Platform-operator API under `/admin/control-plane/organizations/:id/migration`. PostgreSQL lifecycle test runs as the RLS-bound application role. Migration `20261114000900`.
- [x] Slice 11 — console Workspace section: Projects (create; per-environment capabilities, plan, usage, applications, grants, credentials with a one-time key dialog; live provisioning, readiness and activation), People (members, roles, teams) and Migration (inventory, blockers, approximations, backfill, cutover and rollback with fences, shadow mismatches; platform operators only). One route, `/api/local/control-plane/*`, forwards the member's Google ID token to the gateway, which enforces every role; it allows only control-plane path segments. Legacy console screens remain until retirement.
