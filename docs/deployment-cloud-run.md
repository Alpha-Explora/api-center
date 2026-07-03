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
| Latest ready revision | `api-center-staging-00003-rqb` |
| Deployed image | `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:build-75926ac4-e6fc-4be3-81b4-11360eafd250` |
| Deployed digest | `sha256:493f3fde7b46dab71c169f6ea6bf1d697a7fa282fedaffeea264b316f912843a` |
| Redis | Existing Memorystore `api-center-cache` at `10.121.26.59:6379` through VPC egress |
| Payment test route | `https://payment-test-mvrs6gmtgq-as.a.run.app` |
| Payment live route | `https://payment-live-mvrs6gmtgq-as.a.run.app` |

## Cloud Build Evidence

| Build | Result | Notes |
| --- | --- | --- |
| `43d8c296-c03d-4488-aaa8-d00ea9b02c55` | failed | First deploy reached Cloud Run but startup failed because production-safe non-secret env overrides were missing. |
| `746208d1-f23b-4860-8de0-66307ff84895` | succeeded | Tests/build/push/deploy succeeded, but static image-tag deployment did not roll a new revision. |
| `75926ac4-e6fc-4be3-81b4-11360eafd250` | succeeded | Passed 121 Jest suites / 580 tests, pushed stable and unique image tags, and rolled staging to revision `api-center-staging-00003-rqb`. |

## Verification

- `/api/v1/health/live`: HTTP 200 with authenticated Cloud Run invocation.
- `/api/v1/health/ready`: HTTP 200 with Redis `up`, registry `up`, and `registeredServices=30`.
- Kafka readiness: `up` with `skipped=true` because Kafka is disabled by configuration for this staging check.
- Bounded smoke: 100 `/api/v1/health/ready` requests at concurrency 10, zero failures, p95 `166ms`, p99 `243ms`.

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

## Production Cutover Gates

Production DNS must not move to Cloud Run until all gates pass:

- `api-center-staging` `/api/v1/health/live` returns HTTP 200.
- `api-center-staging` `/api/v1/health/ready` returns HTTP 200 with Redis up.
- Test token issuance succeeds through Cloud Run.
- Payment test route succeeds through private Cloud Run.
- Payment live health route succeeds through private Cloud Run using a live-scoped token.
- Warm health latency is under 500 ms for at least 20 consecutive checks from the operator machine.
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

