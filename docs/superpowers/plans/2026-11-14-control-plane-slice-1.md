---
title: Control plane rebuild, slice 1 execution plan
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, agents]
last_verified: "2026-11-14"
verification: repository
sources: [docs/superpowers/specs/2026-11-14-control-plane-rebuild-design.md, prisma/schema.prisma, supabase/migrations, apps/gateway/src/domains/control-plane, apps/gateway/src/domains/gateway-proxy/shared-services, packages/runtime/src, apps/email/src/server.ts]
---
# Control plane rebuild, slice 1

Executes the first slice of the approved [control plane rebuild design](../specs/2026-11-14-control-plane-rebuild-design.md): organization-owned projects and environments, consumer-only applications, explicit grants and test credentials, proven through one capability (email).

## Scope

- **Schema.** New `apic_catalog.cp_*` tables: projects, environments, applications, capability installations, application grants, credentials and credential issuance receipts. Every child row carries the full ownership tuple, and composite foreign keys reject cross-organization, cross-project or cross-environment references. Legacy tables are unchanged.
- **Gateway domain.** `apps/gateway/src/domains/control-plane` (catalog-registry boundary context, because it owns `apic_catalog` rows). Platform-admin endpoints under `/api/v1/admin/control-plane/organizations/:organizationId`.
- **Capability catalog.** Email only: `email:send` (`POST /send`) and `email:read` (`GET /status/:messageId`). Unknown capability routes are denied.
- **Credentials.** `ak_test_<lookup>_<secret>`, SHA-256 verifier, lookup by unique prefix, shown once, issuance idempotent by `operationId`, revocation immediate. Live issuance is refused in this slice.
- **Request path.** The existing `/api/v1/shared/email/*` URLs accept an `ak_` bearer, so SDK 2.0 works with a static access-token provider. The gateway resolves the application from the key alone, requires an active organization, project, environment, application, credential, enabled capability and explicit grant, strips caller identity headers and the caller's key, and forwards a signed runtime context.
- **Signed runtime context.** A 60-second Ed25519 JWS (`X-APICenter-Context`) with issuer, runtime audience, request ID and ownership tuple. `packages/runtime` verifies it; email adopts it. A present but invalid context is rejected rather than falling back to legacy headers. Legacy callers keep the current header path.

## Deliberately deferred

- Tenant-scoped RLS with per-transaction organization context. New tables follow the current `api_center_app` policy convention; isolation in this slice is enforced by composite constraints and application authorization.
- Console screens, project/team roles and organization member roles. Endpoints are platform-admin only.
- Live environments, payments, published APIs, event destinations, workload identity, quotas beyond runtime limits, legacy migration/backfill and assignment fencing.
- Custom email sender configuration for new projects; the runtime's default sender and daily limit apply.

## Checks

- [x] Domain tests: explicit grants only, sibling grants never apply, unknown actions denied, suspended/revoked/expired states denied, test-only issuance, issuance receipts, key format and verifier.
- [x] Runtime context tests: a gateway-signed context verifies; wrong audience, expiry, tampering, unknown key, `alg` confusion and private keys in the public set are rejected; forged legacy headers are ignored when a context is present.
- [x] In-process request path: control plane admin → `ak_test_` key → gateway proxy (real `fetch`) → the real email runtime sends, replays idempotently and reads status; forged legacy headers cannot read the message.
- [x] Mutation checks: removing the per-application grant filter, or the signed-context branch in the runtime, fails the suite.
- [x] Migration replay of all 12 migrations onto an empty PostgreSQL 17, then `tests/integration/control-plane.database.integration.spec.ts` (opt-in via `APICENTER_CONTROL_PLANE_TEST_URL`): full journey, cross-organization foreign-key rejections, prefix/kind check, immutable environment kind, and four concurrent retries of one issuance producing one credential.
- [x] Gateway, email, SMS, OTP and runtime typecheck; gateway and email build; boundary and monorepo checks; Prisma validation; documentation checks.
- [ ] `verify-control-plane-schema.ts --forbid-legacy-schemas` fails on three cross-schema foreign keys from the 2026-11-13 operability migrations (`apic_runtime.verification_reports`, `verification_runs` → `apic_catalog`). The new `cp_*` tables add none. Resolve with the operability baseline.
- [ ] Tenant RLS with a non-owner role is not exercised; the integration test connects as the database owner.
- [ ] Staging acceptance: apply the migration, set `APICENTER_RUNTIME_CONTEXT_SIGNING_KEY` on the gateway and `APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS` on email (`node scripts/control-plane/generate-runtime-context-key.cjs`), issue a test key and send one email.
