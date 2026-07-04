# api-center Cloud Run Deployment

## Current Staging State

| Parameter | Value |
| --- | --- |
| Project | `apicenter-alpha-20260623` |
| Region | `asia-southeast1` |
| Service | `api-center-staging` |
| Service URL | `https://api-center-staging-mvrs6gmtgq-as.a.run.app` |
| Runtime target | `cloud-run-staging` |
| Runtime service account | `api-center-cloud-run@apicenter-alpha-20260623.iam.gserviceaccount.com` |
| Latest ready revision | `api-center-staging-00009-x9d` |
| Deployed image | `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:build-1ee3fb64-9588-47b5-8254-b9e224346c28` |
| Deployed digest | `sha256:d4e5c20c16d5f69dec3d280d0146aa17baf95f211d7df6fb31d756b703fb4c27` |
| Redis | Existing Memorystore `api-center-cache` at `10.121.26.59:6379` through VPC egress |
| Payment test route | `https://payment-test-mvrs6gmtgq-as.a.run.app` |
| Payment live route | `https://payment-live-mvrs6gmtgq-as.a.run.app` |

## Cloud Build Evidence

| Build | Result | Notes |
| --- | --- | --- |
| `43d8c296-c03d-4488-aaa8-d00ea9b02c55` | failed | First deploy reached Cloud Run but startup failed because production-safe non-secret env overrides were missing. |
| `746208d1-f23b-4860-8de0-66307ff84895` | succeeded | Tests/build/push/deploy succeeded, but static image-tag deployment did not roll a new revision. |
| `75926ac4-e6fc-4be3-81b4-11360eafd250` | succeeded | Passed 121 Jest suites / 580 tests, pushed stable and unique image tags, and rolled staging to revision `api-center-staging-00003-rqb`. |
| `0ff351db-fb06-4239-b79a-fba2a5758008` | succeeded | Passed 121 Jest suites / 581 tests, fixed headers-like Google auth token extraction, and rolled staging to revision `api-center-staging-00007-sdp`. |
| `1ee3fb64-9588-47b5-8254-b9e224346c28` | succeeded | Passed full Cloud Build verification, added `X-Serverless-Authorization` for private Cloud Run upstreams, and rolled staging to revision `api-center-staging-00009-x9d`. |
| `76c9ef6c-205e-41bf-93d2-c6eb5235a85f` | succeeded | Passed Cloud Build verification, deployed production-shaped `api-center` revision `api-center-00004-9sw`, preserved load-balancer-only ingress, and bypassed global throttling for health checks. |
| `c0c145c5-df6d-4018-9c64-c1ff5bc1b093` | succeeded | Passed 125 Jest suites / 603 tests, installed `git` in the Cloud Build test container, deployed production `api-center` revision `api-center-00006-wqc`, and fixed Cloud Run ID-token acquisition for private payment invocation. |

## Verification

- `/api/v1/health/live`: HTTP 200 with authenticated Cloud Run invocation.
- `/api/v1/health/ready`: HTTP 200 with Redis `up`, registry `up`, and `registeredServices=30`.
- Kafka readiness: `up` with `skipped=true` because Kafka is disabled by configuration for this staging check.
- Bounded smoke: 100 `/api/v1/health/ready` requests at concurrency 10, zero failures, p95 `235ms`, p99 `249ms` on revision `api-center-staging-00009-x9d`.

## Payment Route Verification

- Verified at: `2026-07-04T00:30:38Z`.
- Token environment: `test`.
- API Center runtime: `api-center-staging`, revision `api-center-staging-00009-x9d`.
- Payment runtime: `payment-test`, URL `https://payment-test-mvrs6gmtgq-as.a.run.app`.
- Expected path: API Center Cloud Run -> IAM-authenticated `payment-test` Cloud Run.
- Route: `/api/v1/shared/payment/health`.
- Result: HTTP 200.
- Response: `paymongo-gateway`, provider mode `test`, provider name `paymongo`.
- Live-scoped verification at `2026-07-04T00:55Z`: `api-center-staging` called `/api/v1/shared/payment/health` through `payment-live` and received HTTP 200 from `paymongo-gateway`, provider mode `live`.
- Note: shared services use `run.googleapis.com/ingress: all` with IAM-only invocation. No `allUsers` invoker binding is granted; `api-center-cloud-run@apicenter-alpha-20260623.iam.gserviceaccount.com` invokes payment services with Google-signed identity via `X-Serverless-Authorization`.

## Production Cloud Run Preparation

Production DNS now points at the Cloud Run external Application Load Balancer. GKE remains deployed as rollback infrastructure for the seven-day retention window.

| Parameter | Value |
| --- | --- |
| Service | `api-center` |
| Service URL | `https://api-center-mvrs6gmtgq-as.a.run.app` |
| Latest ready revision | `api-center-00006-wqc` |
| Deployed image | `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:build-c0c145c5-df6d-4018-9c64-c1ff5bc1b093` |
| Deployed digest | `sha256:1bea6a1f0a31ac697d6f54814b17043959e73deef0fce8921d348cc110e037d4` |
| Build | `c0c145c5-df6d-4018-9c64-c1ff5bc1b093` |
| Runtime target | `cloud-run-prod` |
| Min/max instances | `1` / `10` |
| Public posture | `run.googleapis.com/ingress=internal-and-cloud-load-balancing`, `run.googleapis.com/invoker-iam-disabled=true` |

Verification at `2026-07-04T00:47Z`:

- `/api/v1/health/live`: HTTP 200 with authenticated Cloud Run invocation.
- `/api/v1/health/ready`: HTTP 200 with authenticated Cloud Run invocation.
- `/api/v1/shared/payment/health`: HTTP 200 through `payment-test` using a test-scoped token.
- `/api/v1/shared/payment/health`: HTTP 200 through `payment-live` using a live-scoped token at `2026-07-04T00:55Z`.

`api-center.itsandbox.site` was moved to this service after the public front door and cutover gates passed.

## Public Front Door Status

Checked before cutover at `2026-07-04T01:44Z` and after cutover at `2026-07-04T03:45Z`:

- `api-center.itsandbox.site` resolved to `136.110.192.169` before cutover and now resolves to `136.68.196.7` through Cloudflare authoritative nameservers and public resolvers `1.1.1.1` and `8.8.8.8`.
- `https://api-center.itsandbox.site/api/v1/health/ready` returns HTTP 200 through the Cloud Run public front door.
- `itsandbox.site` is not hosted in this GCP project's Cloud DNS. The only managed zone in `apicenter-alpha-20260623` is private `cluster.local.`, so the DNS cutover must be executed in the external DNS provider for `itsandbox.site`.
- Parallel Cloud Run HTTPS load balancer is provisioned on test IP `136.68.196.7` using forwarding rule `apicenter-cloud-run-https`.
- Parallel Cloud Run HTTP forwarding rule `apicenter-cloud-run-http` exists on port 80 for routing diagnostics only. Production cutover remains HTTPS.
- Backend service `apicenter-cloud-run-backend` is global `EXTERNAL_MANAGED`, protocol HTTP, logging enabled, and points to serverless NEG `apicenter-cloud-run-neg` in `asia-southeast1`.
- Target HTTPS proxy `apicenter-cloud-run-https-proxy` uses active managed certificate `mcrt-531dd8af-4b3d-4ee5-9099-774c27bfa8cc` for `api-center.itsandbox.site`.
- `api-center` direct `run.app` anonymous access is blocked by `ingress=internal-and-cloud-load-balancing`; public access is through the Cloud Run load balancer only.
- Local forced-resolution smoke against `https://api-center.itsandbox.site` on `136.68.196.7` returned HTTP 200 for `/api/v1/health/live` and `/api/v1/health/ready`.
- Bounded forced-resolution spike smoke passed: 100 `/api/v1/health/ready` requests, concurrency 10, 0 failures, p95 `359ms`, p99 `516ms`, max `586ms`.
- Warm forced-resolution health check passed after one warm-up miss: 20 consecutive `/api/v1/health/ready` requests returned HTTP 200 and stayed under 500 ms, max `348ms`.
- Thirty-minute periodic forced-resolution check passed at `2026-07-04T02:18Z`: 30 API Center readiness calls and 30 live payment health calls through `https://api-center.itsandbox.site` on `136.68.196.7` all returned HTTP 200. API Center readiness max was `513ms` with one sample over 500 ms; payment-live max was `1030ms` with zero samples over 1500 ms.
- Pre-cutover recheck at `2026-07-04T02:36Z`: public DNS still resolved `api-center.itsandbox.site` to `136.110.192.169`; forced-resolution Cloud Run LB checks against `136.68.196.7` returned HTTP 200 for `/api/v1/health/live` in `0.222s` and `/api/v1/health/ready` in `0.226s`; certificate `mcrt-531dd8af-4b3d-4ee5-9099-774c27bfa8cc` remained `ACTIVE` for `api-center.itsandbox.site`.
- DNS cutover executed through the authenticated Cloudflare MCP at `2026-07-04T03:15Z`: record `eb94fd8801501ffd0d4bcce4dce99ce2` changed from `136.110.192.169` to `136.68.196.7`, `proxied=false`, TTL automatic/300s authoritative. Cloudflare API read-back, `guy.ns.cloudflare.com`, `kia.ns.cloudflare.com`, `1.1.1.1`, and `8.8.8.8` returned `136.68.196.7`.
- Post-cutover production revision `api-center-00006-wqc` passed public Cloud Run smoke at `2026-07-04T03:45Z`: `/api/v1/health/live` HTTP 200 in `418ms`, `/api/v1/health/ready` HTTP 200 in `194ms`, five warm readiness checks under `133ms`, and bounded spike smoke with 100 requests at concurrency 10, 0 failures, p95 `369ms`, p99 `481ms`.
- First seven-day retention evidence row recorded at `2026-07-04T03:46Z`: live health HTTP 200 in `441ms`, ready HTTP 200 in `214ms`, Redis `up`, and live payment health HTTP 200 in `948ms`.
- The first LB spike attempt before revision `api-center-00004-9sw` found that health checks were throttled by the global application throttler. Revision `api-center-00004-9sw` bypasses global throttling for health check routes so public LB readiness probes and cutover smoke do not consume tribe/API rate-limit buckets.

Cutover is complete. Keep GKE available for rollback during the seven-day retention window. Do not grant `allUsers` directly; the approved Cloud Run path uses the Invoker IAM check disablement plus load-balancer-only ingress.

## DNS Cutover Runbook

Public DNS authority checked at `2026-07-04T02:24Z`:

| Record | Value |
| --- | --- |
| Nameservers | `guy.ns.cloudflare.com`, `kia.ns.cloudflare.com` |
| SOA primary | `guy.ns.cloudflare.com` |
| Current `api-center.itsandbox.site` A record | `136.110.192.169` |
| Current resolver TTL | `1s` from `Resolve-DnsName` |
| Cloud Run target A record | `136.68.196.7` |
| Rollback A record | `136.110.192.169` |

Cutover must be executed in Cloudflare for zone `itsandbox.site`:

1. Configure an operator-scoped Cloudflare API token with DNS edit access for zone `itsandbox.site`.
2. Export the Cloudflare values and a live-scoped APICenter token:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<cloudflare-dns-edit-token>"
$env:CLOUDFLARE_ZONE_ID = "<itsandbox-site-zone-id>"
$env:APICENTER_CLOUD_RUN_BEARER_TOKEN = "<live-scoped APICenter token>"
```

3. Dry-run the end-to-end orchestration from the API Center repo:

```powershell
cd C:\Codes\apic\api-center
npm run cutover:cloud-run:execute -- --dry-run
```

Expected dry-run:

```text
beforeIp: 136.110.192.169
afterIp: 136.68.196.7
dryRun: true
```

4. Execute the orchestrated cutover:

```powershell
npm run cutover:cloud-run:execute -- --rollback-on-failure
```

The orchestration command runs the Cloudflare DNS cutover, waits until `api-center.itsandbox.site` resolves to `136.68.196.7`, runs `smoke:cloud-run`, runs `smoke:tribe-boundary`, and records the first seven-day retention evidence row. With `--rollback-on-failure`, it points DNS back to `136.110.192.169` if DNS moved but smoke or evidence recording fails. Use this path for the production cutover unless you need to recover from a partial manual DNS change.

Manual fallback:

```powershell
npm run dns:cloud-run:cutover
```

The DNS command preserves the existing Cloudflare TTL and proxy mode. It refuses to write unless the current A record is still `136.110.192.169`; use `-- --force` only after manually confirming the DNS state.

If DNS was already changed outside the helper, resume verification and evidence recording with:

```powershell
npm run cutover:cloud-run:execute -- --skip-dns-cutover
```

5. Record the timestamp and command output in this document.
6. Verify public DNS:

```powershell
Resolve-DnsName api-center.itsandbox.site -Type A
nslookup api-center.itsandbox.site 1.1.1.1
nslookup api-center.itsandbox.site 8.8.8.8
```

Expected:

```text
api-center.itsandbox.site -> 136.68.196.7
```

7. Run post-cutover smoke:

```powershell
cd C:\Codes\apic\api-center
$env:APICENTER_CLOUD_RUN_BASE_URL = "https://api-center.itsandbox.site"
$env:APICENTER_CLOUD_RUN_SPIKE_REQUESTS = "100"
$env:APICENTER_CLOUD_RUN_SPIKE_CONCURRENCY = "10"
$env:APICENTER_CLOUD_RUN_SPIKE_P95_MS = "1500"
npm run smoke:cloud-run
npm run smoke:tribe-boundary
```

8. Record the first seven-day retention evidence row:

```powershell
$env:APICENTER_CLOUD_RUN_BASE_URL = "https://api-center.itsandbox.site"
$env:APICENTER_CLOUD_RUN_BEARER_TOKEN = "<live-scoped APICenter token>"
$env:APICENTER_CUTOVER_DNS_SERVERS = "1.1.1.1,8.8.8.8"
npm run cutover:cloud-run:evidence
```

The evidence command refuses to record if public DNS does not resolve to `136.68.196.7`. It checks `/api/v1/health/live`, `/api/v1/health/ready`, Redis readiness, and `/api/v1/shared/payment/health`, then records one row per date under `Seven-Day Cloud Run Retention Evidence`.

Rollback if smoke fails or Cloud Run error/latency alerts fire:

1. Revert the Cloudflare A record:

```powershell
cd C:\Codes\apic\api-center
npm run dns:cloud-run:rollback
```

The rollback command refuses to write unless the current A record is `136.68.196.7`.
2. Verify public DNS resolves to `136.110.192.169`.
3. Verify GKE health:

```powershell
Invoke-WebRequest -Uri "https://api-center.itsandbox.site/api/v1/health/ready" -UseBasicParsing -TimeoutSec 20
```

4. Record the rollback timestamp, smoke failure, and decision in this document.

## Monitoring And Alert Policies

Configured at `2026-07-04T01:43Z` in project `apicenter-alpha-20260623`:

| Policy | Resource |
| --- | --- |
| `APICenter Cloud Run 5xx responses` | `projects/apicenter-alpha-20260623/alertPolicies/5667206945393348967` |
| `APICenter Cloud Run 429 responses` | `projects/apicenter-alpha-20260623/alertPolicies/4798178057687587581` |
| `APICenter Cloud Run p95 latency high` | `projects/apicenter-alpha-20260623/alertPolicies/4798178057687586042` |
| `APICenter Cloud Run max instance saturation` | `projects/apicenter-alpha-20260623/alertPolicies/16663360317057013483` |
| `APICenter Redis rejected connections` | `projects/apicenter-alpha-20260623/alertPolicies/3304923804898671563` |
| `APICenter Redis memory pressure` | `projects/apicenter-alpha-20260623/alertPolicies/4062726626645936498` |
| `APICenter shared provider failures` | `projects/apicenter-alpha-20260623/alertPolicies/8675777201395846856` |

Notification channel configured at `2026-07-04T01:48Z`:

| Channel | Resource | Status |
| --- | --- | --- |
| `APICenter operator email` | `projects/apicenter-alpha-20260623/notificationChannels/2456658562778314432` | Attached to all APICenter cutover alert policies |

Provider failures use log-based metric `apicenter_shared_provider_failures` with this filter:

```text
resource.type="cloud_run_revision" AND resource.labels.service_name=~"payment-(live|test)" AND (severity>=ERROR OR textPayload=~"(?i)(provider|paymongo).*(fail|error|timeout|circuit)" OR jsonPayload.message=~"(?i)(provider|paymongo).*(fail|error|timeout|circuit)")
```

The email notification channel targets the active operator account `abtorres.it@alphaexplora.com`. If the channel requires email verification in Google Cloud Monitoring, complete that verification before relying on email delivery for production incidents.

The project exposes Redis CPU, memory, connection, and rejected-connection metrics, but no native Redis latency metric descriptor was found. Redis cutover coverage currently uses rejected connections and memory pressure plus API Center readiness checks.

## IAM Posture

`api-center-staging` has public ingress but is not anonymously invokable. The organization policy rejected `allUsers` on `roles/run.invoker`, so direct `run.app` smoke uses an operator identity token for now.

Current staging invoker:

```text
user:abtorres.it@alphaexplora.com -> roles/run.invoker
```

Production DNS cutover must not assume direct anonymous Cloud Run invocation. Use an organization-approved public front door, such as the approved load-balancer/domain-mapping path, before moving `api-center.itsandbox.site`.

## Smoke Command

```powershell
$env:APICENTER_CLOUD_RUN_BASE_URL = gcloud.cmd run services describe api-center-staging --project=apicenter-alpha-20260623 --region=asia-southeast1 --format="value(status.url)"
$env:APICENTER_CLOUD_RUN_BEARER_TOKEN = gcloud.cmd auth print-identity-token
$env:APICENTER_CLOUD_RUN_SPIKE_REQUESTS = "100"
$env:APICENTER_CLOUD_RUN_SPIKE_CONCURRENCY = "10"
$env:APICENTER_CLOUD_RUN_SPIKE_P95_MS = "1500"
$env:APICENTER_CLOUD_RUN_SPIKE_COOLDOWN_MS = "65000"
npm run smoke:cloud-run
```

The cooldown keeps the warm-up checks from consuming the same 100-request throttling window as the bounded spike.

## Seven-Day Retention Evidence Command

Run this once immediately after cutover smoke, then once per day while GKE remains available for rollback:

```powershell
cd C:\Codes\apic\api-center
$env:APICENTER_CLOUD_RUN_BASE_URL = "https://api-center.itsandbox.site"
$env:APICENTER_CLOUD_RUN_BEARER_TOKEN = "<live-scoped APICenter token>"
$env:APICENTER_CUTOVER_DNS_SERVERS = "1.1.1.1,8.8.8.8"
npm run cutover:cloud-run:evidence
```

For a non-writing preflight:

```powershell
npm run cutover:cloud-run:evidence -- --dry-run
```

The command verifies that `api-center.itsandbox.site` resolves to the Cloud Run load balancer IP `136.68.196.7` before writing evidence. Rerunning it on the same date replaces that date's row instead of adding a duplicate.

## Production Cutover Gates

Production DNS must not move to Cloud Run until all gates pass:

- `api-center-staging` `/api/v1/health/live` returns HTTP 200.
- `api-center-staging` `/api/v1/health/ready` returns HTTP 200 with Redis up.
- Test token issuance succeeds through Cloud Run.
- Payment test route succeeds through private Cloud Run.
- Payment live health route succeeds through private Cloud Run using a live-scoped token.
- Warm health latency is under 500 ms for at least 20 consecutive checks from the operator machine.
- No Cloud Run cold start on `api-center` or `payment-live` during 30 minutes of periodic checks.
- Bounded spike smoke sends 100 `/api/v1/health/ready` requests at concurrency 10 with zero failures and p95 under 1500 ms.
- Cloud Run service limits are set before DNS cutover:
  - `api-center`: `min-instances=1`, `max-instances=10`
  - `payment-live`: `min-instances=1`, `max-instances=5`
  - `payment-test`: `min-instances=0`, `max-instances=3`
  - email, SMS, OTP, Google Auth, and geo: `min-instances=0`, `max-instances=3`
- Alerts exist for Cloud Run 5xx, Cloud Run 429, p95 latency, Redis latency, provider failures, and max-instance saturation.
- GKE production remains unchanged during staging verification.
- Rollback command is documented and tested.

## Rollback

If Cloud Run production cutover fails, point DNS back to the current GKE load balancer IP `136.110.192.169` and keep GKE serving.

Then verify:

```powershell
Invoke-WebRequest -Uri "https://api-center.itsandbox.site/api/v1/health/ready" -UseBasicParsing -TimeoutSec 20
```

## Seven-Day Cloud Run Retention Evidence

| Date | Health | Payment live | Redis | Error notes | Decision |
| --- | --- | --- | --- | --- | --- |
| 2026-07-04 | pass: live 200 441ms, ready 200 214ms | pass: 200 948ms | up | none | keep Cloud Run |
