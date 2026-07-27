# APICenter Console

This console is now managed as the api-center monorepo workspace at
apps/management. The former standalone apicenter-management checkout is the
migration source; make new Management changes in this workspace.


Operator console for managing APICenter service registration, shared-service access, lifecycle state, registry health, dependencies, SDK onboarding, and manifest import/export.

The browser UI proxies registry calls through Next.js server route handlers so `X-Platform-Secret` is never exposed to browser JavaScript.

## Deployment Status

Vercel is the current default hosting target for the console UI when APICenter
admin endpoints are reachable from Vercel. Private GKE is a fallback for
network-private admin endpoints, Workload Identity-only operations, or Vercel
runtime limits.

APICenter production now serves the public
`https://api-center.itsandbox.site` front door from Cloud Run. APICenter Console must
continue to use the public APICenter URL; direct Cloud Run service URLs are for
operator diagnostics only. GKE remains rollback infrastructure during the API
Center seven-day post-cutover retention window.

Current deployment:

```text
project: ele-3-ap-i-center/apicenter-management-test
url: https://api-center-management-test.itsandbox.site
management environment: test
auth: google
apicenter api: https://api-center.itsandbox.site
```

Cloud Run operator check:

```powershell
gcloud.cmd run services describe api-center --project=apicenter-alpha-20260623 --region=asia-southeast1 --format="value(status.url,status.latestReadyRevisionName)"
```

Expected current state: Cloud Run service `api-center` is healthy, and
APICenter Console continues to point at the public
`https://api-center.itsandbox.site` front door.

The old `api-center-test.itsandbox.site` API Center lane is retired. Operators
should use the single APICenter URL and choose `test` or `live` through the
APICenter token/environment flow. Payment is split behind APICenter into the
internal `payment-test` and `payment-live` runtimes.

## Architecture Decision

- API Center keeps the business logic and registry authority.
- This directory hosts the management UI.
- The initial frontend should use Next.js with shadcn/ui components.
- A separate NestJS backend should not be created unless API Center cannot safely expose the required admin endpoints or a dedicated backend-for-frontend becomes necessary.

## Plans

See:

- `docs/superpowers/plans/README.md`

UX reference:

- `docs/operations/ux-flow-snapshot.md`
- `docs/operations/ui-qa-checklist.md`

## Local Setup

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Required local env:

```env
API_CENTER_BASE_URL=https://api-center.itsandbox.site
API_CENTER_PLATFORM_ADMIN_SECRET=
NEXT_PUBLIC_API_CENTER_BASE_URL=https://api-center.itsandbox.site
MANAGEMENT_AUTH_MODE=local-dev
MANAGEMENT_ENVIRONMENT=test
MANAGEMENT_PUBLIC_BASE_URL=http://localhost:3000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_ID=
GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623
GCP_IMPERSONATE_SERVICE_ACCOUNT=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com
TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
CONFLUENT_ENVIRONMENT_ID=
CONFLUENT_KAFKA_CLUSTER_ID=
CONFLUENT_KAFKA_REST_ENDPOINT=
CONFLUENT_KAFKA_API_KEY=
CONFLUENT_KAFKA_API_SECRET=
CONFLUENT_CLOUD_API_KEY=
CONFLUENT_CLOUD_API_SECRET=
CONFLUENT_S3_CONNECTOR_NAME=api-center-s3-sink
```

Copy `.env.example` to `.env.local` and fill `API_CENTER_PLATFORM_ADMIN_SECRET` from the API Center production secret manager value. Do not commit `.env.local`.

Secret Manager provisioning can use the same provisioner IAM identity locally.
The recommended local path is gcloud service-account impersonation:

```powershell
gcloud config set project apicenter-alpha-20260623
gcloud auth print-access-token --impersonate-service-account=apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com
```

If that command fails, grant your Google user
`roles/iam.serviceAccountTokenCreator` on the provisioner service account.

For deployed GKE fallback usage, do not put a service account JSON key in env.
Use the Workload Identity manifests and setup notes in `infra/gcp/gke/README.md`.

## Current Features

- **Registry dashboard:** live totals for tribe services, shared services, unhealthy services, missing owners, and broken dependencies.
- **Registry browser:** searchable and filterable service list grouped by owner/team.
- **Registration flow:** local form that submits service manifests to API Center through the server proxy.
- **Smoke tribe preset:** `/tribes/new` can prefill a local `smoke-tribe` manifest with shared-service consumption already selected.
- **Edit flow:** existing service manifests can be loaded, edited, and resubmitted through the same API Center register/upsert path.
- **Health checks:** service detail pages can run server-side health checks against the service `baseUrl` plus `healthCheck` path.
- **Lifecycle safety:** retire and deregister actions require typing the service ID and show current consumers before execution.
- **Dependency map:** `/dependencies` shows `consumes` relationships and missing target services.
- **SDK panel:** service detail pages generate the basic SDK install command, required env values, and a sample tribe-to-tribe call based on the manifest.
- **Event mapping:** service detail pages show the expected Confluent topics that feed the S3 data lake.
- **Manifest tools:** `/manifest-tools` can export registry JSON and import one or more service manifests.
- **Readiness checks:** `/readiness` verifies API Center reachability, protected registry access, missing env values, and local proxy safety.
- **Shared-service catalog:** `/shared-services` shows registration state, owner/team, health path, required secret signals, and setup/detail actions for `gauth`, `geo`, `payment`, `email`, `sms`, and `otp`.
- **Shared-service setup:** `/shared-services/setup` preloads manifests for `gauth`, `geo`, `payment`, `email`, `sms`, and `otp`.
- **Shared-service usage matrix:** `/shared-services/usage` shows which tribe manifests declare consumption of `gauth`, `geo`, `payment`, `email`, `sms`, and `otp`, and overlays runtime call counts/error rates from API Center when `/api/v1/analytics/shared-service-usage` is deployed.
- **Shared-service smoke tests:** `/smoke-tests` requests a temporary tribe token through the local server proxy, then runs allowlisted shared-service checks against API Center.
- **Tribe observability:** tribe detail pages show declared shared services, actual shared-service calls, undeclared runtime usage, failures, latency, and last-used timestamps.
- **Shared-service observability:** shared-service detail pages show consuming tribes, runtime callers, total calls, error rate, latency, and setup risks such as missing health paths or undeclared callers.
- **Gateway traffic:** the dashboard shows protected API Center traffic analytics, including proxy volume, tribe-to-tribe traffic, tribe-to-shared traffic, 4xx/5xx counts, Kafka publish failures, readiness failures, and p95 latency.
- **Audit viewer:** `/audit` shows recent registry, proxy, Kafka, and readiness events with filters by service ID and event type.
- **Cost signals:** `/cost` groups shared-service runtime usage by provider-facing service so provider-cost drivers are visible without pulling cloud billing data into the local console.
- **Operational alerts:** `/alerts` and the dashboard alert strip show read-only alerts for high shared-service error rates, undeclared runtime usage, Kafka publish failures, readiness failures, and registry setup risks.
- **Guided onboarding:** tribe detail pages group overview, onboarding, observability, lifecycle, and developer tools into task sections.
- **Onboarding checklist:** service detail pages show owner, health, dependency, SDK, secret, Confluent, smoke-test, usage, and audit readiness.
- **Contract tester:** service detail pages can test direct backend reachability and optionally proxy reachability using a temporary bearer token.
- **Manifest safety:** edit pages show before/after manifest diffs; import tools support dry-run validation before submit.
- **UX flow snapshot:** `docs/operations/ux-flow-snapshot.md` records the current information architecture, redundancies, and recommended next flow improvements.

## Local Proxy Model

Browser code calls only this app's `/api/local/*` route handlers. Those route handlers run on the Next.js server, attach `X-Platform-Secret`, and call API Center protected registry endpoints.

This keeps `API_CENTER_PLATFORM_ADMIN_SECRET` server-only. Do not move that value to any `NEXT_PUBLIC_*` variable.

## Readiness Checks

Open `http://localhost:3000/readiness` after creating `.env.local`.

The page checks:

- `API_CENTER_BASE_URL` is configured.
- `API_CENTER_PLATFORM_ADMIN_SECRET` is configured server-side.
- API Center `/api/v1/health/ready` responds.
- Protected registry list access works.
- No `NEXT_PUBLIC_API_CENTER_PLATFORM_ADMIN_SECRET` value is present.

Readiness failures are local setup signals. They do not change API Center state.

## Shared Services Setup

Open `http://localhost:3000/shared-services/setup` to review and register the shared-service manifests for:

- `gauth`
- `geo`
- `payment`
- `email`
- `sms`
- `otp`

The setup page submits selected manifests through the same local register proxy as the standard service form.

## Contract Testing

The contract tester on a service detail page performs:

- a direct backend request to the registered `baseUrl` plus selected route
- an optional API Center proxy request to `/api/v1/tribes/:serviceId/*` or `/api/v1/shared/:serviceId/*`

Proxy testing requires a temporary bearer token pasted into the form. The console does not store that token or keep request history.

## Local Smoke Testing

Open `http://localhost:3000/smoke-tests` to request a temporary tribe token and
run safe shared-service checks. See
`docs/operations/local-smoke-testing.md` for the full flow, including the
`api-center-tribe-secret-smoke-tribe` Secret Manager prerequisite.

Safe checks are visible first. Provider-impacting checks stay behind an
explicit confirmation and expandable section.

## Pipeline Visibility And Provisioning

Registry rows and service detail pages show deterministic topic names such as
`tribe.<tribeId>.events`, `api-center.tribe.request`,
`api-center.tribe.response`, and `api-center.audit.log`. For a registered
microservice, `ownerTribeId ?? serviceId` is the tribe topic owner and the
microservice identity is carried as `sourceServiceId`.

For local/private operator use, this app can hold server-only Confluent Cloud
credentials in `.env.local` so it can create tribe topics and update the
existing S3 sink connector. These values are never exposed as `NEXT_PUBLIC_*`
variables and should not be given to tribes.

Tribes still publish through API Center and the SDK. They never receive
Confluent credentials.

## Database Visibility

The current management console reads API Center runtime/admin endpoints. It does
not connect directly to Postgres. API Center's optional control-plane schemas
and the shared-service business schemas can be introduced later through Cloud
SQL, but Redis remains the active API Center registry source until the database
cutover plan is completed.

## Private GKE Deployment Identity

Private GKE is a fallback deployment target. Use it when admin endpoints are
network-private or an operation requires Workload Identity from inside the
cluster. The management app can then use GKE Workload Identity so it is already
authenticated to GCP Secret Manager:

- Kubernetes service account: `api-center/apicenter-management`
- Google service account:
  `apicenter-mgmt-provisioner@apicenter-alpha-20260623.iam.gserviceaccount.com`
- Manifest directory: `infra/gcp/gke`

The pod should set `serviceAccountName: apicenter-management` and keep only
non-secret GCP config such as `GOOGLE_CLOUD_PROJECT=apicenter-alpha-20260623` in env.
Do not use `GOOGLE_APPLICATION_CREDENTIALS` or a service account key file in
GKE.

## Deployment Gate

## Deployment Safety Gate

- `MANAGEMENT_AUTH_MODE=google` is set outside local development.
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is configured for the browser login button.
- Platform/provider secrets are not exposed through `NEXT_PUBLIC_*` variables.
- All server-side write routes call the shared action authorization guard.
- Live writes require typed confirmation and an operator reason.
- Route smoke, unit tests, typecheck, and production build pass.

Local development can use `MANAGEMENT_AUTH_MODE=local-dev`, but that mode must not be used in deployed test or live environments.
## Payment consumer provisioning

Open /shared-services/setup to register a payment consumer, optionally
provision its Google Pub/Sub push subscription, or rotate its APICenter API
key. The plaintext key is returned once and is not persisted by Management.

The server requires:

- API_CENTER_BASE_URL or APICENTER_GATEWAY_URL
- API_CENTER_PLATFORM_ADMIN_SECRET or APICENTER_PLATFORM_SECRET, unless an
  APICENTER_OPERATOR_TOKEN is configured

Payment write routes use the existing Management session and audited action
authorization. Configure MANAGEMENT_AUTH_MODE=local-dev only for local test
development; deployed environments must use Google authentication.
