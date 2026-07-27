# API Center Management Runbook

This runbook explains how to use the local API Center Management console end to
end. The console is an observability and operations layer for API Center. It is
currently local/private only; do not expose it publicly until admin auth is
implemented.

## What The Console Can Do

- Check local API Center connectivity and required environment variables.
- View and manage registry entries for tribes and shared services.
- Register or update tribe service manifests.
- Review pending service registration requests submitted from tribe repos.
- Inspect dependency relationships from manifest `consumes` entries.
- View shared-service catalog, setup guidance, usage matrix, provider usage,
  gateway traffic, audit events, and alerts.
- Generate and provision per-tribe Secret Manager secrets.
- Request a temporary tribe bearer token and run allowlisted shared-service
  smoke checks.
- Hand tribe teams the exact SDK install, runtime configuration, service
  consumption, and governed event-publishing steps.
- Provision tribe event topics and add them to the managed Confluent S3 Sink so
  API Center-published records export to S3.
- Restart the API Center GKE deployment through a guarded local-only action.

## Safety Rules

- Keep this app local until authentication is implemented.
- Never put platform admin secrets in `NEXT_PUBLIC_*` variables.
- Never store plaintext tribe secrets in Secret Manager.
- Only store SHA-256 tribe secret hashes in
  `api-center-tribe-secret-<tribe-id>-<environment>`. Microservice identity stays in API
  Center registration metadata and event `sourceServiceId`.
- Run safe smoke checks first. Provider-impacting checks may create PayMongo
  test data, send email/SMS, or create OTP records.
- Use the restart control only for deployment/config changes, not for normal
  per-tribe secret onboarding.

## Environment-Scoped Tribe Operations

The tribe form can register several runtime environments for one service ID.
Operators choose from platform-controlled environment keys: `test`, `staging`,
`uat`, `demo`, and `live`. Tribe teams customize the URL and health path for
each selected environment.

Cleanup must be reviewed per environment:

- deregister the service identity only when all environments should leave the registry
- remove each environment topic from the managed S3 Sink when exports should stop
- delete or rotate the environment tribe secret `api-center-tribe-secret-<tribe-id>-<environment>`
- disable or update environment-specific quota and plan evidence
- keep historical S3 data unless a separate data-retention process approves deletion

## Local Setup

From the management repo:

```powershell
cd C:\Codes\apic\apicenter-management
```

Create or update `.env.local`:

```env
API_CENTER_BASE_URL=https://api-center.itsandbox.site
API_CENTER_PLATFORM_ADMIN_SECRET=<platform-admin-secret>
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
NEXT_PUBLIC_DESCOPE_PROJECT_ID=<descope-project-id-if-needed-for-future-ui-auth>
GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623
GCP_IMPERSONATE_SERVICE_ACCOUNT=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com
TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
ALLOW_DEPLOYMENT_RESTARTS=true
K8S_NAMESPACE=api-center
K8S_API_CENTER_DEPLOYMENT=api-center
CONFLUENT_ENVIRONMENT_ID=<env-id>
CONFLUENT_KAFKA_CLUSTER_ID=<lkc-id>
CONFLUENT_KAFKA_REST_ENDPOINT=https://<cluster-rest-endpoint>
CONFLUENT_KAFKA_API_KEY=<kafka-cluster-api-key>
CONFLUENT_KAFKA_API_SECRET=<kafka-cluster-api-secret>
CONFLUENT_CLOUD_API_KEY=<cloud-management-api-key>
CONFLUENT_CLOUD_API_SECRET=<cloud-management-api-secret>
CONFLUENT_S3_CONNECTOR_NAME=api-center-s3-sink
CONFLUENT_DEFAULT_RETENTION_MS=604800000
```

Authenticate local GCP access if you want the console to create Secret Manager
secrets. The local app uses your active `gcloud auth login` user to impersonate
the provisioner service account configured in `GCP_IMPERSONATE_SERVICE_ACCOUNT`:

```powershell
gcloud config set project apicenter-alpha-20260623
gcloud auth print-access-token --impersonate-service-account=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com
```

If impersonation fails, grant your Google user token-creator access on the
provisioner service account:

```powershell
gcloud iam service-accounts add-iam-policy-binding `
  apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com `
  --project apicenter-alpha-20260623 `
  --member="user:<your-google-email>" `
  --role="roles/iam.serviceAccountTokenCreator"
```

Make sure kubectl points to the API Center cluster if you want to use restart
controls:

```powershell
gcloud container clusters get-credentials api-center --region=asia-southeast1 --project=apicenter-alpha-20260623
kubectl config current-context
```

Confluent provisioning uses server-only `.env.local` values. The Kafka API key
must be scoped to the Kafka cluster for topic operations. The Cloud API key must
be authorized to read/update the managed S3 Sink connector config. These are
operator credentials only; tribes do not receive them.

The console does not connect directly to Postgres. API Center control-plane DB
and shared-service DB rollout status should be checked through the repo docs and
migration commands until dedicated database status endpoints are added.

## One Management Deployment Topology

Management uses one API Center gateway URL:

```env
API_CENTER_BASE_URL=https://api-center.itsandbox.site
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
```

`MANAGEMENT_ENVIRONMENT` labels the deployed console and auth context. It does
not decide whether an operation targets API Center `test` or `live`. Registry,
secret, approval, smoke, SDK handoff, and lifecycle routes must carry an explicit
target environment and authorize against that target row before writing.

Expected target environments:

```text
test
live
```

Operator rules:

1. Use the same API Center URL for both target environments.
2. Select the target environment in the Management action, not by changing the
   API Center hostname.
3. For live-impacting actions, require the live review path even when the
   Management deployment label is `test`.
4. Record audit evidence with `serviceId`, `sourceServiceId`, `targetEnvironment`,
   and `correlationId`.
5. Keep shared-service and payment provider-impacting smoke checks disabled for
   live until a specific approval says otherwise.

Cutover sequence:

1. Run API Center in warn mode only for named legacy clients.
2. Provision `api-center-tribe-secret-<tribe-id>-test` and
   `api-center-tribe-secret-<tribe-id>-live` before enforce mode.
3. Update SDK handoff values to include `APICENTER_ENVIRONMENT`.
4. Smoke auth and read-only discovery for test and live target rows.
5. Switch API Center to enforce mode after active clients send explicit
   environment.

Rollback sequence:

1. Set API Center `APICENTER_ENVIRONMENT_CONTRACT_MODE=warn`.
2. Enable `APICENTER_LEGACY_TRIBE_SECRET_FALLBACK=true` only for named callers.
3. Keep one-URL SDK clients and environment-scoped secrets unchanged.
4. Add only affected legacy clients to the allowlist and explicit environment
   map.
5. Investigate by target environment and correlation ID before returning to
   enforce mode.

Break-glass controls:

- disable one service environment row
- revoke or rotate one environment-scoped tribe secret
- disable one shared-service route for one environment
- force quota to zero for one service and environment
- roll back one shared-service route to the previous known-good runtime
- export evidence by `serviceId + environment + correlationId`

Start the app:

```powershell
npm run dev
```

Open:

```text
http://localhost:3000
```

## Deploy-Time GCP Authentication

When this app is deployed to GKE, do not put a Google service account JSON key
or `GOOGLE_APPLICATION_CREDENTIALS` in the environment. Use Workload Identity so
the pod is authenticated automatically.

One-time IAM setup:

```powershell
gcloud config set project apicenter-alpha-20260623

gcloud iam service-accounts create apicenter-mgmt-provisioner `
  --project apicenter-alpha-20260623 `
  --display-name "API Center Management Provisioner"

gcloud iam roles create apiCenterTribeSecretProvisioner `
  --project apicenter-alpha-20260623 `
  --title "API Center Management Provisioner" `
  --description "Create and rotate API Center per-tribe Secret Manager secrets" `
  --permissions "secretmanager.secrets.create,secretmanager.secrets.get,secretmanager.versions.add" `
  --stage GA

gcloud projects add-iam-policy-binding apicenter-alpha-20260623 `
  --member "serviceAccount:apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com" `
  --role "projects/apicenter-alpha-20260623/roles/apiCenterTribeSecretProvisioner"

gcloud iam service-accounts add-iam-policy-binding `
  apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com `
  --project apicenter-alpha-20260623 `
  --role roles/iam.workloadIdentityUser `
  --member "serviceAccount:apicenter-alpha-20260623.svc.id.goog[api-center/apicenter-management]"
```

Apply the Kubernetes identity and restart RBAC:

```powershell
kubectl apply -f infra/gcp/gke/10-service-account.yaml
kubectl apply -f infra/gcp/gke/20-api-center-restart-rbac.yaml
```

The deployment must include:

```yaml
serviceAccountName: apicenter-management
```

Keep this app private until admin login and role checks are implemented. The
current GKE files only solve runtime identity, not user authorization.

## Feature 1: Readiness

Use this before changing registry data.

Open:

```text
http://localhost:3000/readiness
```

Steps:

1. Confirm API Center base URL is correct.
2. Confirm `API_CENTER_PLATFORM_ADMIN_SECRET` is configured.
3. Confirm the platform secret is not exposed through `NEXT_PUBLIC_*`.
4. Confirm registry access succeeds.
5. Fix any missing `.env.local` values before moving on.

Expected result:

- Readiness shows the local console can reach API Center through server-side
  local routes.

## Feature 2: Dashboard

Use this for the high-level operating snapshot.

Open:

```text
http://localhost:3000
```

Steps:

1. Review total registered services.
2. Review unhealthy service count.
3. Review missing owners and broken dependencies.
4. Use **Check readiness** if the dashboard indicates missing connectivity.
5. Use **Open registry** to inspect service entries.

Expected result:

- You can quickly see whether the registry has broken service metadata before
  touching individual tribes.

## Feature 2.1: Quota Operations

Use this when a tribe needs a scoped gateway quota or an observe-mode quota has
started to exceed its recommended limit.

Open:

```text
http://localhost:3000/quotas
```

Operator checklist:

1. Create policy in observe mode.
2. Review 24 hours of usage.
3. Adjust `maxRequests` or `burstRequests`.
4. Switch to enforce with a reason.
5. Watch blocked decisions and SDK 429 handling.
6. Disable policy if it blocks a critical rollout unexpectedly.

Expected result:

- Operators can move from observation to enforcement with usage evidence and a
  documented reason.

## Feature 3: Register A Tribe

Use this when onboarding a new tribe backend.

Open:

```text
http://localhost:3000/tribes/new
```

Steps:

1. Enter `Service ID`.
   - Use lowercase letters, numbers, and hyphens only.
   - Example: `campusone-students`.
2. Enter `Service name`.
3. Enter backend service URL.
   - Local testing can use `http://localhost:<port>`.
   - Production API Center in GKE cannot reach your laptop unless you expose a
     tunnel or deploy the backend.
4. Choose `Type`.
   - Use `tribe` for tribe-owned services.
   - Use `shared` only for platform shared-service runtimes.
5. Fill ownership fields:
   - owner team
   - contact
   - cost center
   - health path
6. Fill route/access fields:
   - exposed routes
   - required scopes
   - shared services this tribe can call
   - other service dependencies
7. Review the manifest preview.
8. Click **Register service**.

Smoke tribe shortcut:

1. Click **Smoke preset**.
2. Review the generated `smoke-tribe` manifest.
3. Click **Register service**.

Expected result:

- The new tribe appears in `/tribes`.
- The tribe detail page opens after registration.

## Feature 4: View And Filter Registry

Use this to inspect tribe and shared-service manifests.

Open:

```text
http://localhost:3000/tribes
```

Steps:

1. Review registered services.
2. Use filters to narrow by service type, owner, or status if available.
3. Click a service row to open its detail page.
4. Check service status, base URL, owner, scopes, exposed routes, and consumes.

Expected result:

- Registry entries match what tribes and shared services should expose and
  consume.

## Feature 5: Tribe Detail Operations

Use this after registering a tribe.

Open:

```text
http://localhost:3000/tribes/<service-id>
```

Steps:

1. Review service identity and manifest metadata.
2. Click **Check health**.
3. If it is a tribe, use **Smoke shared services** to jump to smoke testing.
4. Use **Overview** for metadata, dependencies, and quick readiness signals.
5. Use **Onboarding** for tribe secret, Confluent topic/S3 sink, SDK config,
   and smoke-test entry.
6. Use **Observability** for shared-service usage, audit/event mapping, and
   runtime signals.
7. Use **Developer tools** for contract testing and manifest export.
8. Use **Lifecycle** actions only when needed:
   - Activate
   - Deprecate
   - Retire
   - Deregister

Lifecycle safety:

- Retire keeps the service in the registry but makes it non-routable.
- Deregister removes it from registry storage.
- Destructive actions require confirmation.

## Feature 6: Edit A Manifest

Use this when a tribe changes URL, scopes, routes, dependencies, ownership, or
version.

Open:

```text
http://localhost:3000/tribes/<service-id>/edit
```

Steps:

1. Update the needed fields.
2. Review the manifest diff.
3. Pay attention to warnings for risky changes.
4. Review the manifest preview.
5. Click **Update service**.
6. Reopen the service detail page.
7. Run health and contract checks.

Expected result:

- Registry reflects the updated manifest.
- Proxy and dependency views update from the new manifest.

## Feature 7: Provision A Tribe Secret

Use this so a tribe can request API Center-issued M2M tokens without editing
`api-center-prod`.

Open either:

```text
http://localhost:3000/tribes/<service-id>?section=onboarding
```

or:

```text
http://localhost:3000/smoke-tests?tribeId=<service-id>
```

Steps from tribe detail:

1. Find **Tribe secret**.
2. Click **Generate**.
3. Copy the one-time plaintext secret and give it to the tribe backend owner.
4. Click **Provision secret**.
5. Confirm the created Secret Manager name:

```text
api-center-tribe-secret-<tribe-id>-<environment>
```

Steps from smoke tests:

1. Click **Generate secret**.
2. Click **Provision secret**.
3. Use the generated plaintext for token testing.

Expected Secret Manager payload:

```json
{
  "tribeId": "<owner-tribe-id>",
  "environment": "<test|live>",
  "provisionedForServiceIds": ["<service-id>"],
  "sourceServiceId": "<service-id>",
  "secretHashSha256": "<sha256 hash>",
  "status": "active",
  "rotationState": "active_current",
  "rotatedAt": "<timestamp>"
}
```

Rotation states:

- `active_current`: one active hash is accepted.
- `active_dual_valid`: the current hash and `nextSecretHashSha256` are both
  accepted while the tribe deploys the new SDK/runtime secret.
- `old_pending_revoke`: the tribe has verified the new secret and the old hash
  is still inside the confirmation window.
- `old_revoked`: the new hash has been promoted to `secretHashSha256`; the old
  hash is retained only as audit metadata and is no longer accepted.

After provisioning:

1. Grant API Center runtime access to that secret if it is not already bound:

```powershell
gcloud secrets add-iam-policy-binding api-center-tribe-secret-<tribe-id>-<environment> `
  --project apicenter-alpha-20260623 `
  --member="serviceAccount:api-center-gke@apicenter-alpha-20260623.iam.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor"
```

2. Request a token from the smoke-test page.
3. Remove any old `TRIBE_SECRET_<SERVICE_ID>` key from `api-center-prod` after
   the new per-tribe secret works.

Secret rotation workflow:

1. Generate the replacement plaintext value from the tribe detail page.
2. Store a dual-valid payload with the existing hash in `secretHashSha256`, the
   replacement hash in `nextSecretHashSha256`, and
   `rotationState: "active_dual_valid"`.
3. Give the replacement plaintext value to the tribe backend owner through the
   approved secret channel.
4. Ask the tribe to update `APICENTER_TRIBE_SECRET` and run SDK
   authentication against `/api/v1/auth/token`.
5. After the tribe confirms the new value works, mark the payload
   `old_pending_revoke` for the confirmation window.
6. Revoke the old hash by promoting the replacement hash to
   `secretHashSha256`, removing `nextSecretHashSha256`, and setting
   `rotationState: "old_revoked"`.
7. Record operator, tribe confirmation, Secret Manager version, and timestamp
   evidence in the audit log or linked ticket.

## Feature 8: Request A Tribe Token

Use this to confirm the tribe secret works.

Open:

```text
http://localhost:3000/smoke-tests?tribeId=<service-id>
```

Steps:

1. Enter the tribe ID.
2. Enter the plaintext tribe secret.
3. Click **Request token**.
4. Confirm the page shows token-in-memory status.

Important behavior:

- The plaintext secret is submitted only to the local token route.
- The token is kept in React memory only.
- Refreshing the page clears the token.

Expected result:

- API Center returns a temporary bearer token.

If it fails:

1. Confirm the tribe is registered.
2. Confirm the per-tribe Secret Manager secret exists.
3. Confirm API Center runtime has `roles/secretmanager.secretAccessor`.
4. Confirm no stale legacy `TRIBE_SECRET_*` value is taking precedence.
5. Confirm API Center is using `AUTH_PROVIDER=composite` or
   `AUTH_PROVIDER=internal-jwt`.

## Feature 8A: Deprovision A Tribe

Use **Deregister registry entry** only when you want API Center to stop listing
or routing a tribe while external artifacts remain preserved.

Use **Deprovision tribe** when you also need to clean up external artifacts.

Recommended default:

1. Delete the per-tribe Secret Manager secret to stop new token issuance.
2. Remove the tribe event topic from the S3 sink connector if future exports
   should stop.
3. Deregister the API Center registry entry.
4. Preserve the Confluent topic and S3 objects unless there is a separate
   data-retention approval.

What the Confluent buttons mean:

- **Provision topic** creates `tribe.<tribe-id>.events` for tribe-owned
  services. Microservices under the same owner share that topic and keep their
  registered backend ID as event `sourceServiceId`.
- Shared-service topic provisioning creates
  `api-center.shared.<service-id>.events` for shared services.
- **Add to S3 sink** updates the existing managed S3 Sink connector so that
  topic exports to S3.
- **Remove topic from S3 sink connector** stops future S3 exports for that
  topic. It does not delete the Confluent topic or historical S3 objects.

Open:

```text
http://localhost:3000/tribes/<service-id>?section=lifecycle
```

Steps:

1. Scroll to **Deprovision tribe**.
2. Select the cleanup actions you want.
3. Type the exact service ID to confirm.
4. Click **Run selected cleanup**.

Routine deprovisioning must not delete Confluent topics or S3 objects. Treat
those as data-retention actions, not app-lifecycle actions.

## Feature 9: Run Shared-Service Smoke Tests

Use this to test the shared-service proxy path.

Open:

```text
http://localhost:3000/smoke-tests?tribeId=<service-id>
```

Steps:

1. Request a tribe token first.
2. Run **safe checks**.
3. Confirm safe checks pass for:
   - `gauth-health`
   - `gauth-authorize`
   - `geo-health`
   - `geo-geofence`
   - `payment-health`
   - `email-health`
   - `sms-health`
   - `otp-health`
4. Only enable provider-impacting checks after confirming test provider config.

Provider-impacting checks:

- Payment checkout may create PayMongo checkout test data.
- Payment subscription smoke creates a customer, product, recurring price, and
  subscription, reads the subscription, cancels it, and reads it again.
- Email send may send a real or provider-mock email.
- SMS send may send through the SMS runtime.
- OTP generate may create an OTP record and may trigger delivery.

Payment subscription smoke:

1. Use this only in test unless live rollout has been explicitly approved.
2. Open `/smoke-tests?tribeId=<service-id>`.
3. Request a tribe token.
4. Run payment health smoke.
5. Enable provider-impacting checks.
6. Click **Run lifecycle** under payment subscription smoke.
7. Confirm customer, product, price, subscription, cancellation, analytics, and
   sanitized event export.

Expected result:

- Safe checks return HTTP 200 through API Center shared-service routes.
- Runtime usage appears in shared usage, audit, cost, and alerts surfaces after
  analytics data is recorded.

## Feature 10: Dependencies

Use this to inspect manifest relationships.

Open:

```text
http://localhost:3000/dependencies
```

Steps:

1. Review each service and the services it consumes.
2. Look for missing or broken target service IDs.
3. Click affected services and fix their `consumes` list.
4. Recheck the dependency map.

Expected result:

- Tribe dependencies point only to registered services.

## Feature 11: Shared Services Catalog

Use this to see the platform shared-service wrappers and required provider
signals.

Open:

```text
http://localhost:3000/shared-services
```

Steps:

1. Review each shared service:
   - `gauth`
   - `geo`
   - `payment`
   - `email`
   - `sms`
   - `otp`
2. Confirm registration state, owner/team, and health path.
3. Confirm route namespace:

```text
/api/v1/shared/<service-id>
```

4. Confirm provider secrets belong in `api-shared-services-prod`, not
   `api-center-prod`.
5. Click **Register manifest** or **Update manifest** when a shared-service
   manifest needs registry changes.
6. Click **View usage matrix** to check tribe usage.

Expected result:

- Shared service ownership and secret boundaries are clear.

## Feature 12: Shared-Service Setup

Use this when shared-service manifests need to be registered or reviewed.

Open:

```text
http://localhost:3000/shared-services/setup
```

Steps:

1. Review the expected shared-service manifests.
2. Confirm each shared runtime URL points to its internal Kubernetes service.
3. Confirm each shared service has `serviceType: "shared"`.
4. Register or update missing manifests.
5. Return to `/shared-services` and `/tribes` to confirm visibility.

Expected result:

- `gauth`, `geo`, `payment`, `email`, `sms`, and `otp` are registered and
  discoverable.

## Feature 13: Shared Usage Matrix

Use this to see which tribes use which shared services.

Open:

```text
http://localhost:3000/shared-services/usage
```

Steps:

1. Review registry-declared usage from `consumes`.
2. Compare against runtime call counts when analytics are available.
3. Identify tribes that declare shared services but have no recent usage.
4. Identify tribes that use shared services heavily.
5. Use this view before removing shared-service access from a tribe manifest.

Expected result:

- You can answer which tribe uses which shared service and how often.

## Feature 14: Audit Log

Use this to inspect recent operational events.

Open:

```text
http://localhost:3000/audit
```

Steps:

1. Review recent registry, proxy, Kafka, and readiness events.
2. Filter by service ID or event type if needed.
3. Use correlation/timestamp details to match smoke tests or incidents.
4. Check this after registering, updating, deprecating, retiring, or smoke
   testing a service.

Expected result:

- Recent operational changes are visible without checking pod logs first.

## Feature 15: Cost Signals

Use this to inspect provider-facing shared-service usage.

Open:

```text
http://localhost:3000/cost
```

Steps:

1. Review provider usage by shared service.
2. Look for high request volume or high error rate.
3. Check which tribes are driving usage.
4. Use the data before enabling provider-impacting smoke checks or live
   provider modes.

Expected result:

- You can identify which shared services and tribes are most likely to affect
  provider cost.

## Feature 16: Alerts

Use this to review read-only operational warnings.

Open:

```text
http://localhost:3000/alerts
```

Steps:

1. Review alerts by severity.
2. Check recommendations for missing owners, broken dependencies, unhealthy
   services, Kafka failures, readiness failures, or high error rates.
3. Open the affected service detail page.
4. Fix the manifest, dependency, secret, or runtime issue.
5. Recheck alerts after the next analytics/readiness refresh.

Payment alert response:

1. Open **Payment usage** from the alert action.
2. Confirm whether failures are isolated to one tribe or all payment consumers.
3. Open **Payment smoke** and run payment health first.
4. If health passes and this is test, enable provider-impacting checks and run
   the payment subscription lifecycle smoke.
5. Check API Center and payment-service logs for webhook signature failures,
   provider failures, or subscription cancellation errors.
6. If live subscription behavior is abnormal, set
   `PAYMENT_SUBSCRIPTIONS_ENABLED=false` and restart only `payment-service`.

Expected result:

- Known operational risks are visible in one place.

## Feature 17A: Registration Requests

Use this when a tribe repo submits `apicenter/service-manifest.json` through
the APICenter registration-request API.

Open:

```text
http://localhost:3000/registration-requests
```

Steps:

1. Review the pending service ID, owner tribe, base URL, `consumes`, and
   validation status.
2. Confirm the generated handoff values:

```text
APICENTER_TRIBE_ID=<owner-tribe-id>
APICENTER_SERVICE_ID=<service-id>
topic=tribe.<owner-tribe-id>.events
```

3. Confirm the owner tribe root registration already exists.
4. Click **Approve** only when the manifest is ready to become active registry
   state.
5. Enter a rejection reason and click **Reject** if the owner, dependency,
   route, scope, or base URL policy is not approved.

Expected result:

- Approval creates or updates the APICenter registry entry.
- Rejection records the reason and leaves the current registry unchanged.

## Feature 17: Manifest Tools

Use this for backup, review, and bulk import.

Open:

```text
http://localhost:3000/manifest-tools
```

Export steps:

1. Open the page.
2. Copy or download the registry JSON from **Export registry**.
3. Save it in an operator-controlled note or issue if needed.

Import steps:

1. Paste one manifest or an array of manifests.
2. Click **Validate dry run**.
3. Review creates and updates.
4. Click **Import manifests** only after the dry run looks correct.
5. Reopen `/tribes` and confirm the imported services.

Expected result:

- You can safely preview manifest changes before writing them to API Center.

Owner migration steps:

1. Export the current registry first.
2. Click **Prepare owner migration**.
3. Review the generated manifests with `ownerTribeId` filled in.
4. Resolve any manual review items. Hyphenated service IDs without a matching
   root tribe need an explicit owner decision.
5. Click **Validate dry run**.
6. Click **Import manifests** when the plan is applicable.

Use this to move old entries to the new model before switching consumers to:

```env
APICENTER_TRIBE_ID=<owner-tribe-id>
APICENTER_SERVICE_ID=<registered-backend-service-id>
```

## Feature 18: Settings

Use this to verify local configuration and restart API Center when needed.

Open:

```text
http://localhost:3000/settings
```

Steps:

1. Confirm API Center endpoint is correct.
2. Confirm platform secret is configured.
3. Confirm deployment restart status:
   - namespace: `api-center`
   - deployment: `api-center`
   - restart action: enabled only when `ALLOW_DEPLOYMENT_RESTARTS=true`
4. Use **Restart deployment** only after:
   - changing `api-center-prod`
   - deploying a new image
   - removing legacy env-backed secrets
5. Confirm rollout status is successful.

Expected result:

- Restart is available without giving the browser arbitrary shell access.

## Feature 19: Tribe SDK Installation And Runtime Setup

Use this when a tribe team is ready to consume API Center from its own backend.
The management console provisions API Center access; the tribe backend installs
and uses `@alpha-explora/apicenter`.

Operator prerequisites:

1. Register the tribe in `/tribes/new`.
2. Include every allowed target in the tribe manifest `consumes` list.
   - Shared-service examples: `payment`, `email`, `sms`, `gauth`, `otp`,
     `geo`.
   - Tribe-to-tribe example: `profile-service`.
3. Include Kafka scopes if the tribe will publish business events:
   - `external:kafka:read`
   - `external:kafka:write`
4. Generate and provision the per-tribe secret.
5. Give the tribe owner these values once:
   - API Center URL
   - registered service ID
   - one-time plaintext tribe secret
   - approved `consumes` list
   - approved scopes

Tribe repository setup:

Use `../api-shared-services/docs/consumer-runbook.md` as the canonical
step-by-step SDK install guide. It owns `.npmrc`, GitHub Packages read-token,
CI package install, runtime `APICENTER_*` values, and S3 validation details.

Tribe runtime environment:

```env
APICENTER_URL=https://api-center.itsandbox.site
APICENTER_ENVIRONMENT=test
APICENTER_TRIBE_ID=<owning-tribe-id>
APICENTER_SERVICE_ID=<registered-backend-service-id>
APICENTER_TRIBE_SECRET=<environment-scoped-secret-issued-by-platform>
```

Runtime rules:

- Do not put PayMongo, Resend, SMS, Google Maps, Google OAuth, Confluent, or S3
  provider credentials in tribe apps for shared-service calls.
- GitHub Packages auth is only for `npm install`.
- API Center runtime access still requires the registered environment, tribe ID, secret, scopes, and `consumes` policy.

Create the SDK client:

```ts
import { TribeClient } from "@alpha-explora/apicenter";

export const apiCenter = new TribeClient({
  gatewayUrl: process.env.APICENTER_URL!,
  environment: process.env.APICENTER_ENVIRONMENT as "test" | "live",
  tribeId: process.env.APICENTER_TRIBE_ID!,
  sourceServiceId: process.env.APICENTER_SERVICE_ID,
  secret: process.env.APICENTER_TRIBE_SECRET!,
});

await apiCenter.authenticate();
```

Expected result:

- The tribe backend can request a bearer token from
  `/api/v1/auth/token` through the SDK.
- Token failure means the API Center runtime environment, tribe ID, service ID, or secret value is wrong. It is not a GitHub Packages problem.

## Feature 20: Consume Shared Services Through The SDK

Use this when a tribe needs platform-owned services such as payment, email,
SMS, Google auth, OTP, or geo.

Operator setup:

1. Open `/tribes/<service-id>/edit`.
2. Add the shared service IDs to `consumes`.
3. Confirm required scopes include the scopes needed by the target services.
4. Save the manifest.
5. Open `/shared-services` and confirm the target shared services are
   registered as `serviceType: "shared"`.
6. Run safe smoke checks from `/smoke-tests?tribeId=<service-id>`.

Tribe implementation examples:

```ts
await apiCenter.emailSend({
  to: "customer@example.com",
  subject: "Welcome",
  body: "Thanks for joining.",
});
```

```ts
const checkout = await apiCenter.paymentCreateCheckoutSession({
  referenceId: "order-123",
  successUrl: "https://app.example.com/payment/success",
  cancelUrl: "https://app.example.com/payment/cancel",
  paymentMethods: ["card", "gcash", "maya", "grabpay", "qrph"],
  lineItems: [
    {
      name: "Starter Plan",
      quantity: 1,
      amount: { value: 99900, currency: "PHP" },
    },
  ],
});
```

```ts
const location = await apiCenter.geoReverseGeocode({
  latitude: 14.5995,
  longitude: 120.9842,
});
```

Generic fallback when a typed wrapper does not exist yet:

```ts
await apiCenter.callSharedService("email", "/send", {
  method: "POST",
  data: {
    to: "customer@example.com",
    subject: "Hello",
    body: "Message body",
  },
});
```

Runtime path:

```text
tribe backend
  -> @alpha-explora/apicenter
  -> API Center /api/v1/shared/<shared-service-id>/*
  -> auth, registry, consumes, scope, rate-limit, and proxy checks
  -> shared-service runtime
  -> provider API or platform implementation
```

Expected result:

- Shared-service calls return through API Center.
- Runtime usage appears in shared usage, audit, cost, and alerts after
  analytics data is recorded.
- A `403` means the tribe manifest is missing the target service in `consumes`
  or the token is missing the required scope.

## Feature 21: Expose A Tribe Service For Other Tribes

Use this when a tribe owns a backend API that other registered tribes should
consume through API Center.

Provider tribe steps:

1. Open `/tribes/new` or `/tribes/<service-id>/edit`.
2. Set `Service ID` to the stable target ID.
3. Set `Backend service URL` to the deployed backend URL API Center can reach.
4. Add health and business routes to `exposes`.
5. Add target-side scopes to `requiredScopes`.
6. Keep `serviceType` as `tribe`.
7. Save the manifest.
8. Run **Check health** from `/tribes/<service-id>`.

Consumer tribe steps:

1. Open `/tribes/<consumer-service-id>/edit`.
2. Add the provider service ID to the consumer manifest `consumes` list.
3. Confirm the consumer token gets the required target scopes.
4. Save the manifest.
5. Ask the consumer tribe to call the provider through the SDK:

```ts
const profile = await apiCenter.callService("profile-service", "/users/123", {
  method: "GET",
});
```

Runtime path:

```text
consumer tribe backend
  -> @alpha-explora/apicenter
  -> API Center /api/v1/tribes/<provider-service-id>/*
  -> auth, registry, consumes, scope, lifecycle, and proxy checks
  -> provider tribe backend
```

Expected result:

- The consumer never calls the provider backend URL directly.
- API Center blocks the call before proxying if `consumes` or scopes are wrong.

## Feature 22: Publish Tribe Data To S3 Through Governed Events

Use this when a tribe wants its business events exported to the S3 raw data
lake. Tribes do not receive Confluent or AWS credentials. They publish through
API Center, and the managed Confluent S3 Sink exports covered topics to S3.

Operator setup:

1. Open `/tribes/<service-id>?section=onboarding`.
2. Confirm the tribe has a working token.
3. If this is a microservice, confirm **Owner tribe ID** is set to the owning
   tribe principal. That owner controls the event topic and tribe visibility.
4. Confirm the manifest includes:
   - `external:kafka:read`
   - `external:kafka:write`
5. In **Confluent data pipeline**, click **Provision topic**.
6. Confirm the topic is created or already exists:

```text
tribe.<tribe-id>.events
```

7. Click **Add to S3 sink**.
8. Confirm the S3 sink result shows the connector now covers the topic.
9. If `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX` is configured, confirm the physical
   topic uses that prefix, for example:

```text
test.tribe.<tribe-id>.events
prod.tribe.<tribe-id>.events
```

Legacy topic migration:

1. If the card shows **Legacy topic detected**, review the old service topic
   and the new owner-tribe topic.
2. Click **Upgrade legacy topic**.
3. Confirm the result says the new tribe topic is prepared.
4. Keep the old service topic until producers have switched to
   `APICENTER_TRIBE_ID=<owner-tribe-id>` with
   `sourceServiceId=<registered-backend-service-id>`.
5. Remove the old topic from the S3 Sink only after no producers publish to it.

Tribe implementation:

```ts
await apiCenter.publishTribeEvent({
  sourceServiceId: process.env.APICENTER_SERVICE_ID ?? "orders-api",
  key: "order-123",
  eventType: "order.created",
  payload: {
    orderId: "order-123",
    amount: 99900,
    currency: "PHP",
  },
});
```

The tribe code should call `publishTribeEvent()`. It resolves the base topic
from `APICENTER_TRIBE_ID`, for example `tribe.<tribe-id>.events`, and API
Center applies the environment topic prefix such as `test.` or `prod.` when it
writes to Kafka. `sourceServiceId` identifies the specific microservice inside
the owning tribe.

Runtime path:

```text
tribe backend
  -> @alpha-explora/apicenter
  -> API Center POST /api/v1/kafka/publish
  -> API Center Kafka governance
  -> Confluent Cloud topic
  -> Confluent S3 Sink Connector
  -> s3://api-center-raw-data/topics/<topic-name>/...
```

Analytics ownership:

- Topic folder:
  `topics/<environment>.tribe.<tribe-id>.events/`
- Event attribution field:
  `governance.sourceServiceId`
- Primary BI filter:
  `tribeId`
- Secondary BI filter:
  `sourceServiceId`

Governance rules:

- Use `publishTribeEvent()` for normal tribe business events. It resolves the
  topic as `tribe.<APICENTER_TRIBE_ID>.events`.
- For diagnostics that need only the topic string, use
  `TribeClient.buildTribeEventTopic(<tribe-id>)`.
- Tribe topics must stay inside `tribe.<tribe-id>.*`.
- API Center blocks reserved prefixes such as `api-center.` and `__`.
- Published payloads must include `eventType` and an object `payload`.
- Use only sanitized business data. Do not publish raw secrets, OTP codes,
  OAuth tokens, API keys, raw email bodies, or raw SMS bodies.

Validation:

1. The SDK call returns `accepted: true`.
2. API Center audit/logs show `Kafka governed publish accepted`.
3. Confluent topic message count increases.
4. The `api-center-s3-sink` connector remains running.
5. S3 receives exported objects under the topic path after the connector flush
   interval or record threshold is reached.

Important timing note:

- The S3 sink may not write an object immediately after one event. The current
  connector can flush by interval or batch threshold, so validate with enough
  records or wait for the configured interval before treating S3 as broken.

## Full New-Tribe E2E Flow

Use this when onboarding a real tribe.

1. Start management locally.
2. Open `/readiness`.
3. Fix missing local env values.
4. Open `/tribes/new`.
5. Register the tribe manifest.
6. Open `/tribes/<service-id>`.
7. Open `/tribes/<service-id>?section=onboarding`.
8. Generate and provision the tribe secret.
9. Provision the tribe Confluent topic and add it to the S3 sink when needed.
10. Grant API Center runtime IAM access to the new per-tribe secret.
11. Give the plaintext secret to the tribe backend owner once.
12. Give the tribe owner the SDK installation and runtime values from Feature 19.
13. Tribe installs `@alpha-explora/apicenter` from GitHub Packages.
14. Tribe configures `APICENTER_URL`, `APICENTER_TRIBE_ID`,
    `APICENTER_SERVICE_ID`, and `APICENTER_TRIBE_SECRET`.
15. Tribe authenticates with `new TribeClient(...)`.
16. Tribe calls an allowed shared service or tribe service.
17. Tribe publishes a governed event with `publishTribeEvent()` if S3 export is
    required.
18. Open `/smoke-tests?tribeId=<service-id>`.
19. Request a token.
20. Run safe checks.
21. Open `/tribes/<service-id>?section=observability`.
22. Open `/shared-services/usage`.
23. Open `/audit?serviceId=<service-id>`.
24. Open `/alerts`.
25. Confirm Confluent and S3 export for any published tribe events.
26. Remove any legacy `TRIBE_SECRET_*` key for that tribe from
    `api-center-prod` after token verification succeeds.

## Full Tribe SDK To S3 E2E Flow

Use this when the desired outcome is: a tribe installs the SDK, consumes
platform services, exposes its own service through API Center, and publishes
business data to S3.

1. Operator starts `apicenter-management` locally.
2. Operator opens `/readiness` and fixes any API Center, GCP, or Confluent
   configuration gaps.
3. Operator opens `/shared-services/setup` and confirms required shared
   services are registered.
4. Operator opens `/tribes/new`.
5. Operator registers the tribe with:
   - stable `serviceId`
   - reachable backend `baseUrl`
   - health route in `exposes`
   - required shared services and target tribes in `consumes`
   - `external:kafka:read` and `external:kafka:write` if S3 export is needed
6. Operator opens `/tribes/<service-id>?section=onboarding`.
7. Operator generates and provisions the tribe secret.
8. Operator grants API Center runtime access to
   `api-center-tribe-secret-<tribe-id>-<environment>`.
9. Operator provisions `tribe.<tribe-id>.events`.
10. Operator adds `tribe.<tribe-id>.events` to `api-center-s3-sink`.
11. Operator gives the tribe owner:
    - `APICENTER_URL`
    - `APICENTER_TRIBE_ID`
    - `APICENTER_SERVICE_ID`
    - `APICENTER_TRIBE_SECRET`
    - approved `consumes` list
    - approved scopes
    - `.npmrc` GitHub Packages setup
12. Tribe follows `api-shared-services/docs/consumer-runbook.md` for SDK
    install and package-read auth.
13. Tribe creates a `TribeClient`.
14. Tribe calls `authenticate()` during startup or lets the first SDK call
    authenticate lazily.
15. Tribe consumes shared services with typed SDK wrappers such as
    `emailSend()`, `paymentCreateCheckoutSession()`, `smsSend()`,
    `gauthExchangeCode()`, `otpGenerate()`, or `geoReverseGeocode()`.
16. Tribe exposes its own backend routes by keeping the API Center manifest
    `exposes` list current.
17. Other tribes consume that service with `callService()` after their manifests
    include the provider service ID in `consumes`.
18. Tribe publishes business events with `publishTribeEvent()`.
19. Operator verifies API Center accepted the event.
20. Operator verifies Confluent topic traffic.
21. Operator verifies `api-center-s3-sink` remains running and includes the
    tribe topic.
22. Operator verifies objects appear in
    `s3://api-center-raw-data/topics/<topic-name>/...`.

## Full Smoke-Test E2E Flow

Use this for platform validation.

1. Open `/tribes/new`.
2. Apply **Smoke preset**.
3. Register `smoke-tribe`.
4. Open `/smoke-tests?tribeId=smoke-tribe`.
5. Generate and provision the smoke secret.
6. Request a token.
7. Run safe checks.
8. Confirm safe checks pass.
9. Open `/shared-services/usage`.
10. Open `/audit`.
11. Open `/cost`.
12. Open `/alerts`.

## Troubleshooting

### Readiness Fails

Check `.env.local`:

```env
API_CENTER_BASE_URL=https://api-center.itsandbox.site
API_CENTER_PLATFORM_ADMIN_SECRET=<platform-admin-secret>
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
```

Do not set `NEXT_PUBLIC_API_CENTER_PLATFORM_ADMIN_SECRET`.

### Secret Provisioning Fails

Check local GCP auth:

```powershell
gcloud config set project apicenter-alpha-20260623
gcloud auth application-default login
```

Check `.env.local`:

```env
GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623
TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
```

If the app is deployed in GKE, check:

- pod uses `serviceAccountName: apicenter-management`
- Kubernetes service account has the Workload Identity annotation
- Google service account has Secret Manager permissions
- Workload Identity binding exists for
  `apicenter-alpha-20260623.svc.id.goog[api-center/apicenter-management]`

### Token Request Fails

Check:

- Tribe is registered.
- Environment-scoped Secret Manager secret exists, for example `api-center-tribe-secret-<tribe-id>-<test|live>`.
- API Center runtime service account has secret accessor role.
- `api-center-prod` has resolver keys.
- Legacy `TRIBE_SECRET_*` is not overriding the new per-tribe secret with an old
  hash.
- API Center was restarted after platform config changes.

### Shared-Service Smoke Checks Fail

Check:

- The tribe manifest includes the shared service in `consumes`.
- The shared-service manifest exists with `serviceType: "shared"`.
- Shared-service deployment is healthy in GKE.
- Provider secrets exist in `api-shared-services-prod`.
- API Center proxy analytics/audit logs show the failure.

### SDK Install Fails

Check:

- `.npmrc` points `@implementsprint` to `https://npm.pkg.github.com`.
- `GITHUB_TOKEN` is set only for install time.
- Token has `read:packages` and access to the `ImplementSprint` package.
- The package name is `@alpha-explora/apicenter`.
- The consuming app uses Node 24 for the current SDK release.

Separate this from runtime access. A package install failure is GitHub Packages
auth or package visibility; it is not API Center auth.

### SDK Runtime Call Fails

Check:

- `APICENTER_URL` points to API Center, not a shared-service runtime.
- `APICENTER_TRIBE_ID` matches the owning tribe principal.
- `APICENTER_SERVICE_ID` matches the registered backend service ID when it is
  different from the tribe ID.
- `APICENTER_TRIBE_SECRET` is the current plaintext secret issued by platform.
- The per-tribe Secret Manager record contains the matching SHA-256 hash.
- The target service is listed in the caller manifest `consumes`.
- The token includes the target service scopes.
- API Center audit/proxy logs show whether the call was rejected before
  proxying or failed in the upstream runtime.

### Kafka Publish Or S3 Export Fails

Check:

- The tribe token has `external:kafka:write`.
- The topic starts with `tribe.<tribe-id>.`.
- The payload has `eventType` and object `payload`.
- API Center `KAFKA_TOPIC_PREFIX` and management
  `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX` agree for test or production.
- The tribe topic exists in Confluent.
- The S3 sink connector includes the tribe topic.
- The connector is `RUNNING`.
- S3 validation waited for the connector flush interval or enough records.

### Deployment Restart Fails

Check:

```env
ALLOW_DEPLOYMENT_RESTARTS=true
K8S_NAMESPACE=api-center
K8S_API_CENTER_DEPLOYMENT=api-center
```

Then check kubectl:

```powershell
kubectl config current-context
kubectl -n api-center get deployment api-center
```

## Related Docs

- [UX Flow Snapshot](C:/Codes/apic/apicenter-management/docs/operations/ux-flow-snapshot.md)
- [UI QA Checklist](C:/Codes/apic/apicenter-management/docs/operations/ui-qa-checklist.md)
- [Local Smoke Testing](C:/Codes/apic/apicenter-management/docs/operations/local-smoke-testing.md)
- [Tribe SDK Consumption Guide](C:/Codes/apic/api-shared-services/docs/tribe-sdk-consumption.md)
- [SDK Shared Services Guide](C:/Codes/apic/api-shared-services/docs/sdk-shared-services-apicenter-guide.md)
- [Confluent Cloud To S3 Setup](C:/Codes/apic/api-center/docs/confluent-cloud-s3-sink-setup.md)
- [Tribe Secret Automation Plan](C:/Codes/apic/apicenter-management/docs/superpowers/plans/2026-05-14-tribe-secret-automation-and-rollouts.md)
- [Management UX Flow Improvements Plan](C:/Codes/apic/apicenter-management/docs/superpowers/plans/2026-05-14-management-ux-flow-improvements.md)


