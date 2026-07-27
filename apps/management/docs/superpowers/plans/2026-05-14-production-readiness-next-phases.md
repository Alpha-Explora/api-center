# API Center Production Readiness Next Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move API Center and the local management layer from implemented observability features to production-validated shared-service operations, provider telemetry, and a future public management-console gate.

**Architecture:** API Center remains the runtime authority for registry, proxying, analytics, alerts, and audit data. `apicenter-management` stays local/private until admin auth exists, and it reads production through protected API Center admin endpoints using `API_CENTER_PLATFORM_ADMIN_SECRET`. Provider-specific runtime metrics should originate in `api-shared-services` and flow through API Center analytics/audit events.

**Tech Stack:** NestJS 11, Next.js 16 with Turbopack, React 19, TanStack Query, shadcn/ui, GKE, GCP Secret Manager, Redis/Memorystore, Confluent Cloud Kafka.

---

## Current State

- This plan starts after local smoke testing passes.
- Preceding phase order:
  1. Internal tribe token auth: completed and deployed.
  2. Local shared-service smoke testing: current operator phase.
  3. Production readiness: this plan.
- API Center runtime analytics endpoints are implemented and pushed:
  - `/api/v1/analytics/shared-service-usage`
  - `/api/v1/analytics/gateway-traffic`
  - `/api/v1/analytics/provider-usage`
  - `/api/v1/analytics/alerts`
  - `/api/v1/analytics/audit/events`
- `apicenter-management` pages are implemented and pushed:
  - `/`
  - `/shared-services/usage`
  - `/audit`
  - `/cost`
  - `/alerts`
  - tribe detail observability panel
  - shared-service detail observability panel
- Management console is intentionally local/private.
- Provider-operation telemetry is still baseline only. Exact operation names such as `paymongo.checkout.created` or `otp.verify.failed` need shared-service runtime emission.
- Tribe Confluent topic provisioning is implemented in the local management
  console. Use each tribe detail page to create `tribe.<serviceId>.events` and
  include it in the `api-center-s3-sink` connector before S3/data-lake
  validation.

## Phase 1: Deploy API Center Analytics Runtime

**Outcome:** The live `https://api-center.itsandbox.site` API Center deployment serves the new analytics, audit, and alert endpoints.

**Repos:**

- `C:\Codes\apic\api-center`

**Files to check before deploy:**

- `k8s/`
- `docs/deployment-gke.md`
- `src/analytics/analytics.controller.ts`
- `src/analytics/gateway-traffic.service.ts`
- `src/analytics/audit-events.service.ts`

### Tasks

- [x] Confirm local branch is clean.

```powershell
cd C:\Codes\apic\api-center
git status --short
git log -1 --oneline
```

Expected:

```text
8a15338 Add-operational-analytics-endpoints
```

- [x] Build and test before deploy.

```powershell
npm run lint
npx jest --runInBand analytics.controller.spec.ts shared-service-usage.service.spec.ts shared-services.controller.spec.ts proxy-handler.spec.ts tribes.controller.spec.ts health.controller.spec.ts registry.controller.spec.ts
npm run build
```

Expected:

```text
Test Suites: 7 passed
```

`npm run lint` may show existing warnings, but it must exit with code `0`.

- [x] Deploy using the existing GKE deployment flow.

Use the current project deployment command from `C:\Codes\apic\api-center\docs\deployment-gke.md`. Do not change secrets during this task unless the deploy fails because a required secret key is missing.

- [x] Verify API Center readiness after deploy.

```powershell
$base = "https://api-center.itsandbox.site"
Invoke-WebRequest -UseBasicParsing "$base/api/v1/health/ready"
```

Expected:

```text
StatusCode: 200
```

- [x] Verify protected analytics endpoints.

```powershell
$base = "https://api-center.itsandbox.site"
$secret = "<platform-admin-secret-from-secret-manager>"
$headers = @{ "X-Platform-Secret" = $secret }

Invoke-RestMethod "$base/api/v1/analytics/shared-service-usage?window=24h" -Headers $headers
Invoke-RestMethod "$base/api/v1/analytics/gateway-traffic?window=24h" -Headers $headers
Invoke-RestMethod "$base/api/v1/analytics/provider-usage?window=24h" -Headers $headers
Invoke-RestMethod "$base/api/v1/analytics/alerts?window=1h" -Headers $headers
Invoke-RestMethod "$base/api/v1/analytics/audit/events?limit=25" -Headers $headers
```

Expected:

```text
Each response has success = true.
Each data field is an array or object matching the endpoint purpose.
Empty arrays are acceptable before live traffic exists.
```

- [x] Commit only if deployment docs or scripts changed.

```powershell
git add docs/deployment-gke.md k8s
git commit -m Update-api-center-deployment-notes
git push
```

Skip this commit if no files changed.

## Phase 2: Register And Validate Shared-Service Runtimes

**Outcome:** `gauth`, `geo`, `payment`, `email`, `sms`, and `otp` are registered as shared services and reachable through API Center.

**Repos:**

- `C:\Codes\apic\api-shared-services`
- `C:\Codes\apic\apicenter-management`

**Required registry service IDs:**

```text
gauth
geo
payment
email
sms
otp
```

### Tasks

- [x] Open local management console.

```powershell
cd C:\Codes\apic\apicenter-management
npm run dev -- -p 3002
```

Open:

```text
http://localhost:3002/shared-services/setup
```

- [x] Register any missing shared-service manifests from the setup page.

Expected:

```text
All six shared services show as registered.
Each registered entry has serviceType = shared.
```

- [x] Validate service details.

Open each page:

```text
http://localhost:3002/tribes/gauth
http://localhost:3002/tribes/geo
http://localhost:3002/tribes/payment
http://localhost:3002/tribes/email
http://localhost:3002/tribes/sms
http://localhost:3002/tribes/otp
```

Expected:

```text
Each page shows Shared-service observability.
Each page has owner/contact, base URL, health path, and event topics.
```

- [x] Run health checks from each service detail page.

Expected:

```text
Healthy shared services return success.
Failures show the exact backend URL and health path that need fixing.
```

- [x] Confirm shared-service secrets are mounted in the runtime deployment.

Check the runtime deployment env source points to:

```text
api-shared-services-prod
```

Expected key groups:

```text
REDIS_URL
PAYMONGO_TEST_SECRET_KEY
PAYMONGO_LIVE_SECRET_KEY
PAYMONGO_TEST_WEBHOOK_SECRET
PAYMONGO_LIVE_WEBHOOK_SECRET
RESEND_API_KEY
EMAIL_FROM_ADDRESS
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI
GOOGLE_MAPS_API_KEY
```

- [ ] Commit only if manifests or docs changed.

```powershell
git add .
git commit -m Update-shared-service-registration-state
git push
```

Skip this commit if no files changed.

## Phase 3: Live Traffic Smoke Tests

**Outcome:** Real shared-service traffic appears in usage, audit, gateway traffic, cost, and alerts surfaces.

**Repos:**

- `C:\Codes\apic\api-center`
- `C:\Codes\apic\apicenter-management`

### Tasks

- [ ] Prefer the local smoke-test console for the happy path.

Open:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Expected:

```text
The page can request a temporary tribe token and run allowlisted safe checks for
gauth, geo, payment, email, sms, and otp through API Center.
```

Prerequisite:

```text
API Center should use AUTH_PROVIDER=composite or AUTH_PROVIDER=internal-jwt.
The smoke tribe needs `api-center-tribe-secret-smoke-tribe` in Secret Manager,
but it does not need a Descope Inbound App or per-tribe Descope client secret.
```

- [ ] Create or reuse a test tribe registration.

The test tribe must declare at least one shared service in `consumes`, for example:

```json
{
  "serviceId": "smoke-tribe",
  "name": "Smoke Tribe",
  "serviceType": "tribe",
  "baseUrl": "https://example.com",
  "healthCheck": "/health",
  "consumes": ["geo", "email", "payment"],
  "owner": {
    "team": "API Center",
    "email": "platform@itsandbox.site"
  }
}
```

- [ ] Run one successful shared-service call through API Center.

Use the actual shared-service endpoint that is safest in production. Prefer a read-only route such as geo lookup or Google auth authorization URL generation.

Example shape:

```powershell
$base = "https://api-center.itsandbox.site"
$token = "<valid tribe bearer token>"
$headers = @{ "Authorization" = "Bearer $token" }

Invoke-RestMethod "$base/api/v1/shared/geo/health" -Headers $headers
```

Expected:

```text
The response is successful or returns a clear service-level response.
```

- [ ] Provision the tribe event topic and S3 sink inclusion.

Open:

```text
http://localhost:3000/tribes/smoke-tribe
```

Use the **Confluent data pipeline** card:

```text
Provision topic
Add to S3 sink
```

Expected:

```text
tribe.smoke-tribe.events exists in Confluent Cloud.
api-center-s3-sink includes tribe.smoke-tribe.events.
```

- [ ] Run one controlled failed call.

Use an invalid shared-service route:

```powershell
$base = "https://api-center.itsandbox.site"
$token = "<valid tribe bearer token>"
$headers = @{ "Authorization" = "Bearer $token" }

try {
  Invoke-RestMethod "$base/api/v1/shared/geo/__missing_route_for_smoke_test" -Headers $headers
} catch {
  $_.Exception.Response.StatusCode.value__
}
```

Expected:

```text
The call returns a 4xx or 5xx without crashing API Center.
```

- [ ] Confirm management usage changed.

Open:

```text
http://localhost:3000/shared-services/usage
http://localhost:3000/tribes/smoke-tribe
http://localhost:3000/tribes/geo
```

Expected:

```text
The selected window shows non-zero runtime calls.
Last-used timestamp updates.
Failed calls increase after the controlled failed call.
```

- [ ] Confirm audit and gateway traffic.

Open:

```text
http://localhost:3000/audit
http://localhost:3000/
```

Expected:

```text
Audit events include shared_service.call or tribe_service.call entries.
Gateway traffic cards show increased proxy request count.
```

- [ ] Confirm alerts behavior.

Open:

```text
http://localhost:3002/alerts
```

Expected:

```text
No critical alert appears for normal success traffic.
A controlled failure can produce a warning if it affects the one-hour error-rate threshold.
```

## Phase 4: Provider Operation Telemetry

**Outcome:** Cost and audit views distinguish provider operations, not only shared-service totals.

**Repos:**

- `C:\Codes\apic\api-shared-services`
- `C:\Codes\apic\api-center`
- `C:\Codes\apic\apicenter-management`

**Provider operation event names:**

```text
gauth.oauth.start
gauth.oauth.callback
gauth.oauth.refresh
gauth.oauth.failure
geo.geocode
geo.reverse_geocode
paymongo.checkout.create
paymongo.payment.retrieve
paymongo.refund.create
paymongo.webhook.received
paymongo.webhook.failed
email.send
sms.send
otp.issue
otp.verify
otp.resend
otp.rate_limit_hit
```

### Tasks

- [ ] Add shared-service runtime tests for provider event emission.

For each gateway, write tests that assert the provider operation name is emitted when the route handler succeeds or fails.

Expected:

```text
Each provider-backed shared service has at least one operation telemetry test.
```

- [ ] Add provider operation metadata to emitted runtime/audit events.

Each shared-service runtime should emit:

```json
{
  "serviceId": "payment",
  "operation": "paymongo.checkout.create",
  "tribeServiceId": "campusone",
  "status": 200,
  "ok": true,
  "latencyMs": 120,
  "timestamp": "2026-05-14T10:00:00.000Z"
}
```

- [ ] Extend API Center provider usage schema.

Add operation breakdown to `/api/v1/analytics/provider-usage`:

```json
{
  "serviceId": "payment",
  "provider": "PayMongo",
  "totalRequests": 50,
  "failedRequests": 2,
  "operations": [
    {
      "operation": "paymongo.checkout.create",
      "totalRequests": 30,
      "failedRequests": 1
    }
  ]
}
```

- [ ] Extend `/cost` UI.

Show operation-level rows under each provider service:

```text
Provider
Operation
Calls
Failures
Error rate
Top tribe
```

- [ ] Verify.

```powershell
cd C:\Codes\apic\api-center
npm run lint
npm test
npm run build

cd C:\Codes\apic\apicenter-management
npm run lint
npm run build
```

- [ ] Commit and push each repo.

```powershell
git add .
git commit -m Add-provider-operation-telemetry
git push
```

## Phase 5: Management Console Auth Gate

**Outcome:** The management console has a clear path to public deployment, but remains private until auth is complete.

**Repo:**

- `C:\Codes\apic\apicenter-management`

### Tasks

- [ ] Decide management-console human auth source.

Use Descope admin login for human administrators. This is separate from tribe
machine-to-machine tokens, which should be issued by API Center internal JWT
mode.

Required values:

```text
NEXT_PUBLIC_DESCOPE_PROJECT_ID
DESCOPE_PROJECT_ID
DESCOPE_MANAGEMENT_KEY or equivalent server-side admin verification secret
```

- [ ] Add auth plan document before implementation.

Create:

```text
C:\Codes\apic\apicenter-management\docs\superpowers\plans\2026-05-14-management-auth-gate.md
```

The plan must include:

```text
login route
session storage
server-side route protection
admin role check
logout
read-only versus write-action authorization
deployment environment variables
```

- [ ] Keep current deployment gate in README.

Do not remove this warning until auth is implemented:

```text
Do not deploy this publicly until admin auth and admin-role checks are wired.
```

- [ ] Implement only after the auth plan is approved.

Expected first protected routes:

```text
/
/tribes
/shared-services
/audit
/cost
/alerts
/settings
```

- [ ] Verify auth before public deployment.

Expected:

```text
Anonymous users cannot load management data.
Non-admin users cannot call write route handlers.
API_CENTER_PLATFORM_ADMIN_SECRET remains server-only.
```

## Phase 6: Production Monitoring And Runbooks

**Outcome:** Operators know how to respond when alerts appear.

**Repos:**

- `C:\Codes\apic\api-center`
- `C:\Codes\apic\apicenter-management`

### Tasks

- [ ] Add alert runbook document.

Create:

```text
C:\Codes\apic\api-center\docs\operations\analytics-alert-runbook.md
```

Include exact response steps for:

```text
shared-service error rate > 5%
Kafka publish failures > 0
readiness failures > 0
undeclared shared-service runtime usage
shared service has consumers but no health path
tribe has no owner/contact
PayMongo webhook failures > 0
OTP rate-limit spikes
```

- [ ] Add dashboard verification checklist.

Create:

```text
C:\Codes\apic\apicenter-management\docs\operations\management-dashboard-checklist.md
```

Include:

```text
daily checks
weekly checks
what counts as healthy
what requires deployment rollback
what requires provider-secret rotation
```

- [ ] Verify docs link from READMEs.

Update:

```text
C:\Codes\apic\api-center\README.md
C:\Codes\apic\apicenter-management\README.md
```

- [ ] Commit and push docs.

```powershell
git add docs README.md
git commit -m Add-analytics-operations-runbooks
git push
```

## Execution Order

0. Complete `docs/operations/local-smoke-testing.md`.
1. Phase 1: confirm/deploy API Center analytics runtime if the live image is behind.
2. Phase 2: register and validate shared-service runtimes.
3. Phase 3: run live traffic smoke tests.
4. Phase 4: add provider operation telemetry.
5. Phase 6: add monitoring runbooks.
6. Phase 5: implement management auth gate before any public deployment.

## Verification Gates

Every code phase must pass:

```powershell
npm run lint
npm run build
```

API Center behavior phases must also pass:

```powershell
npx jest --runInBand analytics.controller.spec.ts shared-service-usage.service.spec.ts shared-services.controller.spec.ts proxy-handler.spec.ts tribes.controller.spec.ts health.controller.spec.ts registry.controller.spec.ts
```

Management UI phases must check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3002/
Invoke-WebRequest -UseBasicParsing http://localhost:3002/audit
Invoke-WebRequest -UseBasicParsing http://localhost:3002/cost
Invoke-WebRequest -UseBasicParsing http://localhost:3002/alerts
```

Expected:

```text
All return HTTP 200.
No Next.js error overlay appears in the browser.
Missing analytics data shows an actionable empty state.
```

## Known Deferred Work

- Public deployment of `apicenter-management` waits for Phase 6.
- Provider operation telemetry waits for `api-shared-services` runtime instrumentation.
- Alert acknowledgements wait for admin auth and a persistent management datastore.
