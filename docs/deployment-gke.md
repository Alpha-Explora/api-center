# api-center — GKE Deployment (Living Document)

> **This file is the living state record for the GKE deployment.**
> `gcp/gke/README.md` is the stable how-to. This file tracks what is actually running,
> why decisions were made, and what changed. Always update this file in the same commit
> as any change to `gcp/gke/**`, `docker/Dockerfile.gcp`, root `Dockerfile`,
> `.dockerignore`, `docker-compose.yml`, or CI/CD workflows.

---

## Current Environment

| Parameter | Value |
|---|---|
| GCP Project ID | `api-center-492808` |
| Region | `us-central1` |
| Cluster name | `api-center` (Autopilot) |
| Namespace | `api-center` |
| Artifact Registry | `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center` |
| Static IP name | `api-center-ip` |
| Public hostname | `api-center.itsandbox.site` |
| Secret Manager secret | `api-center-prod` |
| Auth provider | `composite` (`AUTH_PROVIDER=composite` in ConfigMap): API Center-issued tribe JWTs with Descope validation fallback |
| Memorystore cache host | `10.34.181.131:6379` |
| Memorystore rate-limit host | `10.34.181.131:6379` (shared low-traffic Redis) |
| Kafka brokers | Confluent Cloud bootstrap endpoint from Secret Manager |
| Kafka topology | Managed by Confluent Cloud |

---

## Current Image

| Field | Value |
|---|---|
| Image | `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:96d2fd7` |
| Built from | `96d2fd7` (`main`) |
| Last deployed | `2026-05-14` |
| Deployed by | Codex-assisted operator rollout |

> After each deploy, update the rows above with the full image tag (use git SHA, not `:latest`) and commit.

---

## HPA Configuration

Source of truth: `gcp/gke/50-hpa.yaml`. This section is the "why these numbers" companion.

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
grep -rn 'example.com\|example.internal' gcp/gke/
```

| File | Placeholder | Replace with |
|---|---|---|
| `gcp/gke/70-managedcert.yaml` | `api-center.example.com` | Real public hostname |
| `gcp/gke/80-ingress.yaml` | `api-center.example.com` | Real public hostname |

---

## Deploy Runbook

### 0. Pre-flight

```bash
# Confirm correct GCP project
gcloud config get-value project
# → api-center-492808

# Get cluster credentials
gcloud container clusters get-credentials api-center --region=us-central1

# Confirm kubectl context
kubectl config current-context

# Confirm Artifact Registry exists
gcloud artifacts repositories describe api-center --location=us-central1
```

### 1. One-time provisioning (skip if cluster already up)

```bash
PROJECT_ID=api-center-492808 \
REGION=us-central1 \
SECRET_NAME=api-center-prod \
PUBLIC_HOSTNAME=<real-hostname> \
./gcp/gke/provision.sh
```

The script prints Memorystore IPs, static IP, and image registry path. Update the
**Current Environment** table above and fill the manifest placeholders before continuing.

Point your DNS A record for `<real-hostname>` at the static IP the script prints.

### 2. Fill placeholders

```bash
# Verify no unresolved placeholders remain
grep -rn 'example.com\|example.internal' gcp/gke/
```

Replace every placeholder in `gcp/gke/*.yaml` (see **Known Placeholders** above).

### 2A. Update Secret Manager payload (internal tribe JWT + Descope fallback)

Export current payload, add the API Center internal JWT keys, and keep Descope
project metadata for human/admin-token validation during the composite rollout.

```bash
gcloud secrets versions access latest --secret=api-center-prod > /tmp/api-center-prod.current.json
cp /tmp/api-center-prod.current.json /tmp/api-center-prod.next.json

# Edit /tmp/api-center-prod.next.json and ensure it contains at least:
# JWT_PRIVATE_KEY=<persistent RS256 private key PEM with escaped newlines>
# JWT_PUBLIC_KEY=<matching RS256 public key PEM with escaped newlines>
# TRIBE_SECRET_<SERVICE_ID_UPPER>=<sha256 of plaintext tribe secret>
# DESCOPE_BASE_URL=https://api.descope.com
# DESCOPE_PROJECT_ID=P3CDYwDpERyUJPEfqnppZM7HLySN
# DESCOPE_ISSUER=https://api.descope.com/v1/apps/P3CDYwDpERyUJPEfqnppZM7HLySN
# DESCOPE_AUDIENCE=<token aud claim; start with project id if needed>
# DESCOPE_JWKS_URI=https://api.descope.com/P3CDYwDpERyUJPEfqnppZM7HLySN/.well-known/jwks.json

gcloud secrets versions add api-center-prod --data-file=/tmp/api-center-prod.next.json
gcloud secrets versions list api-center-prod --limit=5
```

Minimal payload shape for the auth switch. Non-secret values such as
`AUTH_PROVIDER`, issuer, audience, and TTLs are set in `gcp/gke/20-configmap.yaml`;
include them here only if you intentionally run without that ConfigMap.

```json
{
        "JWT_PRIVATE_KEY": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----",
        "JWT_PUBLIC_KEY": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",
        "TRIBE_SECRET_SMOKE_TRIBE": "<sha256-hash>",
        "DESCOPE_BASE_URL": "https://api.descope.com",
        "DESCOPE_PROJECT_ID": "P3CDYwDpERyUJPEfqnppZM7HLySN",
        "DESCOPE_ISSUER": "https://api.descope.com/v1/apps/P3CDYwDpERyUJPEfqnppZM7HLySN",
        "DESCOPE_AUDIENCE": "P3CDYwDpERyUJPEfqnppZM7HLySN",
        "DESCOPE_JWKS_URI": "https://api.descope.com/P3CDYwDpERyUJPEfqnppZM7HLySN/.well-known/jwks.json"
}
```

### 2B. Confirm runtime selector

`gcp/gke/20-configmap.yaml` should be set to `AUTH_PROVIDER: "composite"`.
Composite mode issues API Center internal JWTs for tribes and validates internal
JWTs first, then Descope tokens as a migration fallback.

```bash
kubectl -n api-center get configmap api-center-config -o jsonpath='{.data.AUTH_PROVIDER}{"\n"}'
# Expected: composite
```

### 2C. Configure Kafka client credentials in Secret Manager

The APICenter deployment uses Confluent Cloud Kafka. `gcp/gke/20-configmap.yaml`
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
gcloud.cmd secrets versions access latest --secret=api-center-prod --project api-center-492808 |
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

### 3. Run smoke tests before rollout

```bash
# Inputs for smoke runs
export PUBLIC_HOSTNAME=<real-hostname>
export GATEWAY_TRIBE_ID=<registered-service-id>
export GATEWAY_TRIBE_SECRET=<registered-service-secret>

# A) Gateway token flow via /api/v1/auth/token.
# This should be issued by API Center internal JWT mode and should not call
# Descope /oauth2/v1/apps/token.
GATEWAY_RESPONSE=$(curl -sS -X POST "https://${PUBLIC_HOSTNAME}/api/v1/auth/token" \
        -H "Content-Type: application/json" \
        -d "{\"tribeId\":\"${GATEWAY_TRIBE_ID}\",\"secret\":\"${GATEWAY_TRIBE_SECRET}\"}")
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
IMAGE="us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:$(git rev-parse --short HEAD)"

# Build using the GCP-optimised Dockerfile
docker build -f docker/Dockerfile.gcp -t "$IMAGE" .

# Authenticate Docker to Artifact Registry (once per machine)
gcloud auth configure-docker us-central1-docker.pkg.dev

docker push "$IMAGE"
echo "Pushed: $IMAGE"
```

### 5. Apply manifests

**First deploy:**

```bash
kubectl apply -f gcp/gke/
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
export APICENTER_TRIBE_ID=<registered-service-id>
export APICENTER_TRIBE_SECRET=<registered-service-secret>
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
- Keep `KEYCLOAK_*` and `DESCOPE_*` payload keys side-by-side during stabilization.

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

See `gcp/gke/README.md` for the full architecture diagram. Summary:

```
Internet → GCLB (static IP, HTTPS, ManagedCert)
        → NEG (container-native LB)
        → api-center pods (2-3, scaled by HPA on CPU 70% / mem 80%)
        → Memorystore Redis (cache + rate-limit, shared across all replicas)
        → Confluent Cloud Kafka
```

Local development differs intentionally: `docker-compose.yml` uses a standalone
`nginx` service with `nginx.conf` as the local entrypoint/load balancer. In GKE,
there is no nginx pod in the request path; ingress is handled by GCLB + NEG.

Secrets now preload before Nest boot via `src/config/gcp-secret-loader.ts` and are rechecked by `secrets.service.ts`.
This guarantees auth and Kafka config read Secret Manager values during provider initialization.
The pod KSA `api-center` is Workload Identity-bound to
`api-center-gke@api-center-492808.iam.gserviceaccount.com`.

---

## Change Log

> Append-only. Add a new row for every material deployment-affecting change.

| Date | Commit | Change | Reason |
|---|---|---|---|
| 2026-04-10 | initial | Created living deployment doc; GKE manifests (`00`–`80`), `provision.sh`, `README.md` authored | Initial GKE deployment setup with HPA |
| 2026-04-11 | pending | Switched GKE runtime auth provider selector to `descope`; added rollback runbook and auth provider state notes | Big-bang Keycloak → Descope migration prep |
| 2026-04-12 | e1cb9f7 | Added explicit Secret Manager payload update procedure for Descope keys (with Keycloak retention), pre-rollout smoke commands, and auth/refresh verification checks | Make Descope cutover execution deterministic and rollback-safe |
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
| 2026-05-14 | 96d2fd7 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:96d2fd7`; enabled composite auth with API Center-issued tribe JWTs, Descope validation fallback, JWKS exposure, and inactive-provider initialization guards | Roll out long-term tribe token automation without initializing unused Keycloak/dev-jwt providers |
| 2026-05-14 | 8a15338 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:8a15338`; added protected analytics endpoints for shared-service usage, gateway traffic, provider usage, alerts, and audit events | Roll out management-console observability runtime |
| 2026-05-13 | 9dab869 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:9dab869`; removed legacy API Center Google auth, migrated wildcard routes to Nest 11 named wildcards, and raised the response listener budget | Clear post-upgrade runtime warnings while keeping Google auth in shared services |
| 2026-05-13 | 5c55833 | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:5c55833`; kept Node 24 LTS runtime target with the proxy v4 ESM bridge | Roll out the dependency upgrade on the production LTS runtime |
| 2026-05-11 | 512702a | Deployed image `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:512702a`; applied corrected ConfigMap, 2-3 HPA, PDB minAvailable 1, and CPU request 150m | Roll out Confluent/GKE reliability changes and restore the intended low-credit GKE profile |
| 2026-04-18 | pending | Reduced HPA max replicas from 30 to 6 in `gcp/gke/50-hpa.yaml` for current cluster quota envelope | Prevent futile autoscaler scale-up attempts until node CPU/memory/SSD quotas are increased |
