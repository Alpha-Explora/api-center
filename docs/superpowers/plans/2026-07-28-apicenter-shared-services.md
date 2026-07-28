# APICenter Shared Services Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the email, SMS, OTP, Google Auth, and geo runtimes from `api-shared` into APICenter while preserving their public contracts and making APICenter the source of truth for runtime, SDK, deployment, and operations.

**Architecture:** Each service becomes an independently deployable CommonJS app under `api-center/apps/<service>`. The apps reuse `@apicenter/runtime`, register with the APICenter gateway, and are invoked through the authenticated shared-service proxy and SDK. AlphaCI remains a consumer and keeps only AlphaCI-specific behavior.

**Tech Stack:** Node.js 24, CommonJS, Express 5, TypeScript 6 for the gateway/SDK, Zod 4 for validation where contracts are extended, Jest/Vitest tests, Docker, Google Cloud Run, Secret Manager, and Cloud Build.

## Global Constraints

- Preserve the existing public endpoint paths and response envelopes.
- Keep one Cloud Run service, image, service account, and provider-secret boundary per runtime.
- Invocation is IAM-only from the APICenter gateway.
- Do not introduce Confluent Cloud or Kafka for provider request/response flows.
- Keep payment data and payment deployment configuration isolated in `apps/payments`.
- Do not move AlphaCI-specific business logic into APICenter.
- Do not commit provider credentials, `.env` files, generated secrets, or local log files.
- Treat uncommitted changes in `api-shared` as user-owned; copy source deliberately and never reset that repository.

---

### Current Execution Status (2026-07-28)

- Completed: APICenter runtime apps, gateway routes, SDK surface, local compose, Cloud Run manifests, provider secret bindings, and staging route configuration.
- Completed: shared-service telemetry now publishes sanitized events to `apicenter.shared-service-events.test` or `.live` through Google Pub/Sub; Kafka remains disabled for this path.
- Completed: staging gateway revision `api-center-staging-00019-b9m` is ready from Cloud Build `f9ba9156-a5bd-465c-a6c3-b4b6152ae7ab`; authenticated readiness returned HTTP 200, the five shared runtimes have private ingress, and gateway `roles/run.invoker` bindings are present.
- Pending: provision a fresh staging consumer credential and run authenticated gateway/SDK smoke tests for all five services.
- Pending: provider-operation smoke tests and final staging evidence before any production cutover.
- Deferred: four legacy or sandbox-dependent tests remain excluded from the deploy gate; they are follow-up cleanup and are not part of the new runtime rollout.

### Task 1: Establish APICenter Runtime App Boundaries

**Files:**
- Create: `apps/email/package.json`, `apps/email/src/server.js`, `apps/email/scripts/check-javascript.cjs`
- Create: `apps/sms/package.json`, `apps/sms/src/server.js`, `apps/sms/src/store.js`, `apps/sms/scripts/check-javascript.cjs`
- Create: `apps/otp/package.json`, `apps/otp/src/server.js`, `apps/otp/src/store.js`, `apps/otp/scripts/check-javascript.cjs`
- Create: `apps/gauth/package.json`, `apps/gauth/src/server.js`, `apps/gauth/src/oauthCredentialResolver.js`, `apps/gauth/src/oauthState.js`, `apps/gauth/scripts/check-javascript.cjs`
- Create: `apps/geo/package.json`, `apps/geo/src/server.js`, `apps/geo/src/geoCache.js`, `apps/geo/scripts/check-javascript.cjs`
- Modify: `packages/runtime/src/*` only where the moved services require an existing helper that is absent or incompatible
- Modify: `package.json`, `package-lock.json`, `turbo.json`
- Test: `apps/*/scripts/check-javascript.cjs`

**Interfaces:**
- Consumes: `api-shared/shared-services/{email-gateway,sms-gateway,otp-gateway,gauth-gateway,geo-gateway}/src/*` and `api-shared/shared-services/runtime/*`.
- Produces: five workspace packages named `@apicenter/email`, `@apicenter/sms`, `@apicenter/otp`, `@apicenter/gauth`, and `@apicenter/geo`, each exposing `start`, `typecheck`, `lint`, and `test` scripts.

- [ ] **Step 1: Inventory source and user changes before copying**

Run from `C:\Codes\cicd-ex`:

```powershell
git -C api-shared status --short
git -C api-shared diff -- shared-services src contracts infra
```

Expected: the existing user-owned modifications are recorded and no reset/checkout operation is performed.

- [ ] **Step 2: Create workspace package shells**

Use the payment package shape, changing only the package name and service entry point:

```json
{
  "name": "@apicenter/email",
  "version": "1.0.0",
  "private": true,
  "main": "src/server.js",
  "type": "commonjs",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "typecheck": "node scripts/check-javascript.cjs",
    "test": "node scripts/check-javascript.cjs",
    "lint": "node scripts/check-javascript.cjs"
  },
  "dependencies": {
    "@apicenter/runtime": "1.0.0",
    "express": "^5.2.1",
    "resend": "^6.12.3"
  }
}
```

Create equivalent package manifests for SMS, OTP, Google Auth, and geo, adding only dependencies already used by their source. Do not add a provider SDK when the existing implementation uses `fetch`.

- [ ] **Step 3: Copy runtime source into the five apps**

Copy the service source files from `api-shared` into the matching `api-center/apps/<service>/src` directory. Replace relative runtime imports such as `../../runtime` with the package import:

```js
const {
  createSharedServiceApp,
  createMemoryRateLimitStore,
  registerWithGateway,
} = require('@apicenter/runtime');
```

Keep endpoint handlers and response shapes unchanged in this task.

- [ ] **Step 4: Add per-app JavaScript checks**

Each `scripts/check-javascript.cjs` must recursively parse the app's `.js` files with Node's `vm.Script` and exit nonzero on syntax failure. Run:

```powershell
npm install
npm run typecheck --workspace @apicenter/email
npm run typecheck --workspace @apicenter/sms
npm run typecheck --workspace @apicenter/otp
npm run typecheck --workspace @apicenter/gauth
npm run typecheck --workspace @apicenter/geo
```

Expected: all five checks pass.

- [ ] **Step 5: Commit the boundary foundation**

```powershell
git add apps/email apps/sms apps/otp apps/gauth apps/geo packages/runtime package.json package-lock.json turbo.json
git commit -m "feat(apicenter): add shared service runtime apps"
```

### Task 2: Migrate Email and SMS Behavior

**Files:**
- Modify: `apps/email/src/server.js`, `apps/sms/src/server.js`, `apps/sms/src/store.js`
- Create: `tests/unit/src/shared-services/email-runtime.spec.ts`, `tests/unit/src/shared-services/sms-runtime.spec.ts`
- Create: `apps/email/service-manifest.json`, `apps/sms/service-manifest.json`
- Source reference: `api-shared/shared-services/manifests/email-manifest.json`, `api-shared/shared-services/manifests/sms-manifest.json`

**Interfaces:**
- Consumes: runtime helpers from Task 1.
- Produces: unchanged `/send`, `/status/:messageId`, and `/templates` routes with the existing `201`, `404`, `429`, and provider-error behavior.

- [ ] **Step 1: Write failing route contract tests**

Cover missing recipient/content (`400 INVALID_REQUEST`), idempotent replay (`idempotencyStatus: "replayed"`), rate limiting (`429 RATE_LIMITED`), successful send (`201`), status lookup, and templates for both services.

- [ ] **Step 2: Run focused tests and verify the pre-implementation failures**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/email-runtime.spec.ts tests/unit/src/shared-services/sms-runtime.spec.ts
```

Expected: the new tests fail because the APICenter app test harness and route exports are not wired yet.

- [ ] **Step 3: Implement the minimal APICenter route harness**

Export `app` from each server, use `@apicenter/runtime` for `ok`/`fail`, and keep the existing provider and in-memory store behavior. Do not change field names or status codes.

- [ ] **Step 4: Add manifests with stable IDs and scopes**

Use `serviceId` values `email` and `sms`, preserve the existing `requiredScopes`, `exposes`, and `healthCheck` values, and set the runtime route to be injected by deployment rather than hard-coded.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/email-runtime.spec.ts tests/unit/src/shared-services/sms-runtime.spec.ts
git add apps/email apps/sms tests/unit/src/shared-services/email-runtime.spec.ts tests/unit/src/shared-services/sms-runtime.spec.ts
git commit -m "feat(apicenter): migrate email and sms services"
```

### Task 3: Migrate OTP with Verification-Safety Guarantees

**Files:**
- Modify: `apps/otp/src/server.js`, `apps/otp/src/store.js`
- Create: `tests/unit/src/shared-services/otp-runtime.spec.ts`
- Create: `apps/otp/service-manifest.json`

**Interfaces:**
- Consumes: `@apicenter/runtime` rate limiting and error envelope.
- Produces: `/generate`, `/verify`, and `/status/:otpId` with single-use, expiry, channel validation, and non-production code disclosure only.

- [ ] **Step 1: Write failing OTP tests**

Cover invalid channel, generated length/expiry clamping, rate limits, missing OTP, expired OTP, already-used OTP, invalid code, valid code, and status transitions.

- [ ] **Step 2: Run the focused test file and confirm failure**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/otp-runtime.spec.ts
```

- [ ] **Step 3: Port the OTP store and handlers without changing the contract**

Keep the existing response codes (`400`, `404`, `429`, `201`) and ensure `code` is returned only when `NODE_ENV !== "production"`.

- [ ] **Step 4: Run the tests and commit**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/otp-runtime.spec.ts
git add apps/otp tests/unit/src/shared-services/otp-runtime.spec.ts
git commit -m "feat(apicenter): migrate otp service"
```

### Task 4: Migrate Google Auth Broker

**Files:**
- Modify: `apps/gauth/src/server.js`, `apps/gauth/src/oauthCredentialResolver.js`, `apps/gauth/src/oauthState.js`
- Create: `tests/unit/src/shared-services/gauth-runtime.spec.ts`
- Create: `apps/gauth/service-manifest.json`

**Interfaces:**
- Consumes: Google OAuth provider URLs, tenant credential resolution, signed state, timeout, circuit breaker, and provider metric helpers.
- Produces: existing `/oauth/authorize`, `/oauth/token`, `/oauth/token/refresh`, and `/oauth/logout` behavior without persisting provider tokens.

- [ ] **Step 1: Write failing OAuth contract tests**

Cover missing credentials, tenant credential selection, redirect URI validation, signed-state verification, PKCE forwarding, provider timeout/error mapping, token exchange, refresh, and logout.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/gauth-runtime.spec.ts
```

- [ ] **Step 3: Port the broker and preserve security checks**

Use the APICenter runtime provider guard helpers, keep secrets server-side, and never return client secrets or persist access/refresh tokens.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/gauth-runtime.spec.ts
git add apps/gauth tests/unit/src/shared-services/gauth-runtime.spec.ts
git commit -m "feat(apicenter): migrate google auth service"
```

### Task 5: Migrate Geo and Cache Behavior

**Files:**
- Modify: `apps/geo/src/server.js`, `apps/geo/src/geoCache.js`
- Create: `tests/unit/src/shared-services/geo-runtime.spec.ts`
- Create: `apps/geo/service-manifest.json`

**Interfaces:**
- Consumes: Google Maps geocoding configuration, provider guard helpers, and the existing cache interface.
- Produces: `/geocode`, `/reverse-geocode`, and `/geofence/check` with mock mode outside production and provider errors mapped to the existing codes.

- [ ] **Step 1: Write failing geo tests**

Cover invalid coordinates, mock geocode/reverse-geocode, cache hits, Google provider error mapping, and geofence distance/inside calculations.

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/geo-runtime.spec.ts
```

- [ ] **Step 3: Port handlers and cache implementation**

Keep production configuration strict: missing `GOOGLE_MAPS_API_KEY` must return `500 GOOGLE_MAPS_CONFIG_ERROR`; development may use the existing deterministic mock.

- [ ] **Step 4: Run tests and commit**

```powershell
npm test -- --runInBand tests/unit/src/shared-services/geo-runtime.spec.ts
git add apps/geo tests/unit/src/shared-services/geo-runtime.spec.ts
git commit -m "feat(apicenter): migrate geo service"
```

### Task 6: Integrate Gateway, Contracts, SDK, and Management

**Files:**
- Modify: `apps/gateway/src/shared-services/shared-service-routing.service.ts`, `apps/gateway/src/shared-services/shared-services.controller.ts`, `apps/gateway/src/shared-services/shared-services.module.ts`
- Modify: `apps/management/src/lib/shared-service-manifests.ts`, `apps/management/src/lib/service-onboarding.ts`, `apps/management/src/lib/service-form-presets.ts`
- Modify: `packages/contracts/apicenter-openapi.json`, `packages/sdk/src/TribeClient.ts`, `packages/sdk/src/types.ts`, `packages/sdk/src/index.ts`
- Create: `packages/sdk/tests/unit/TribeClient.shared-services.test.ts`
- Create: `tests/unit/src/shared-services/shared-service-contracts.spec.ts`

**Interfaces:**
- Consumes: service manifests and route handlers from Tasks 2-5.
- Produces: stable SDK methods for email, SMS, OTP, Google Auth, and geo that call `/api/v1/shared/:serviceId/*` through the authenticated APICenter gateway.

- [ ] **Step 1: Port the existing `api-shared` SDK method signatures**

Use `api-shared/src/internal/shared-services.ts` and the shared-service methods in `api-shared/src/TribeClient.ts` as the compatibility source. Preserve method names and payload types; adapt only imports and error handling to the APICenter SDK conventions.

- [ ] **Step 2: Add failing SDK request tests**

Assert exact HTTP method, URL, JSON body, required scopes, and response parsing for every moved operation. Mutating calls must preserve caller-provided `Idempotency-Key` behavior where supported.

- [ ] **Step 3: Register service manifests in management and gateway checks**

Ensure all five IDs appear in management onboarding and the gateway registry validation, with no route pointing at `api-shared`.

- [ ] **Step 4: Update public contracts and validate**

Add the moved route schemas to the APICenter contract source and run:

```powershell
npm run contracts:validate
npm run check:sdk-contracts
npm run sdk:test
npm run sdk:build
```

- [ ] **Step 5: Commit the consumer surface**

```powershell
git add apps/gateway apps/management packages/contracts packages/sdk tests/unit/src/shared-services/shared-service-contracts.spec.ts
git commit -m "feat(apicenter): expose shared services through sdk"
```

### Task 7: Add Cloud Run and Secret Manager Deployment Ownership

**Files:**
- Create: `infra/gcp/cloud-run/email.yaml`, `infra/gcp/cloud-run/sms.yaml`, `infra/gcp/cloud-run/otp.yaml`, `infra/gcp/cloud-run/gauth.yaml`, `infra/gcp/cloud-run/geo.yaml`
- Create: `infra/gcp/cloud-build/apicenter-shared-services-cloud-run.yaml`
- Modify: `.gcloudignore`, `docs/deployment-cloud-run.md`, `docs/apicenter-platform-setup.md`
- Modify: gateway environment examples containing `SHARED_SERVICE_ROUTE_*`

**Interfaces:**
- Consumes: app entry points and manifests from Tasks 2-5.
- Produces: independently deployable Cloud Run definitions with IAM-only ingress, provider-specific secret bindings, gateway invoker permissions, and explicit route environment variables.

- [ ] **Step 1: Copy and normalize Cloud Run service definitions**

Move the existing service YAMLs from `api-shared/infra/gcp/cloud-run`, update image names to the APICenter Artifact Registry namespace, set the correct container command (`node src/server.js`), and keep service-specific ports (email `4012`, SMS `4011`, OTP `4014`, Google Auth `4013`, geo `4015`).

- [ ] **Step 2: Bind only owning-provider secrets**

Email receives `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS`; Google Auth receives its default/tenant OAuth credential secrets; geo receives `GOOGLE_MAPS_API_KEY`; SMS and OTP receive only their configured provider/store secrets. No secret is bound to the gateway or AlphaCI.

- [ ] **Step 3: Add independent build/deploy steps**

The Cloud Build file must build and push five images from `apps/<service>`, replace each Cloud Run service manifest, set `DEPLOYMENT_BUILD_ID`, and grant `roles/run.invoker` to the APICenter gateway service account. It must not rebuild or redeploy payments.

- [ ] **Step 4: Validate manifests without deployment**

```powershell
gcloud run services replace infra/gcp/cloud-run/email.yaml --region=asia-southeast1 --dry-run=client
gcloud run services replace infra/gcp/cloud-run/sms.yaml --region=asia-southeast1 --dry-run=client
gcloud run services replace infra/gcp/cloud-run/otp.yaml --region=asia-southeast1 --dry-run=client
gcloud run services replace infra/gcp/cloud-run/gauth.yaml --region=asia-southeast1 --dry-run=client
gcloud run services replace infra/gcp/cloud-run/geo.yaml --region=asia-southeast1 --dry-run=client
```

Expected: all manifests parse; deployment is not performed by this step.

- [ ] **Step 5: Commit infrastructure ownership**

```powershell
git add infra/gcp/cloud-run infra/gcp/cloud-build .gcloudignore docs/deployment-cloud-run.md docs/apicenter-platform-setup.md
git commit -m "ci(apicenter): add shared service cloud run deployments"
```

### Task 8: Update Local Runtime, Documentation, and Legacy Boundaries

**Files:**
- Modify: `deploy/local/docker-compose.yml`
- Modify: `docs/developer/README.md`, `apps/management/README.md`, `apps/management/docs/operations/apicenter-management-runbook.md`
- Modify: `scripts/check-contract-compatibility.js`, `scripts/check-monorepo-boundary.js`
- Modify: `README.md`, `CONTRIBUTING.md`
- Modify: `api-shared/LEGACY-FROZEN.md` only if the legacy repository is intentionally updated after the APICenter commits are complete

**Interfaces:**
- Consumes: completed app, SDK, and deployment paths from Tasks 1-7.
- Produces: local APICenter stack with all five runtimes, current docs, and checks that fail on new legacy `api-shared` dependencies.

- [ ] **Step 1: Add five services to local compose**

Use build contexts under `apps/<service>`, expose only internal service ports, and configure the gateway route variables to service names. Do not reintroduce the removed legacy `api-shared-services` build blocks.

- [ ] **Step 2: Update compatibility checks**

The checks must accept `apps/email`, `apps/sms`, `apps/otp`, `apps/gauth`, and `apps/geo`, compare their manifests to the public contract, and reject imports or build contexts pointing at `api-shared`.

- [ ] **Step 3: Update docs and examples**

Document service ownership, SDK examples, local startup, required provider environment names, IAM invocation, and the fact that AlphaCI consumes these services through APICenter.

- [ ] **Step 4: Run local contract and boundary checks**

```powershell
npm run check:monorepo
npm run check:boundaries
npm run check:contracts
npm run contracts:validate
```

- [ ] **Step 5: Commit documentation and legacy-boundary updates**

```powershell
git add deploy/local/docker-compose.yml scripts/check-contract-compatibility.js scripts/check-monorepo-boundary.js README.md CONTRIBUTING.md docs apps/management
git commit -m "docs(apicenter): document shared service ownership"
```

### Task 9: Run Full Verification and Cut Over Service Ownership

**Files:**
- Modify: `docs/superpowers/plans/2026-07-28-apicenter-shared-services.md` to record task completion evidence
- Modify: `docs/deployment-cloud-run.md` with current APICenter revisions only after live verification
- Legacy source: freeze `api-shared` only after all checks pass; do not delete it in this task

**Interfaces:**
- Consumes: all migrated runtimes, contracts, SDK, gateway, management, and deployment assets.
- Produces: verified APICenter ownership and a reversible cutover record.

- [ ] **Step 1: Run workspace verification**

```powershell
npm run typecheck
npm run lint
npm test -- --runInBand
npm run sdk:build
npm run sdk:test
npm run check:boundaries:test
npm run check:environment-naming
npm run check:no-legacy-routing
```

Expected: all commands pass; any provider-dependent smoke is reported separately rather than bypassed.

- [ ] **Step 2: Run local service smoke tests**

Start the local stack with `npm run docker:up`, call each health endpoint through the gateway, and exercise one successful and one invalid request per service. Stop the stack with `npm run docker:down`.

- [ ] **Step 3: Deploy to staging only**

Apply the five APICenter service manifests and route variables in staging, then verify IAM-only invocation, health, provider configuration, and gateway proxy behavior. Do not change production DNS or delete legacy services.

- [ ] **Step 4: Record cutover evidence and freeze the legacy source**

After staging and production verification, update the deployment evidence with actual current revisions and add the APICenter commit SHAs to `api-shared/LEGACY-FROZEN.md`. Do not remove the legacy repository until a separate explicit deletion decision is made.

- [ ] **Step 5: Commit verification evidence**

```powershell
git add docs/superpowers/plans/2026-07-28-apicenter-shared-services.md docs/deployment-cloud-run.md
git commit -m "chore(apicenter): record shared service migration verification"
```

## Self-Review Checklist

- Spec architecture is covered by Tasks 1, 6, and 7.
- Public endpoint preservation is covered by Tasks 2-5 and SDK contract tests in Task 6.
- Data ownership and AlphaCI isolation are covered by Tasks 2-5 and the secret boundaries in Task 7.
- IAM, per-service deployment, and provider secrets are covered by Task 7.
- Incremental rollback and legacy freeze are covered by Task 9.
- No provider credentials or Kafka/Confluent dependency is introduced.
- All tasks have exact paths, commands, expected outcomes, and a commit boundary.
