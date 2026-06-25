# APIC Codebase Improvement Review

Date: 2026-05-11

Scope:

- `api-center`
- `api-shared-services`
- SDK, shared-service runtime scaffolds, contracts, deployment docs, and Confluent
  Cloud migration surface

## Verification Snapshot

| Repo | Command | Result | Notes |
| --- | --- | --- | --- |
| `api-center` | `npm run typecheck` | Pass | TypeScript compile gate is healthy. |
| `api-center` | `npm test -- --runInBand` | Pass | 31 suites, 205 tests after removing stale external Kafka scope expectations. |
| `api-center` | `npm run check:boundaries` | Pass | Dependency boundary checks are healthy. |
| `api-center` | `npm run check:contracts` | Pass | Contract check now validates Kafka scopes against governed Kafka controller routes. |
| `api-center` | `npm run lint` | Fail | Existing Prettier/line-ending/style drift across many `src/**/*.ts` files. |
| `api-shared-services` | `npm run typecheck` | Pass | SDK type gate is healthy. |
| `api-shared-services` | `npm run check:contracts` | Pass | Contract check is healthy after adding OTP to the snapshot. |
| `api-shared-services` | `npm run build` | Pass | SDK build succeeds. |
| `api-shared-services` | `npm run test` | Pass with escalation | Sandbox hit Windows `spawn EPERM`; elevated rerun passed 14 Vitest tests. |
| `api-shared-services` | `npm run ci` | Pass with escalation | Full package gate passed. |

## Fixes Applied During Review

- Removed stale self-managed Kafka rollout, smoke, sync, and rollback references
  from `infra/gcp/gke/README.md` and `docs/deployment-gke.md`.
- Corrected `docs/developer/confluent-cloud-migration-plan.md` so current GKE
  config is described as Confluent runtime configuration, not leftover
  self-managed Kafka config.
- Updated `src/registry/registry.controller.spec.ts` to stop expecting direct
  external Kafka scopes after the move to governed Kafka publishing.
- Updated `scripts/check-contract-compatibility.js` in `api-center` so Kafka
  required scopes are validated against `kafka-governance.controller.ts`.
- Added `gauth` and `otp` to shared-service contract snapshots.
- Hardened `api-shared-services/scripts/check-contract-compatibility.js` so every
  manifest in `shared-services/manifests/` must be listed in the contract.

## Highest Priority Improvements

### P0: Restore `api-center` Lint as a Useful Gate

`npm run lint` currently fails on formatting and line-ending drift before it can
act as a useful quality gate.

Evidence:

- `api-center/eslint.config.mjs` enables `prettier/prettier: error`.
- The lint output reports repeated Prettier failures such as CRLF removal and
  quote formatting across many `src/**/*.ts` files.

Recommended fix:

1. Add or confirm `.editorconfig` and Prettier settings for the intended line
   endings and quote style.
2. Run a one-time formatter pass.
3. Commit formatting separately from behavior changes.
4. Keep `npm run lint` in the required local and CI gates.

### P0: Keep Contract Snapshots Complete

The SDK and manifests had moved ahead of the contract snapshots.

Evidence:

- `api-shared-services/src/TribeClient.ts` exposes `gauth*` and `otp*` helpers.
- `api-shared-services/shared-services/manifests/otp-manifest.json` exists.
- The contract snapshot did not include OTP before this review.
- `api-center/docs/contracts/shared-service-contract.json` did not include
  `gauth` or `otp` before this review.

Recommended fix:

1. Treat `contracts/shared-service-contract.json` as the SDK release contract.
2. Treat `api-center/docs/contracts/shared-service-contract.json` as the gateway
   compatibility snapshot.
3. Require contract checks in both repos before SDK release or gateway deploy.
4. Add route-level checks over the manifest `exposes` list in a later pass.

## High Priority Improvements

### P1: Simplify Secret and Config Initialization

`api-center/src/main.ts` preloads GCP secrets before Nest creates the app, which
is the correct place for config values that are read during provider
construction. `api-center/src/config/config.module.ts` still describes
`SecretsService.onModuleInit()` as if it runs before `ConfigService` reads env
values, but provider construction happens earlier than `onModuleInit`.

Impact:

- The current bootstrap preload protects runtime behavior.
- The module-level comment and secondary load path are misleading.
- Future maintainers may move config reads back into a timing-sensitive path.

Recommended fix:

1. Make bootstrap secret preload the single source of truth.
2. Remove or reword the `ConfigModule` comment.
3. Keep `ConfigService` construction deterministic.
4. Add a small bootstrap/config test if secret loading behavior changes.

### P1: Expand Runtime Tests for Shared Services

The SDK has tests, but most shared-service runtime scaffolds are JavaScript HTTP
services with limited or no route-level automated tests.

Targets:

- `api-shared-services/shared-services/paymongo/`
- `api-shared-services/shared-services/email-gateway/`
- `api-shared-services/shared-services/sms-gateway/`
- `api-shared-services/shared-services/gauth-gateway/`
- `api-shared-services/shared-services/otp-gateway/`

Recommended fix:

1. Add lightweight route tests for health, success, validation failure, and
   provider failure paths.
2. Assert response shapes match SDK types.
3. Run these tests in `npm run ci`.

### P1: Productionize Provider Integrations

Payment now uses the canonical `paymongo/` shared-service runtime. The legacy
draft payment gateway folder has been removed, so remaining hardening should
focus on provider behavior rather than ownership cleanup.

Evidence:

- `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
  contains TODOs for real PayMongo calls and webhook signature verification.
- `api-shared-services/shared-services/paymongo/` is the canonical runtime.

Recommended fix:

1. Implement real PayMongo client calls behind the existing contract.
2. Add idempotency and webhook signature verification.
3. Keep provider-specific details out of tribe services.

### P1: Deepen Contract Compatibility Checks

Current checks catch wrapper names, manifest presence, selected controller route
strings, and Kafka governance routes. They do not yet fully validate every
manifest `exposes` route against SDK wrapper behavior and API Center proxy
expectations.

Recommended fix:

1. Parse each shared-service manifest.
2. Validate all manifest `exposes` routes have either typed wrappers or an
   explicit generic-call exception.
3. Validate required scopes are reflected in API Center discovery output.
4. Fail CI when a manifest is added without contract coverage.

## Medium Priority Improvements

### P2: Reduce Unsafe Casts in Gateway Code

There are still narrow `any` casts in gateway code.

Examples:

- `api-center/src/external/external.controller.ts` casts `req.method as any`.
- `api-center/src/shared/proxy-handler.ts` uses unsafe proxy/catch typing.

Recommended fix:

1. Introduce a small HTTP method normalization helper.
2. Type proxy middleware boundaries once instead of scattering casts.
3. Keep test mocks explicit so production code can stay typed.

### P2: Cross-Link Canonical Docs

The repos now have multiple useful docs, but they need explicit ownership links.

Recommended fix:

1. Link the SDK usage guide from `api-shared-services/README.md`.
2. Link the shared-service delivery workflow from API Center developer docs.
3. Keep Confluent setup docs focused on event/data pipeline setup, not live
   request routing.

### P2: Finish Operational Autoscaling Notes

`api-center/infra/gcp/gke/50-hpa.yaml` still has a TODO for request-rate scaling.

Recommended fix:

1. Decide whether CPU/memory HPA is enough for the first production release.
2. If request-rate scaling is required, add Prometheus adapter or KEDA design.
3. Document the metric source and rollback behavior.

## Recommended Implementation Phases

### Phase 1: Restore and Lock Quality Gates

Goal: make every existing quality command meaningful and repeatable.

Tasks:

- Normalize `api-center` formatting and line endings.
- Keep contract snapshots aligned in both repos.
- Add CI enforcement for `typecheck`, `test`, `check:boundaries`, and
  `check:contracts`.
- Keep `api-shared-services npm run ci` as the release gate.

### Phase 2: Harden SDK and Shared-Service Contracts

Goal: prevent SDK, manifest, and gateway drift.

Tasks:

- Add route-level contract checks from manifest `exposes`.
- Add tests for typed wrappers covering payment, email, SMS, Google auth, OTP,
  and Kafka governance.
- Add negative tests for missing `consumes`, missing scopes, and unknown shared
  service IDs.

### Phase 3: Productionize Shared-Service Runtimes

Goal: make platform-owned shared services production ready behind the current
API Center contract.

Tasks:

- Replace payment mocks with PayMongo API calls.
- Add webhook verification and idempotency.
- Add route tests for each shared-service runtime.
- Remove or clearly archive draft runtime folders.

### Phase 4: Operational Hardening

Goal: make deployment and incident handling predictable.

Tasks:

- Finalize autoscaling strategy.
- Add Confluent Cloud verification runbooks that do not rely on removed
  self-managed Kafka scripts.
- Add dashboard/audit checks for gateway errors, rejected policy checks, and
  Kafka publish failures.

## Next Best Fix

The next implementation step should be Phase 1 formatting cleanup for
`api-center`. It is low-risk if committed separately, and it turns lint back
into a useful signal before deeper contract and runtime hardening work.
