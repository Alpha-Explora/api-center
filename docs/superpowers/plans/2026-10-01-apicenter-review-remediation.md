# APICenter Review Remediation Implementation Plan

> **For agentic workers:** Execute these tasks in order. Check each task's behavior before continuing.

**Goal:** Repair the seven review findings, aligning the public payment API to supported runtime behavior and removing unsupported standalone payment-method setup operations as directed.

**Architecture:** The public OpenAPI and SDK remain canonical. The gateway owns public authorization and translation; runtimes own provider calls and durable tenant state. Shared services use provider adapters and shared production storage.

**Tech Stack:** Node.js 24, npm workspaces, NestJS, Express, TypeScript, Jest, Vitest, PostgreSQL, Redis, Docker, GitHub Actions.

**Spec:** docs/superpowers/specs/2026-10-01-apicenter-review-remediation-design.md

## Global constraints

- No live provider calls in tests.
- Do not accept consumer-supplied tenant or environment as authoritative.
- Unknown payment operations and unconfigured production delivery fail closed.
- Run focused tests before broad workspace checks.

---

### Task 1: Restore a reproducible baseline

**Files:** package.json, package-lock.json, .github/workflows/ci.yml, tests/unit/src/payments, tests/unit/src/shared-services.

- [x] Add missing direct package declarations and regenerate the npm lockfile.
- [ ] Verify npm ci completes on a clean checkout.
- [x] Replace stale gateway imports in selected Jest tests with current domain paths.
- [x] Replace tests that require nonexistent src/server.js with TypeScript-aware runtime tests.
- [x] Remove the missing check:data-pipeline-projection CI step.
- [x] Run npm run test:all, integration, and E2E tests; record any remaining failures.

### Task 2: Build runnable service images

**Files:** Dockerfile.shared-service, docker/Dockerfile.payments.gcp, infra/gcp/cloud-build/apicenter-payments-cloud-run.yaml, deploy/local/docker-compose.yml.

- [x] Build each selected workspace in an image build stage.
- [x] Start apps/<service>/dist/server.js with production dependencies in the runtime stage.
- [x] Validate the payment Cloud Build entry point against compiled output.
- [x] Add CI builds and /health smoke probes for payment, email, SMS, OTP, geo, and gauth images.
- [ ] Run the Docker image builds and probes locally; Docker engine access is unavailable in this environment.

### Task 3: Enforce the public payment contract

**Files:** apps/gateway/src/domains/payments/features/payment-facade, apps/payments/src/server.ts, packages/sdk/src/internal/payment.ts, contracts/public/apicenter.openapi.yaml.

- [x] Add an explicit public operation table that maps method and route to required scope and runtime path.
- [x] Translate checkout, intent, refund, subscription, customer, invoice, and capability request/response shapes.
- [x] Remove unsupported payment-method setup operations and reject unmatched public routes before the runtime call.
- [x] Assert facade route translation through unit and HTTP E2E tests.

### Task 4: Enforce payment identity and ownership

**Files:** apps/gateway/src/domains/payments/shared, apps/payments/src/server.ts, apps/payments/src/features, apps/payments/src/shared, apps/payments/prisma or supabase/migrations.

- [x] Send trusted principal context to the runtime and validate its shared secret there.
- [x] Persist owner tribe, service, and environment for every created payment resource.
- [x] Check owner and environment before every resource read or mutation; missing owner records fail closed.
- [x] Test read-only scopes, unknown routes, forged tenant headers, and cross-tenant resource IDs.

### Task 5: Make payment retries recoverable

**Files:** apps/gateway/src/domains/payments/shared/payment-idempotency.service.ts, apps/gateway/src/domains/payments/features/payment-facade/payments.controller.ts, tests/unit/src/payments, tests/e2e/payments.e2e-spec.ts.

- [x] Forward the original Idempotency-Key and set a finite upstream timeout.
- [x] Separate in-progress, completed, and unknown outcomes with a bounded lease.
- [x] Retry an unknown outcome with the same provider key only within PayMongo's safe retry window; block unresolved outcomes after that window.
- [x] Test concurrent calls, timeout, stale unknown outcomes, and provider key forwarding.

### Task 6: Make shared delivery and state production-safe

**Files:** apps/sms/src, apps/email/src, apps/otp/src, packages/runtime/src, infra/gcp/cloud-run, tests/unit/src/shared-services.

- [x] Add a Twilio SMS adapter with explicit credentials, sender configuration, timeout, and provider-state mapping.
- [x] Keep Resend email delivery and fail clearly when its production configuration is absent.
- [x] Deliver OTP through the selected email or SMS adapter and persist only a code hash.
- [x] Select shared production stores for OTP, idempotency, status, and rate limits.
- [x] Atomically claim and replay idempotent email, SMS, OTP, and payment operations; keep uncertain delivery outcomes blocked.
- [x] Test delivery status mapping, missing provider configuration, and single-use OTP consumption.

### Task 7: Make validation cover the monorepo

**Files:** package.json, turbo.json, .github/workflows, scripts/check-boundaries.js, tests/integration/scripts/check-boundaries.test.js.

- [x] Resolve path aliases when checking cross-context imports.
- [x] Replace obsolete SDK and source-path exceptions with current boundaries.
- [x] Run workspace build, typecheck, lint, and tests in CI, including management and service runtimes.
- [x] Run contract, integration, E2E, boundary, and environment naming checks; add CI image smoke checks.
- [x] Recheck git diff and report any live-provider, Docker, or deployment verification that still requires credentials/access.
