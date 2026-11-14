---
title: Control plane operations
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers, reviewers]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src/domains/control-plane, apps/gateway/src/domains/gateway-proxy/published-apis, apps/gateway/src/domains/gateway-proxy/legacy-bridge, packages/runtime/src/runtimeContext.js, supabase/migrations, scripts/control-plane, apps/management/src/features/control-plane]
---
# Control plane operations

How to deploy, configure and migrate to the APICenter control plane described in the [rebuild design](../superpowers/specs/2026-11-14-control-plane-rebuild-design.md). The model is in [current architecture](../architecture/current-architecture.md#control-plane). Repository checks prove the code and migrations; every step below that touches a real environment needs its own evidence.

## Deploy

1. Apply migrations `20261114000100` through `20261114001000` in order. They add `apic_catalog.cp_*` tables with row-level security, extend `organization_members` roles, allow the `environment.activate_live`, `quota.increase` and `payments.live_access` approval types, and leave legacy tables unchanged.
2. Confirm the gateway's `DATABASE_URL` role is a member of `api_center_app` **without** `BYPASSRLS`. Otherwise tenant isolation is not enforced by the database (application-level scoping still applies).
3. Generate runtime context keys with `node scripts/control-plane/generate-runtime-context-key.cjs`:
   - gateway: `APICENTER_RUNTIME_CONTEXT_SIGNING_KEY` (Secret Manager);
   - every runtime (email, SMS, OTP, geo, Google sign-in) and every published-API publisher: `APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS`.
   Rotate by adding the new public key to every runtime first, then switching the gateway's signing key, then removing the old public key after one minute.
4. Gateway settings:
   - `MANAGEMENT_GOOGLE_CLIENT_IDS`: the console's Google OAuth client IDs, so console calls act as the signed-in member.
   - `PAYMENTS_MERCHANT_ORGANIZATION_IDS`: the organizations allowed to use the payment merchant account (the bootstrap organization only).
   - `CONTROL_PLANE_WORKLOAD_AUDIENCES`: audiences accepted on Google-signed workload tokens (usually the gateway URL); empty disables workload identity.
   - `CONTROL_PLANE_TEST_DAILY_REQUESTS` (default 1,000): the test-environment budget when no plan is assigned.
   - Never set `CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS` outside local development.
5. Existing `SHARED_SERVICE_ROUTE_<SERVICE>_<ENV>` variables route application calls; no new routes are needed.
6. Run the wiring check (`npx jest --config tests/e2e/jest-e2e.json control-plane-wiring`) against the built gateway, then the staging acceptance below.

## Staging acceptance

- Create a project in the console, enable email, add an application, grant `email:send`, issue a test key, and send one email with SDK 2.1 (`auth: { apiKey }`). Confirm the email runtime logs an application caller and the console shows the usage.
- Confirm a request without the grant returns `ACTION_NOT_GRANTED`, a revoked key returns `CREDENTIAL_REVOKED`, and the test budget returns `QUOTA_EXCEEDED` with `Retry-After`.
- Provision live, assign a live-capable plan, create the live application and grant, request and approve `environment.activate_live` for the project (a different person approves), activate, and issue a live key.

## Migrating an organization

The migration API and the console's **Migration** page are platform-operator only.

1. **Inventory.** Review blockers (unrepresentable access, foreign targets, missing live plans, disallowed upstreams) and approximations (legacy routing forwarded any path; published APIs allow only declared routes). Fix blockers in the legacy registry and re-run until ready. The revision is the plan's digest.
2. **Backfill** that revision. It is idempotent, refuses a changed source, and leaves every migrated environment governed by the legacy registry. Legacy credentials keep working.
3. **Shadow.** Legacy calls from migrated services are compared with the control plane's decision. Mismatches appear on the Migration page. Correct the grants (after cutover) or the legacy registration, then resolve them with a reason (`POST …/migration/projects/:projectId/environments/:env/shadow-mismatches/resolve`). Shadow for a representative traffic window.
4. **Cut over** test, then live, per project, naming the current fence. Legacy registry writes for that environment are then refused; legacy service tokens keep working and are authorized by the mapped application's grants.
5. **Rollback** is refused once anything was created in the control plane since cutover; repair forward instead.

Records keep their legacy owner through `cp_resource_owner_mappings`, so migrated applications see exactly the records their legacy project owned.

## Retirement gate

Remove legacy tribe routes, tables and SDK paths only when every assignment is governed by the control plane, every consumer has acknowledged payment event contract 1.1, and the deprecation window has passed. Then publish SDK 3.0 (dropping service credentials, `paymentApiKey` and `ownerTribeId`) and payment event contract 2.0.
