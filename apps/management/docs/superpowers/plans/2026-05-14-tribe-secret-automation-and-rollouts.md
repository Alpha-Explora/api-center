# Tribe Secret Automation And Rollout Controls Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementing this plan. Track progress by updating the checkboxes in this file.

**Goal:** Stop editing `api-center-prod` every time a tribe is added. Store each tribe secret hash as its own GCP Secret Manager secret, let API Center resolve tribe secrets dynamically, and add local management-console actions to provision tribe secrets and restart the API Center deployment when needed.

**Current state:** API Center validates tribe secrets from environment variables named `TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>`. In GKE those values are currently loaded from the `api-center-prod` Secret Manager JSON payload at process startup. That means adding or rotating a tribe secret requires editing the shared `api-center-prod` payload and restarting API Center.

**Target state:** `api-center-prod` keeps only platform/runtime configuration. Tribe credentials live in separate Secret Manager resources such as `api-center-tribe-secret-smoke-tribe`. API Center reads the correct per-tribe secret hash by service ID, caches it briefly, and does not require a deployment restart for ordinary tribe onboarding.

## Current Status

Code implementation is complete for the API Center resolver, local management
secret provisioning, management UI actions, guarded deployment restart route,
and docs migration. Live GCP/GKE setup and smoke verification were completed
for `smoke-tribe` on 2026-05-14.

Completed:

- API Center can validate legacy env-backed tribe secrets and new per-tribe GCP
  Secret Manager payloads.
- Management can generate plaintext in the browser, hash it in the browser, and
  send only the hash to the local server route.
- Management can create or rotate `api-center-tribe-secret-<tribe-id>` using
  the GCP Secret Manager SDK.
- Management has a guarded API Center rollout restart action behind
  `ALLOW_DEPLOYMENT_RESTARTS=true`.
- Current runbooks now point new tribes to per-tribe Secret Manager secrets
  instead of editing `api-center-prod`.

Not completed yet:

- Route-level tests for the `apicenter-management` Secret Manager route are
  still pending because the app does not have a test runner configured yet.
- Other tribes still need their own `api-center-tribe-secret-<tribe-id>`
  resources and secret-level IAM bindings when they onboard.
- Legacy `TRIBE_SECRET_*` values for any other tribes should be removed from
  `api-center-prod` after each tribe has a per-tribe secret and passes token
  verification.

## Next Operator Steps

Use these steps for the next tribe. The `smoke-tribe` path has already been run.

1. Confirm these one-time keys exist in `api-center-prod`:

```json
{
  "TRIBE_SECRET_SOURCE": "gcp-secret-manager",
  "TRIBE_SECRET_GCP_PREFIX": "api-center-tribe-secret-",
  "TRIBE_SECRET_CACHE_TTL_SECONDS": "300"
}
```

2. Grant the API Center runtime identity Secret Manager access to the new
   per-tribe secret path.

Known deployment-doc identity:

```text
KSA: api-center/api-center
GSA: api-center-gke@api-center-492808.iam.gserviceaccount.com
```

Use secret-level IAM for each created tribe secret when possible:

```powershell
gcloud secrets add-iam-policy-binding api-center-tribe-secret-smoke-tribe `
  --project api-center-492808 `
  --member="serviceAccount:api-center-gke@api-center-492808.iam.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor"
```

3. Confirm local management env values:

```text
GOOGLE_CLOUD_PROJECT=api-center-492808
TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
ALLOW_DEPLOYMENT_RESTARTS=true
K8S_NAMESPACE=api-center
K8S_API_CENTER_DEPLOYMENT=api-center
```

Then authenticate local ADC if you are not using a service-account JSON:

```powershell
gcloud auth application-default login
gcloud config set project api-center-492808
```

4. Deploy the updated API Center code if this is a new code change.

5. Restart API Center once after resolver config or legacy secret cleanup:

```powershell
kubectl -n api-center rollout restart deployment/api-center
kubectl -n api-center rollout status deployment/api-center --timeout=5m
```

6. Open local management:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Generate a secret, click **Provision secret**, then request a token with the
plaintext value.

7. Run safe shared-service smoke checks.

8. After the per-tribe secret path works, remove that tribe's legacy
   `TRIBE_SECRET_*` entry from `api-center-prod`.

---

## Secret Contract

Use one GCP Secret Manager secret per tribe:

```text
Secret name: api-center-tribe-secret-<tribe-id>
Example:     api-center-tribe-secret-smoke-tribe
```

Recommended payload:

```json
{
  "serviceId": "smoke-tribe",
  "secretHashSha256": "<sha256 hash of plaintext tribe secret>",
  "status": "active",
  "rotatedAt": "2026-05-14T00:00:00.000Z"
}
```

Rules:

- Store only the SHA-256 hash. Never store plaintext tribe secrets in Secret Manager.
- The plaintext secret is generated or pasted in the browser and shown only once.
- API Center should accept the JSON payload above. For migration, it may also accept a raw string hash payload.
- Normalize service IDs to lower-case kebab case for Secret Manager names.
- Keep `api-center-prod` free of `TRIBE_SECRET_*` entries after migration.

One-time `api-center-prod` additions:

```json
{
  "TRIBE_SECRET_SOURCE": "gcp-secret-manager",
  "TRIBE_SECRET_GCP_PREFIX": "api-center-tribe-secret-",
  "TRIBE_SECRET_CACHE_TTL_SECONDS": "300"
}
```

---

## Phase 1: API Center Secret Resolver

Implementation status: completed in code with focused Jest coverage.

**Outcome:** API Center can validate tribe secrets from either legacy env vars or per-tribe Secret Manager secrets.

- [x] Create a `TribeSecretResolverService` in `api-center`.
- [x] Resolution order during migration:
  1. Read `TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>` from env.
  2. If not found, read `api-center-tribe-secret-<tribe-id>` from GCP Secret Manager.
- [x] Cache each resolved secret hash for a short TTL, default `300` seconds.
- [x] Compare request hashes with `crypto.timingSafeEqual`.
- [x] Emit clear audit/log events when a tribe secret is missing, malformed, or inactive.
- [x] Add unit tests for:
  - legacy env secret validation
  - GCP JSON payload validation
  - raw hash payload migration support
  - malformed payload rejection
  - cache hit and cache expiry behavior

---

## Phase 2: GCP IAM And Runtime Configuration

Implementation status: completed for `smoke-tribe` in live GCP/GKE on
2026-05-14.

**Outcome:** API Center can read per-tribe secrets without broad admin access.

- [x] Identify the GKE runtime service account used by API Center from the
  deployment docs.
- [x] Grant that identity `roles/secretmanager.secretAccessor` on
  `api-center-tribe-secret-smoke-tribe`.
- [x] Add the one-time `TRIBE_SECRET_SOURCE`, `TRIBE_SECRET_GCP_PREFIX`, and `TRIBE_SECRET_CACHE_TTL_SECONDS` settings to `api-center-prod`.
- [x] Restart API Center once after adding the new resolver configuration.
- [x] Verify token issuance for new Secret Manager-backed smoke tribe.
- [x] After verification, remove legacy `TRIBE_SECRET_SMOKE_TRIBE` from `api-center-prod`.

---

## Phase 3: Management Secret Provisioning

Implementation status: route and UI client are implemented. Mocked route tests
are still pending because this app does not currently have a test runner.

**Outcome:** `apicenter-management` can create or rotate a tribe secret hash without manually editing `api-center-prod`.

- [x] Add a local-only route:

```text
POST /api/local/tribe-secrets
```

Request body:

```json
{
  "serviceId": "smoke-tribe",
  "secretHashSha256": "<sha256 hash>",
  "mode": "create-or-rotate"
}
```

- [x] Use the GCP Secret Manager SDK from the server route.
- [x] Require local admin environment setup:

```text
GOOGLE_CLOUD_PROJECT=api-center-492808
GOOGLE_APPLICATION_CREDENTIALS=<optional local service account file>
```

- [x] If using local ADC instead of a service-account file, document:

```powershell
gcloud auth application-default login
gcloud config set project api-center-492808
```

- [x] Validate service IDs before creating secrets.
- [x] Never send plaintext secrets to the server route. The browser sends only the hash.
- [x] Return the secret resource name and latest version number.
- [ ] Add tests with a mocked Secret Manager client.

---

## Phase 4: Management UI

Implementation status: implemented for smoke tests and tribe detail pages.

**Outcome:** The management console can provision tribe secrets as part of tribe onboarding.

- [x] Add a `Provision secret` action to the smoke-test hash helper.
- [x] Add the same action to the tribe detail page.
- [x] Generate plaintext in the browser, hash it in the browser, and send only the hash to the local route.
- [x] Show a clear one-time plaintext value for the user to give to the tribe backend owner.
- [x] Show the created Secret Manager name:

```text
api-center-tribe-secret-<tribe-id>
```

- [x] Show whether API Center can validate the new secret without requiring a restart.
- [x] Keep all secret-provisioning controls hidden or disabled unless local management mode is enabled.

---

## Phase 5: Deployment Restart Control

Implementation status: local guarded route and settings UI are implemented.

**Outcome:** Local management can restart the API Center deployment without giving the UI arbitrary shell access.

- [x] Add a local-only route:

```text
POST /api/local/deployments/api-center/restart
```

- [x] Use a fixed allowlist:

```text
K8S_NAMESPACE=api-center
K8S_API_CENTER_DEPLOYMENT=api-center
ALLOW_DEPLOYMENT_RESTARTS=false
```

- [x] For the first local implementation, call `kubectl` only with fixed arguments:

```powershell
kubectl -n api-center rollout restart deployment/api-center
kubectl -n api-center rollout status deployment/api-center --timeout=5m
```

- [x] Do not accept arbitrary namespace, deployment, or shell command input from the browser.
- [x] Add a confirmation dialog in the UI before restart.
- [x] Show rollout status, current revision, and last restart timestamp.
- [ ] Later production implementation can replace `kubectl` with the Kubernetes API client and Workload Identity.

---

## Phase 6: Docs And Migration Cleanup

Implementation status: current runbooks are updated; historical completed plans
may still mention the old env-key flow as past context.

**Outcome:** Tribe onboarding docs match the new flow.

- [x] Update `apicenter-management/docs/operations/local-smoke-testing.md`.
- [x] Update `api-center/docs/apicenter-platform-setup.md`.
- [x] Update `api-center/docs/deployment-gke.md`.
- [x] Update `api-center/docs/developer/tribe-onboarding.md`.
- [x] Remove instructions that tell users to add every `TRIBE_SECRET_*` to `api-center-prod`.
- [x] Keep one migration note explaining the legacy `api-center-prod` path for rollback only.

---

## Phase 7: Verification

Implementation status: completed for `smoke-tribe` against the live gateway and
local management route on 2026-05-14.

**Outcome:** A new tribe can be registered, provisioned, and smoke-tested without touching `api-center-prod`.

- [x] Reuse the existing `smoke-tribe` test tribe registration.
- [x] Generate a one-time plaintext smoke secret locally.
- [x] Provision `api-center-tribe-secret-smoke-tribe`.
- [x] Request a tribe token through the live `/api/v1/auth/token` endpoint.
- [x] Run safe shared-service smoke checks through the local management route.
- [x] Confirm no `api-center-prod` tribe-secret update was needed for the new per-tribe secret.
- [x] Confirm API Center restart was needed only for resolver config and legacy
  smoke key cleanup, not for ordinary future per-tribe secret onboarding.
- [x] Confirm the guarded rollout path works by deploying and restarting API Center.

---

## Non-Goals

- Do not store plaintext tribe secrets.
- Do not make management public before auth is implemented.
- Do not let the browser choose arbitrary Kubernetes command arguments.
- Do not move provider secrets like PayMongo, Google Maps, Resend, Redis, SMS, or OTP into tribe secret resources.
- Do not require one Descope app per tribe.

---

## Recommended Implementation Order

1. API Center resolver with tests.
2. GCP IAM and one-time `api-center-prod` resolver config.
3. Management secret provisioning route with mocked tests.
4. Management UI for provision and rotate.
5. Restart route and rollout status UI.
6. Docs cleanup and full smoke test.
