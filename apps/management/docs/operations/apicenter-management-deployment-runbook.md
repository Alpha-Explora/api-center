# API Center Management Deployment Runbook

## Deployment Position

Deploy `apicenter-management` only as a protected operator console. It is not a public portal.

Vercel is the current default hosting target when API Center admin endpoints are
reachable from Vercel. Private GKE is a fallback only when admin endpoints are
network-private, Workload Identity is required, or Vercel runtime limits block
an operation.

The API Center Cloud Run migration does not change the Management hosting
target by itself. Keep Management on Vercel while `API_CENTER_BASE_URL` remains
the public API Center front door. Since the `2026-07-04` DNS cutover, that
public front door is backed by Cloud Run. Use the direct Cloud Run service URL
only for operator smoke checks.

## Recommended Deployment Order

1. Deploy test environment first with `MANAGEMENT_AUTH_MODE=google` and `MANAGEMENT_ENVIRONMENT=test`.
2. Verify Google sign-in.
3. Verify read-only routes.
4. Verify safe test writes.
5. Deploy live environment with `MANAGEMENT_AUTH_MODE=google` and `MANAGEMENT_ENVIRONMENT=live`.
6. Verify live read-only routes.
7. Verify live write attempts require typed confirmation and reason.

## Current Test Deployment Evidence

```text
project: ele-3-ap-i-center/apicenter-management-test
production_alias: https://api-center-management-test.itsandbox.site
latest_deployment: dpl_3jxXVxMYDd3BxjetZbAbAtrrA5na
latest_deployment_url: https://apicenter-management-test-4kym37e24-ele-3-ap-i-center.vercel.app
management_environment: test
auth_mode: google
api_center_base_url: https://api-center.itsandbox.site
public_base_url: https://api-center-management-test.itsandbox.site
missing_env_count: 0
pipeline_health_provider: api-center
pipeline_governance_provider: api-center
smoke_health: /api/local/data-pipeline/health?environment=test&year=2026&month=05&day=20 returned success=true, count=1, source=athena-proxy
smoke_decision_signals: /api/local/data-pipeline/decision-signals?environment=test&year=2026&month=05&day=20 returned success=true, count=3, source=athena-proxy
```

## API Center Runtime Checks

Before promoting Management after an API Center runtime change:

```powershell
gcloud.cmd run services describe api-center-staging --project=apicenter-alpha-20260623 --region=asia-southeast1 --format="value(status.url,status.latestReadyRevisionName)"
gcloud.cmd run services describe api-center --project=apicenter-alpha-20260623 --region=asia-southeast1 --format="value(status.url,status.latestReadyRevisionName)"
Invoke-WebRequest -Uri "https://api-center.itsandbox.site/api/v1/health/ready" -UseBasicParsing -TimeoutSec 20
```

Expected current state:

- `api-center-staging` is healthy on Cloud Run.
- `api-center` is healthy on Cloud Run.
- `https://api-center.itsandbox.site` remains the Management-facing API Center URL and now routes through the Cloud Run public front door.

## Required Server-Only Secrets

- `API_CENTER_BASE_URL`
- `API_CENTER_PLATFORM_ADMIN_SECRET`

## Required Data Pipeline Provider Settings

For deployed management, route data-pipeline reads through APICenter instead of
the local evidence-file fallback:

```env
PIPELINE_HEALTH_PROVIDER=api-center
PIPELINE_GOVERNANCE_PROVIDER=api-center
```

`PIPELINE_GOVERNANCE_PROVIDER` defaults to `api-center` when
`API_CENTER_PLATFORM_ADMIN_SECRET` exists, but set it explicitly in deployed
environments so `/data-pipeline` cannot silently read an empty local file.

`local-file` providers are supported only for local development and tests. A
production build rejects local-file data-pipeline and topic-onboarding state
providers so deployed route bundles do not trace or read arbitrary workstation
files.

The `/data-pipeline` dashboard and service-detail Observability panels include
a date control for partition review. The local management routes forward
`year`, `month`, and `day` to APICenter. Use this when reviewing a populated
historical evidence partition, for example `2026-05-20`; leaving the date at
the default reviews the current UTC partition.

## Google Management Sign-In

For now, every verified Google account that can complete the Google sign-in flow resolves as an admin management session. Keep the OAuth app in testing mode and restrict users through Google Auth Platform test users until role mapping is reintroduced.

Expected env:

```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_ID=<google-oauth-client-id>
```

## Browser-Visible Variables

Only `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_API_CENTER_BASE_URL` are expected for browser use.

No provider keys, platform tokens, tribe secrets, payment secrets, SMS secrets, or Secret Manager payloads can be exposed through `NEXT_PUBLIC_*` variables.

## Management Action Audit

Every guarded management write that passes authorization emits a structured
server-side log record:

```json
{
  "event": "apicenter.management.action.authorized",
  "actionId": "confluent.topic.provision",
  "operatorEmail": "admin@example.com",
  "operatorRole": "admin",
  "environment": "live",
  "actionRisk": "provider-write",
  "reason": "Approved change",
  "authorizedAt": "2026-05-18T00:00:00.000Z"
}
```

The record intentionally excludes typed confirmation phrases, bearer tokens,
platform secrets, provider credentials, and plaintext tribe secrets. Until API
Center exposes a protected audit-write endpoint for management-originated
actions, treat the deployment platform logs as the authoritative source for
operator write authorization evidence.

## Periodic Access Review

Run a quarterly access review from `/shared-services/usage`.

1. Confirm runtime analytics is available for the selected window.
2. Review the usage matrix for declared-but-unused access and failed calls.
3. Open **Access review evidence** and copy the JSON evidence.
4. Check every row with `unusedAccess: true` with the owning tribe.
5. Check every row with `deniedAttempts` greater than `0` for missing scopes,
   expired credentials, or misuse.
6. Keep live access removal behind the normal registry edit and guarded
   confirmation flow.

The evidence export is metadata-only. It includes tribe ownership,
shared-service IDs, scopes, last-used timestamps, denied-attempt counts, and
unused-access flags. It must not include provider secrets, tribe secrets,
hashes, tokens, or Secret Manager payloads.

## Deployment Target Decision

Use the simplest private deployment target that can:

- Keep server environment variables private.
- Restrict access to the management console.
- Reach API Center admin endpoints.
- Emit logs for route errors and write attempts.

Vercel is acceptable when the API Center admin endpoint is reachable from Vercel. A private internal deployment is preferred when admin endpoints are network-private.

## Release Gate

Run these commands before promoting:

```bash
npm run test
npx tsc --noEmit
npm run build
```

## Final Release Checklist

- `npm run test` passes.
- `npx tsc --noEmit` passes.
- `npm run build` passes.
- `npm run smoke:routes` passes against the target deployment.
- Google sign-in works for admin, operator, and observer users.
- Observer users cannot perform write actions.
- Operator users cannot perform live write actions.
- Admin live creates, updates, provider actions, and destructive actions require typed confirmation and operator reason.
- Secret status pages show metadata and key names only.
- No plaintext provider secrets appear in browser source, network responses, logs, screenshots, or copied evidence blocks.
