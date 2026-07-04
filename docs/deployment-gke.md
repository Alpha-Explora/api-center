# api-center — GKE Deployment (Living Document)

> **This file is the living state record for the GKE deployment.**
> `infra/gcp/gke/README.md` is the stable how-to. This file tracks what is actually running,
> why decisions were made, and what changed. Always update this file in the same commit
> as any change to `infra/gcp/gke/**`, `docker/Dockerfile.gcp`, root `Dockerfile`,
> `.dockerignore`, `deploy/local/docker-compose.yml`, or CI/CD workflows.

---

## Current Environment

| Parameter | Value |
|---|---|
| GCP Project ID | `apicenter-alpha-20260623` |
| Region | `asia-southeast1` |
| Cluster name | `api-center` (Autopilot) |
| Namespace | `api-center` |
| Artifact Registry | `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center` |
| Static IP name | GKE ingress address `136.110.192.169` |
| Public hostname | `api-center.itsandbox.site` |
| Secret Manager secret | `api-center-prod` plus per-tribe `api-center-tribe-secret-<tribe-id>-<test|live>` secrets |
| Auth provider | `composite` (`AUTH_PROVIDER=composite` in ConfigMap): API Center-issued tribe JWTs with Descope validation fallback |
| Memorystore cache host | `10.88.197.107:6379` |
| Memorystore rate-limit host | `10.88.197.107:6379` (shared low-traffic Redis) |
| Kafka brokers | Confluent Cloud bootstrap endpoint from Secret Manager |
| Kafka topology | Managed by Confluent Cloud |

---

## Current Image

| Field | Value |
|---|---|
| Image | `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:legacy-routing-b9c811f-20260628` |
| Built from | `b9c811f` |
| Last deployed | `2026-06-28` |
| Deployed by | Codex-assisted one-URL legacy routing cleanup rollout |
| Validation | Cloud Build `9068d412-0628-4f15-ad81-3853cc3d7ac5` succeeded; GKE rollout completed; ConfigMap has no legacy routing keys or `APICENTER_ENVIRONMENT_CONTRACT_MODE`; readiness returned HTTP 200 with `status=ok`, Redis up, registry up, and `registeredServices=22`. On 2026-06-30 the active ConfigMap had `SHARED_SERVICE_ROUTE_PAYMENT_TEST=http://payment-test.api-center.svc.cluster.local:4010` and `SHARED_SERVICE_ROUTE_PAYMENT_LIVE=http://payment-live.api-center.svc.cluster.local:4010`. Final cleanup evidence reports 0 legacy services, 0 legacy Secret Manager records, and 0 active no-legacy violations. |

> After each deploy, update the rows above with the full image tag (use git SHA, not `:latest`) and commit.

## Shared Payment Runtimes

Payment is the first shared service with separate test/live runtime isolation
inside the single public API Center topology. Both runtimes live in namespace
`api-center`; API Center selects the target from the validated token
environment.

| Field | Value |
|---|---|
| Test deployment | `api-center/payment-test` |
| Live deployment | `api-center/payment-live` |
| Image | `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/shared-payment-service:payment-tribe-fix-50f5ee6-202605162310` |
| Test route | `SHARED_SERVICE_ROUTE_PAYMENT_TEST=http://payment-test.api-center.svc.cluster.local:4010` |
| Live route | `SHARED_SERVICE_ROUTE_PAYMENT_LIVE=http://payment-live.api-center.svc.cluster.local:4010` |
| Test secret source | Secret Manager `api-shared-services-test` synced to Kubernetes secret `api-shared-services-payment-test` |
| Live secret source | Secret Manager `api-shared-services-prod` synced to Kubernetes secret `api-shared-services-payment-live` |
| Last verified | `2026-06-30` |
| Validation | `payment-test` and `payment-live` were ready. In-pod `/health` returned `providerMode=test` and `providerMode=live` respectively. |

## Retired Test Namespace

The old public test lane is retired. Do not deploy new work to
`api-center-test`, and do not point Management or consumers at
`https://api-center-test.itsandbox.site`.

On 2026-06-30, `api-center-test` was deleted after a live registry check returned
no active service entries pointing at `api-center-test.itsandbox.site`. Before
deletion it contained `api-center` deployment/service/HPA,
`api-center-config`, ingress `api-center-test.itsandbox.site`, managed
certificate, PDB, and service account.

ConfigMaps are not versioned. Deleting `api-center-test` removed its old
ConfigMap with the namespace. Secret Manager cleanup was completed after active
consumers were confirmed.

Current Secret Manager version policy:

| Secret | Active use | Keep enabled | Disable after approval |
| --- | --- | --- | --- |
| `api-center-prod` | Active API Center runtime bundle | version `10` | versions `1`-`9` disabled |
| `api-shared-services-prod` | Active live shared-service/payment source | version `11` | versions `1`-`10` disabled |
| `api-shared-services-test` | Active payment-test source | version `10` | versions `1`-`9` disabled |
| `api-center-test` | Retired API Center test runtime bundle | none | versions `1`-`5` disabled |

---

## HPA Configuration

Source of truth: `infra/gcp/gke/50-hpa.yaml`. This section is the "why these numbers" companion.

| Parameter | Value | Rationale |
|---|---|---|
| Min replicas | 2 | Cost-saving profile with one spare pod for single-pod failure |
| Max replicas | 3 | Burst headroom while keeping idle pod spend low |
| CPU target | 70% | Leaves headroom for bursts before a scale-up triggers |
| Memory target | 80% | Memory is less spiky than CPU; 80% avoids OOM while not wasting capacity |
| Scale-up window | 30 s | Fast absorption of traffic spikes |
| Scale-up policy | `max(100% pods/30s, +4 pods/30s)` | Doubles or adds 4, whichever is larger |
| Scale-down window | 300 s | 5-minute cooldown prevents thrashing after brief traffic lulls |
| Scale-down policy | max 50% per 60 s | Gradual ramp-down to avoid dropping pods that will be needed again |

**Resource requests** (set in `30-deployment.yaml`, referenced by HPA for utilisation calculation):

| Resource | Request | Limit |
|---|---|---|
| CPU | 150m | 1000m |
| Memory | 256Mi | 512Mi |

**Future:** The `TODO` in `50-hpa.yaml` notes switching to request-rate-based scaling via
`loadbalancing.googleapis.com|https|request_count` from GCLB once the Cloud Monitoring custom
metrics adapter is installed.

---

## Health Endpoints & Probes

All probes hit `src/health/` endpoints. Do not change probe paths without updating both
`30-deployment.yaml` and `41-backendconfig.yaml`.

| Probe | Path | Period | Failure threshold | Notes |
|---|---|---|---|---|
| Startup | `/api/v1/health/ready` | 5 s | 12 (= 60 s window) | Gives app time to load secrets from Secret Manager |
| Liveness | `/api/v1/health/live` | 15 s | 3 | Restarts only on hard failure |
| Readiness | `/api/v1/health/ready` | 5 s | 3 | Fails fast when overloaded so GCLB stops routing traffic while HPA catches up |
| GCLB health check | `/api/v1/health/ready` | 10 s | 3 | Configured in `41-backendconfig.yaml` |

---

## Known Placeholders

Replace these before applying to a new environment.

```bash
grep -rn 'example.com\|example.internal' infra/gcp/gke/
```

| File | Placeholder | Replace with |
|---|---|---|
| `infra/gcp/gke/70-managedcert.yaml` | `api-center.example.com` | Real public hostname |
| `infra/gcp/gke/80-ingress.yaml` | `api-center.example.com` | Real public hostname |

---

## Deploy Runbook

### 0. Pre-flight

```bash
# Confirm correct GCP project
gcloud config get-value project
# → api-center-496422

# Get cluster credentials
gcloud container clusters get-credentials api-center --region=asia-southeast1

# Confirm kubectl context
kubectl config current-context

# Confirm Artifact Registry exists
gcloud artifacts repositories describe api-center --location=asia-southeast1
```

### 1. One-time provisioning (skip if cluster already up)

```bash
PROJECT_ID=api-center-496422 \
REGION=asia-southeast1 \
SECRET_NAME=api-center-prod \
PUBLIC_HOSTNAME=<real-hostname> \
./infra/gcp/gke/provision.sh
```

The script prints Memorystore IPs, static IP, and image registry path. Update the
**Current Environment** table above and fill the manifest placeholders before continuing.

Point your DNS A record for `<real-hostname>` at the static IP the script prints.

### 2. Fill placeholders

```bash
# Verify no unresolved placeholders remain
grep -rn 'example.com\|example.internal' infra/gcp/gke/
```

Replace every placeholder in `infra/gcp/gke/*.yaml` (see **Known Placeholders** above).

### 2A. Update Secret Manager payload (internal tribe JWT + Descope fallback)

Export current payload, add the API Center internal JWT keys, and keep Descope
project metadata for human/admin-token validation during the composite rollout.

```bash
gcloud secrets versions access latest --secret=api-center-prod > /tmp/api-center-prod.current.json
cp /tmp/api-center-prod.current.json /tmp/api-center-prod.next.json

# Edit /tmp/api-center-prod.next.json and ensure it contains at least:
# JWT_PRIVATE_KEY=<persistent RS256 private key PEM with escaped newlines>
# JWT_PUBLIC_KEY=<matching RS256 public key PEM with escaped newlines>
# TRIBE_SECRET_SOURCE=gcp-secret-manager
# TRIBE_SECRET_GCP_PREFIX=api-center-tribe-secret-
# TRIBE_SECRET_CACHE_TTL_SECONDS=300
# DESCOPE_BASE_URL=https://api.descope.com
# DESCOPE_PROJECT_ID=P3CDYwDpERyUJPEfqnppZM7HLySN
# DESCOPE_ISSUER=https://api.descope.com/v1/apps/P3CDYwDpERyUJPEfqnppZM7HLySN
# DESCOPE_AUDIENCE=<token aud claim; start with project id if needed>
# DESCOPE_JWKS_URI=https://api.descope.com/P3CDYwDpERyUJPEfqnppZM7HLySN/.well-known/jwks.json

gcloud secrets versions add api-center-prod --data-file=/tmp/api-center-prod.next.json
gcloud secrets versions list api-center-prod --limit=5
```

Minimal payload shape for the auth switch. Non-secret values such as
`AUTH_PROVIDER`, issuer, audience, and TTLs are set in `infra/gcp/gke/20-configmap.yaml`;
include them here only if you intentionally run without that ConfigMap.

```json
{
        "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
        "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
        "TRIBE_SECRET_SOURCE": "gcp-secret-manager",
        "TRIBE_SECRET_GCP_PREFIX": "api-center-tribe-secret-",
        "TRIBE_SECRET_CACHE_TTL_SECONDS": "300",
        "DESCOPE_BASE_URL": "https://api.descope.com",
        "DESCOPE_PROJECT_ID": "P3CDYwDpERyUJPEfqnppZM7HLySN",
        "DESCOPE_ISSUER": "https://api.descope.com/v1/apps/P3CDYwDpERyUJPEfqnppZM7HLySN",
        "DESCOPE_AUDIENCE": "P3CDYwDpERyUJPEfqnppZM7HLySN",
        "DESCOPE_JWKS_URI": "https://api.descope.com/P3CDYwDpERyUJPEfqnppZM7HLySN/.well-known/jwks.json"
}
```

Per-tribe secret hashes no longer belong in `api-center-prod`. Create one Secret
Manager secret per tribe, for example:

```text
api-center-tribe-secret-smoke-tribe-test
```

with payload:

```json
{
        "tribeId": "smoke-tribe",
        "environment": "test",
        "secretHashSha256": "<sha256-hash>",
        "status": "active",
        "rotatedAt": "2026-05-14T00:00:00.000Z"
}
```

Rollback path: re-enable only the affected scoped Secret Manager version for the
specific tribe and environment, then rotate it after recovery.

### 2B. Confirm runtime selector

`infra/gcp/gke/20-configmap.yaml` should be set to `AUTH_PROVIDER: "composite"`.
Composite mode issues API Center internal JWTs for tribes and validates internal
JWTs first, then Descope tokens as a migration fallback.

```bash
kubectl -n api-center get configmap api-center-config -o jsonpath='{.data.AUTH_PROVIDER}{"\n"}'
# Expected: composite
```

### 2C. Configure Kafka client credentials in Secret Manager

The APICenter deployment uses Confluent Cloud Kafka. `infra/gcp/gke/20-configmap.yaml`
already enables:

- `KAFKA_SSL_ENABLED=true`
- `KAFKA_SSL_REJECT_UNAUTHORIZED=true`
- `KAFKA_SASL_MECHANISM=plain`

Set these keys in Secret Manager payload as part of the same rollout:

- `KAFKA_BROKERS=<confluent-bootstrap-server>:9092`
- `KAFKA_SASL_USERNAME=<confluent-api-key>`
- `KAFKA_SASL_PASSWORD=<confluent-api-secret>`

Do not include:

- `KAFKA_SSL_CA_PEM`
- protocol prefixes such as `SASL_SSL://`
- old self-managed brokers such as `api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092`

Then update `api-center-prod` and validate the payload shape before rolling the deployment:

```powershell
$tmp = Join-Path $env:TEMP ('api-center-prod-verify-' + [guid]::NewGuid().ToString() + '.json')
gcloud.cmd secrets versions access latest --secret=api-center-prod --project api-center-496422 |
  Set-Content -LiteralPath $tmp -Encoding UTF8
$json = Get-Content -Raw -LiteralPath $tmp | ConvertFrom-Json
Remove-Item -LiteralPath $tmp -Force
$brokers = [string]$json.KAFKA_BROKERS
@(
  [pscustomobject]@{ Check = 'Broker looks Confluent'; Pass = ($brokers -match '\.confluent\.cloud:9092') }
  [pscustomobject]@{ Check = 'Broker not self-managed'; Pass = ($brokers -notmatch 'localhost|api-center-kafka|\.svc\.cluster\.local|kafka:9092') }
  [pscustomobject]@{ Check = 'SASL mechanism plain'; Pass = ([string]$json.KAFKA_SASL_MECHANISM -eq 'plain') }
  [pscustomobject]@{ Check = 'SSL enabled'; Pass = ([string]$json.KAFKA_SSL_ENABLED -eq 'true') }
  [pscustomobject]@{ Check = 'SSL verification enabled'; Pass = ([string]$json.KAFKA_SSL_REJECT_UNAUTHORIZED -eq 'true') }
  [pscustomobject]@{ Check = 'Custom CA removed'; Pass = ($json.PSObject.Properties.Name -notcontains 'KAFKA_SSL_CA_PEM') }
) | Format-Table -AutoSize
```

### 2D. Configure AWS Athena read credentials in Secret Manager

The data-pipeline dashboard reads curated Gold tables through the API Center
runtime, not directly from management. `infra/gcp/gke/20-configmap.yaml` sets only
non-secret Athena selectors such as `PIPELINE_HEALTH_SOURCE=athena`,
`PIPELINE_GOVERNANCE_SOURCE=athena`, and `AWS_REGION=ap-southeast-2`.

AWS credentials for APICenter Athena reads must be available to the API Center
runtime through the approved secret path. For the current GKE deployment, that
means the `api-center-prod` Secret Manager JSON loaded at boot must include
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or an approved AWS runtime
credential mechanism. If temporary credentials are used, include
`AWS_SESSION_TOKEN`.

Attach the repo policy
`infra/aws-data-pipeline/policies/api-center-athena-runtime-policy.json` to the
dedicated API Center runtime principal, for example
`api-center-athena-reader-gke`. This is the policy whose access key should be
stored in `api-center-prod`.

Required AWS permissions:

- `athena:GetWorkGroup`
- `athena:StartQueryExecution`
- `athena:GetQueryExecution`
- `athena:GetQueryResults`
- `athena:StopQueryExecution`
- `glue:GetDatabase`
- `glue:GetDatabases`
- `glue:GetTable`
- `glue:GetTables`
- `glue:GetPartition`
- `glue:GetPartitions`
- `s3:GetObject` and scoped `s3:ListBucket` on `api-center-raw-data/topics/*`
- `s3:GetBucketLocation` on `api-center-athena-results`
- `s3:GetObject` and `s3:PutObject` on approved `athena-results/*` prefixes

Validate key presence without printing values:

```powershell
$json = gcloud.cmd secrets versions access latest `
  --secret=api-center-prod `
  --project api-center-496422 | ConvertFrom-Json
$names = $json.PSObject.Properties.Name
@(
  [pscustomobject]@{ Check = 'AWS_ACCESS_KEY_ID present'; Pass = ($names -contains 'AWS_ACCESS_KEY_ID') }
  [pscustomobject]@{ Check = 'AWS_SECRET_ACCESS_KEY present'; Pass = ($names -contains 'AWS_SECRET_ACCESS_KEY') }
  [pscustomobject]@{ Check = 'AWS_SESSION_TOKEN optional'; Pass = ($true) }
) | Format-Table -AutoSize
```

### 2E. One-URL environment contract

Runtime token requests must include `environment=test|live`, and the resolver
reads only `api-center-tribe-secret-<tribe-id>-test|live` Secret Manager
records. Do not add missing-environment fallback keys to the live ConfigMap.

### 2F. Optional control-plane database keys

Do not add these until a Postgres database exists and the initial migration has
been deployed. Redis remains the active registry source during the migration
window.

```json
{
  "DATABASE_ENABLED": "true",
  "DATABASE_URL": "postgresql://api_center_app:<password>@<supabase-session-pooler-host>:5432/postgres",
  "DATABASE_PROVIDER": "supabase",
  "REGISTRY_SOURCE": "redis",
  "REGISTRY_DUAL_WRITE": "false"
}
```

Switch `REGISTRY_DUAL_WRITE=true` only after migrations are verified. Switch
`REGISTRY_SOURCE` to `postgres` only after registry backfill and Redis/Postgres
parity checks pass. See `docs/database-control-plane.md`.

Shared-service provider/business schemas are migrated from the
`api-shared-services` repo, not this gateway repo. Keep their runtime flag
disabled until each shared-service gateway is wired and tested:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true",
  "SHARED_SERVICES_DATABASE_URL": "postgresql://shared_services_app:<password>@<supabase-session-pooler-host>:5432/postgres"
}
```

Those keys belong in `api-shared-services-prod`, not `api-center-prod`.

### 3. Run smoke tests before rollout

```bash
# Inputs for smoke runs
export PUBLIC_HOSTNAME=<real-hostname>
export GATEWAY_TRIBE_ID=<registered-service-id>
export GATEWAY_TRIBE_SECRET=<registered-service-secret>
export GATEWAY_ENVIRONMENT=test

# A) Gateway token flow via /api/v1/auth/token.
# This should be issued by API Center internal JWT mode and should not call
# Descope /oauth2/v1/apps/token.
GATEWAY_RESPONSE=$(curl -sS -X POST "https://${PUBLIC_HOSTNAME}/api/v1/auth/token" \
        -H "Content-Type: application/json" \
        -d "{\"tribeId\":\"${GATEWAY_TRIBE_ID}\",\"secret\":\"${GATEWAY_TRIBE_SECRET}\",\"environment\":\"${GATEWAY_ENVIRONMENT}\"}")
echo "$GATEWAY_RESPONSE" | jq .
GATEWAY_ACCESS_TOKEN=$(echo "$GATEWAY_RESPONSE" | jq -r '.data.accessToken // empty')
GATEWAY_REFRESH_TOKEN=$(echo "$GATEWAY_RESPONSE" | jq -r '.data.refreshToken // empty')
test -n "$GATEWAY_ACCESS_TOKEN"

# B) Optional negative control: non-admin tribe token should be denied on admin routes.
curl -si "https://${PUBLIC_HOSTNAME}/api/v1/registry/scopes" \
        -H "Authorization: Bearer ${GATEWAY_ACCESS_TOKEN}" \
        | head -n 1
# Expected: HTTP/2 401 or 403

# C) Refresh endpoint behavior
if [ -n "$GATEWAY_REFRESH_TOKEN" ]; then
        curl -sS -X POST "https://${PUBLIC_HOSTNAME}/api/v1/auth/token/refresh" \
                -H "Content-Type: application/json" \
                -d "{\"refreshToken\":\"${GATEWAY_REFRESH_TOKEN}\"}" | jq .
else
        echo "No refresh token returned; check internal JWT provider configuration."
fi

# D) JWKS for API Center-signed tokens
curl -sS "https://${PUBLIC_HOSTNAME}/api/v1/auth/.well-known/jwks.json" | jq .
# Expected: keys[0].kid == "api-center-internal-1"
```

### 4. Build & push image

```bash
IMAGE="asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:$(git rev-parse --short HEAD)"

# Build using the GCP-optimised Dockerfile
docker build -f docker/Dockerfile.gcp -t "$IMAGE" .

# Authenticate Docker to Artifact Registry (once per machine)
gcloud auth configure-docker asia-southeast1-docker.pkg.dev

docker push "$IMAGE"
echo "Pushed: $IMAGE"
```

### 5. Apply manifests

**First deploy:**

```bash
kubectl apply -f infra/gcp/gke/
kubectl -n api-center rollout status deploy/api-center --timeout=5m
```

Post-deploy check:

```bash
kubectl -n api-center get pods
kubectl -n api-center logs deploy/api-center --tail=100
```

Kafka runtime verification is done in Confluent Cloud. Check that `api-center.audit.log`
receives records after traffic and that the S3 sink exports them.

### 5A. Cost optimization guardrails

See `docs/developer/gke-cost-optimization-plan.md` before changing resource
requests, HPA min/max replicas, or the PDB.

Current cost-saving profile:

- API Center CPU request is `150m`
- memory request stays `256Mi`
- HPA min replicas is `2`
- HPA max replicas is `3`
- PDB `minAvailable` is `1`
- production logs write to stdout only
- Morgan and Kafka audit skip health-check probe traffic

This keeps the same functionality and preserves one spare pod, but it is still
less resilient than the previous three-pod profile. If production-style
availability is needed again, restore HPA min `3`, max `6`, and PDB
`minAvailable: 2`.

**Subsequent image updates only:**

```bash
kubectl -n api-center set image deploy/api-center api-center="$IMAGE"
kubectl -n api-center rollout status deploy/api-center --timeout=5m
```

### 6. Verify

See **Verification Checklist** below.

For the repeatable smoke script, set these variables without printing their
values:

```bash
export APICENTER_URL=https://api-center.itsandbox.site
export APICENTER_TRIBE_ID=<owning-tribe-id>
export APICENTER_TRIBE_SECRET=<registered-service-secret>
export APICENTER_ENVIRONMENT=test
export APICENTER_PLATFORM_ADMIN_TOKEN=<token-with-platform-admin>
# or:
export APICENTER_PLATFORM_ADMIN_SECRET=<platform-admin-secret>

# Optional governed Kafka smoke:
export APICENTER_KAFKA_SMOKE_TOPIC=<allowed-tenant-topic>
```

Validate inputs only:

```bash
npm run smoke:gke:check-config
```

Run the smoke:

```bash
npm run smoke:gke
```

### 7. Post-deploy: update this doc

Update the **Current Image** table, append a **Change Log** entry, commit.

### 8. Rollback (auth provider switch)

If internal tribe-token auth fails after rollout, revert immediately with the
last known-good image and the previous auth provider selector.

```bash
# 1) Revert workload to previous ReplicaSet
kubectl -n api-center rollout undo deploy/api-center
kubectl -n api-center rollout status deploy/api-center --timeout=5m

# 2) Restore auth provider selector if needed
kubectl -n api-center edit configmap api-center-config
# Set AUTH_PROVIDER back to "descope" only if you need the old Descope M2M path.

# 3) Restore previous Secret Manager version in api-center-prod
# Keep JWT_PRIVATE_KEY/JWT_PUBLIC_KEY available until composite mode stabilizes.

# 4) Restart deployment to consume restored env
kubectl -n api-center rollout restart deploy/api-center
kubectl -n api-center rollout status deploy/api-center --timeout=5m
```

Rollback readiness checklist:

- Record previous image tag/digest before each rollout.
- Record the previous Secret Manager version number before editing auth values.
- Keep `DESCOPE_*` only if human/admin token validation still uses Descope.

---

## Verification Checklist

Run after every deploy to confirm HPA, TLS, and traffic are healthy.

```bash
# 1. All resources present
kubectl -n api-center get deploy,svc,hpa,pdb,ingress,managedcertificate

# 1A. Kafka resources present
kubectl -n kafka get kafkas,kafkanodepools,kafkausers,kafkatopics

# 2. HPA has real metrics (not <unknown>)
kubectl -n api-center get hpa api-center
# TARGETS column must show numeric percentages, e.g. "12%/70%, 30%/80%"
# <unknown> = metrics-server hasn't observed the pods yet; wait 30s and retry

# 3. Pods running and READY
kubectl -n api-center get pods

# 4. TLS cert provisioned (takes 10-20 min after DNS resolves to static IP)
kubectl -n api-center describe managedcertificate api-center-cert
# Status: Active

# 5. Health endpoint responds
curl -I https://<real-hostname>/api/v1/health/ready
# HTTP/2 200

# 6. HPA scale-up under load (requires `hey`: go install github.com/rakyll/hey@latest)
hey -z 2m -c 200 https://<real-hostname>/api/v1/health/live

# Watch in a separate terminal:
watch kubectl -n api-center get hpa,pods
# Expected: replicas climb above 2 within ~1 min

# 7. Scale-down after load stops (wait ~5 min)
kubectl -n api-center get hpa api-center
# Expected: replicas return to 2 (scaleDown.stabilizationWindowSeconds=300)

# 8. Guarded route check with platform:admin token
curl -si https://<real-hostname>/api/v1/registry/scopes \
        -H "Authorization: Bearer <platform-admin-token>" | head -n 1
# Expected: HTTP/2 200

# 9. Refresh endpoint behavior check
curl -sS -X POST https://<real-hostname>/api/v1/auth/token/refresh \
        -H "Content-Type: application/json" \
        -d '{"refreshToken":"<refresh-token-if-issued>"}' | jq .
# Expected: success response OR explicit auth error if no refresh token was issued for that grant
```

---

## Architecture Reference

See `infra/gcp/gke/README.md` for the full architecture diagram. Summary:

```
Internet → GCLB (static IP, HTTPS, ManagedCert)
        → NEG (container-native LB)
        → api-center pods (2-3, scaled by HPA on CPU 70% / mem 80%)
        → Memorystore Redis (cache + rate-limit, shared across all replicas)
        → Confluent Cloud Kafka
```

Local development differs intentionally: `deploy/local/docker-compose.yml` uses a standalone
`nginx` service with `nginx.conf` as the local entrypoint/load balancer. In GKE,
there is no nginx pod in the request path; ingress is handled by GCLB + NEG.

Secrets now preload before Nest boot via `src/config/gcp-secret-loader.ts` and are rechecked by `secrets.service.ts`.
This guarantees auth and Kafka config read Secret Manager values during provider initialization.
The pod KSA `api-center` is Workload Identity-bound to
`api-center-gke@api-center-496422.iam.gserviceaccount.com`.

---

## Change Log

> Append-only. Add a new row for every material deployment-affecting change.

| Date | Commit | Change | Reason |
|---|---|---|---|
| 2026-04-10 | initial | Created living deployment doc; GKE manifests (`00`–`80`), `provision.sh`, `README.md` authored | Initial GKE deployment setup with HPA |
| 2026-04-11 | pending | Switched GKE runtime auth provider selector to `descope`; added rollback runbook and auth provider state notes | Legacy IdP to Descope migration prep |
| 2026-04-12 | e1cb9f7 | Added explicit Secret Manager payload update procedure for Descope keys, pre-rollout smoke commands, and auth/refresh verification checks | Make Descope cutover execution deterministic and rollback-safe |
| 2026-04-12 | pending | Removed hardcoded JWT private key from docker-compose and switched to environment interpolation | Eliminate committed secret material and enforce env-based key management |
| 2026-04-12 | pending | Tightened Docker build context (`.dockerignore`) and restored default npm audit visibility during root/GCP image dependency install | Reduce build overhead and improve supply-chain visibility without changing runtime behavior |
| 2026-04-12 | pending | Set explicit production CORS origin and added required Descope metadata (`DESCOPE_JWKS_URI` and related env) in GKE ConfigMap | Resolve CrashLoop caused by missing Descope JWKS configuration and align production auth bootstrap |
| 2026-04-17 | pending | Extended CI workflow with `check:contracts` gate for AP Center/SDK compatibility snapshot validation | Prevent drift between gateway contract surface and shared SDK wrapper commitments before deploy |
| 2026-04-17 | pending | Added CI boundary enforcement step (`npm run check:boundaries`) in `.github/workflows/ci.yml` | Prevent gateway/SDK boundary drift and block local SDK source reintroduction before merge |
| 2026-04-17 | pending | Updated local compose documentation to reference external SDK ownership (`api-shared-services`) and moved SDK publishing responsibility out of gateway package metadata | Complete repository split between gateway runtime and shared SDK while keeping deployment behavior unchanged |
| 2026-05-11 | pending | Removed self-hosted Kafka manifests/scripts and aligned GKE docs to Confluent Cloud | Make Confluent Cloud the only Kafka runtime path |
| 2026-05-11 | pending | Added Confluent Secret Manager validation and GKE cost optimization guardrails | Prevent rollout with non-Confluent broker values and document first safe Autopilot cost lever |
| 2026-05-11 | pending | Switched API Center to low-credit HPA profile: 2-3 pods, PDB minAvailable 1, CPU request 150m | Reduce idle Autopilot workload spend while keeping one spare pod |
| 2026-05-11 | pending | Disabled in-container production file logs and skipped health probes from Morgan/audit streams | Reduce recurring Cloud Logging, Kafka, Confluent connector, and S3 noise without changing API behavior |
| 2026-05-14 | 73bfd90 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:73bfd90`; removed the legacy OIDC provider implementation, selector option, env examples, and docs references | Reduce auth surface area now that API Center-signed tribe JWTs are the production M2M path |
| 2026-05-14 | 96d2fd7 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:96d2fd7`; enabled composite auth with API Center-issued tribe JWTs, Descope validation fallback, JWKS exposure, and inactive-provider initialization guards | Roll out long-term tribe token automation without initializing unused providers |
| 2026-05-14 | 8a15338 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:8a15338`; added protected analytics endpoints for shared-service usage, gateway traffic, provider usage, alerts, and audit events | Roll out management-console observability runtime |
| 2026-05-13 | 9dab869 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:9dab869`; removed legacy API Center Google auth, migrated wildcard routes to Nest 11 named wildcards, and raised the response listener budget | Clear post-upgrade runtime warnings while keeping Google auth in shared services |
| 2026-05-13 | 5c55833 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:5c55833`; kept Node 24 LTS runtime target with the proxy v4 ESM bridge | Roll out the dependency upgrade on the production LTS runtime |
| 2026-05-11 | 512702a | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:512702a`; applied corrected ConfigMap, 2-3 HPA, PDB minAvailable 1, and CPU request 150m | Roll out Confluent/GKE reliability changes and restore the intended low-credit GKE profile |
| 2026-04-18 | pending | Reduced HPA max replicas from 30 to 6 in `infra/gcp/gke/50-hpa.yaml` for current cluster quota envelope | Prevent futile autoscaler scale-up attempts until node CPU/memory/SSD quotas are increased |
| 2026-05-14 | manual-tribe-secret-20260514123048 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:manual-tribe-secret-20260514123048`; enabled per-tribe Secret Manager lookup and verified `smoke-tribe` token issuance from `api-center-tribe-secret-smoke-tribe` | Stop editing `api-center-prod` for ordinary tribe secret onboarding |
| 2026-05-15 | shared-service-export-20260515184111 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:shared-service-export-20260515184111`; added sanitized shared-service export publishing for `sms`, `email`, `payment`, `otp`, `geo`, and `gauth` | Export shared-service usage to dedicated Confluent topics for S3 lake ingestion |
| 2026-05-16 | migration-20260516 | Created new GCP target project resources in `api-center-496422` / `asia-southeast1`, created fresh Secret Manager versions, deployed API Center and shared services, and verified internal readiness HTTP 200. DNS cutover is still pending. | Move API Center hosting away from the old GCP project while keeping Confluent/S3 external |
| 2026-05-19 | 80440b7 | Applied Supabase migration `20260519000000_add_owner_tribe_id.sql` and deployed image `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:tribe-owner-80440b7-202605190539`; readiness returned HTTP 200 after rollout | Roll out explicit owner-tribe boundaries, prefixed topic governance, and per-tribe event-topic support |
| 2026-05-20 | 3bfaaea-local | Applied test Supabase migrations `20260519000000_add_owner_tribe_id.sql` and `20260520000000_add_service_registration_requests.sql`; deployed test image `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:tribe-owner-test-3bfaaea-20260520023812`; live test accepted `ownerTribeId` and `sourceServiceId` payloads and kept `api-center-test-s3-sink` running | Unblock the next tribe data-pipeline slice in the test environment without touching production |
| 2026-05-20 | pending | CI and Docker image builds now run `npm run db:generate` before TypeScript build and copy `prisma/` into the Docker builder stage | Ensure Prisma Client is available during API Center CI, image build, and test-environment deployment |
| 2026-05-21 | d1eb7e6-local | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-governance-fix-d1eb7e6-202605210317`; route smoke for data-pipeline health, quality, shared-service usage, gateway decisions, and cost returned HTTP 200 with `success=true` | Add Phase 9 platform governance endpoints while recording that GKE Athena runtime remains fixture-mode until a live provider is configured |
| 2026-05-21 | 7b854f58-5998-478f-b3e2-6d5afe931131 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-sdk-region-d1eb7e6-20260521150223`; created dedicated AWS runtime principal `api-center-athena-reader-gke`; corrected Athena runtime region to `ap-southeast-2`; test route smoke returned HTTP 200 with `meta.source=athena-proxy` for health, quality, shared-service usage, gateway decisions, and cost | Remove AWS CLI shell-out blocker and make GKE API Center read curated Athena views through the AWS SDK |
| 2026-05-21 | 6df72593-0dbb-4e94-9fc7-ac54fcb739bb | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-cancel-d1eb7e6-20260521152340`; runtime policy default version `v4` removes `s3:DeleteObject`; route smoke still returned HTTP 200 with `meta.source=athena-proxy` for all test data-pipeline routes | Close review findings for Phase 1 by cancelling timed-out Athena queries and preserving result evidence |
| 2026-05-21 | 8451ea31-4885-4a60-b99c-a66b3b3fea34 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-feedback-durable-reviewfix-d1eb7e6-20260521175948`; live feedback smoke persisted reviewed evidence into `api_center_ops.pipeline_feedback_actions` with `correlationId=corr_phase9_reviewfix_smoke` | Close durable feedback action findings and make management feedback writes database-backed |
| 2026-05-21 | 7b812838-d455-452e-872f-261499a52555 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-partition-override-d1eb7e6-20260521203007`; data-pipeline routes accept `year`, `month`, and `day` query parameters while defaulting to current UTC when omitted; dated test/prod smoke for `2026-05-20` returned live health and quality rows | Let operators review populated historical evidence partitions without freezing deployed dashboards on stale ConfigMap dates |
| 2026-05-21 | 8aefc271-4a38-4eb8-9681-84465ccb8954 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-signals-fix-d1eb7e6-20260521235419`; dated test/prod smoke for `2026-05-20` returned `meta.source=athena-proxy` for decision signals with test count=3 and prod count=0 | Roll out Phase 11 deterministic decision signals and keep runtime source aligned with the Athena governance provider |
| 2026-05-22 | 9884dad4-96d9-4cd1-b669-43a780daf797 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix-d1eb7e6-20260522001734`; live smoke confirmed decision-signals stayed Athena-backed and false-positive signal feedback creates/lists with `status=closed` | Close Phase 11 review findings for signal-specific false-positive actions and evidence/status visibility |
| 2026-05-22 | 9a6b5a94-ac35-4efc-aff3-d2a0a7a3cc84 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix2-d1eb7e6-20260522003353`; live smoke confirmed valid false-positive signal feedback succeeds and invalid false-positive event feedback is rejected with HTTP 400 | Enforce the signal-only false-positive contract at API and database boundaries |
| 2026-05-22 | test-rollout-d1eb7e6 | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix2-d1eb7e6-20260522003353` to namespace `api-center-test`; added non-secret Athena data-pipeline ConfigMap settings, created dedicated test AWS runtime principal `api-center-athena-reader-gke-test`, applied feedback table migrations to the test DB, and verified test routes through the deployed management app | Bring the test API Center lane up to the same Phase 11 data-pipeline capability used by the management test deployment |
| 2026-05-23 | 306ef8a | Deployed `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:apicenter-platform-window-306ef8a-20260523105623` to namespace `api-center-test`; live `windowDays=30` smoke returned Athena-backed rows for gateway decisions, shared-service usage, Athena cost, and decision signals | Roll out APICenter platform-only 30-day governance windows for synthetic test history |
| 2026-06-28 | pending | Documented one-URL environment contract rollout flags, environment-scoped tribe secrets, and token smoke requests that include `environment` | Make enforce-mode cutover and warn-mode rollback deterministic |
| 2026-06-28 | b9c811f | Deployed `asia-southeast1-docker.pkg.dev/apicenter-alpha-20260623/api-center/api-center:legacy-routing-b9c811f-20260628`; removed live ConfigMap legacy routing keys; readiness returned HTTP 200 with registry up and 22 services; final cleanup evidence reports 0 legacy Secret Manager records | Roll out and complete stored/code-level legacy routing cleanup |
| 2026-07-04 | 76c9ef6c-205e-41bf-93d2-c6eb5235a85f | Created parallel Cloud Run external Application Load Balancer on `136.68.196.7` while keeping `api-center.itsandbox.site` DNS on GKE IP `136.110.192.169`; forced-resolution Cloud Run LB smoke passed with 100 requests, concurrency 10, 0 failures, p95 `359ms` | Prepare DNS cutover without modifying the live GKE ingress or losing the GKE rollback path |
