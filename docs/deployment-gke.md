c# api-center — GKE Deployment (Living Document)

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
| Public hostname | `api-center.example.com` ⚠️ **placeholder — replace before applying** |
| Secret Manager secret | `api-center-prod` |
| Memorystore cache host | `10.34.181.131:6379` |
| Memorystore rate-limit host | `10.63.215.147:6379` |
| Kafka brokers | `localhost:9092` ⚠️ **placeholder — replace with Confluent Cloud broker** |

---

## Current Image

| Field | Value |
|---|---|
| Image | `us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:latest` |
| Built from | _(not yet deployed — update this after first push)_ |
| Last deployed | _(not yet deployed)_ |
| Deployed by | _(not yet deployed)_ |

> After each deploy, update the rows above with the full image tag (use git SHA, not `:latest`) and commit.

---

## HPA Configuration

Source of truth: `gcp/gke/50-hpa.yaml`. This section is the "why these numbers" companion.

| Parameter | Value | Rationale |
|---|---|---|
| Min replicas | 3 | Matches `PDB.minAvailable=2` with one slot of headroom for rolling drains |
| Max replicas | 30 | Autopilot provisions nodes on demand; raise if traffic studies show higher peaks |
| CPU target | 70% | Leaves headroom for bursts before a scale-up triggers |
| Memory target | 80% | Memory is less spiky than CPU; 80% avoids OOM while not wasting capacity |
| Scale-up window | 30 s | Fast absorption of traffic spikes |
| Scale-up policy | `max(100% pods/30s, +4 pods/30s)` | Doubles or adds 4, whichever is larger |
| Scale-down window | 300 s | 5-minute cooldown prevents thrashing after brief traffic lulls |
| Scale-down policy | max 50% per 60 s | Gradual ramp-down to avoid dropping pods that will be needed again |

**Resource requests** (set in `30-deployment.yaml`, referenced by HPA for utilisation calculation):

| Resource | Request | Limit |
|---|---|---|
| CPU | 250m | 1000m |
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
grep -rn 'example.com\|localhost:9092' gcp/gke/
```

| File | Placeholder | Replace with |
|---|---|---|
| `gcp/gke/70-managedcert.yaml` | `api-center.example.com` | Real public hostname |
| `gcp/gke/80-ingress.yaml` | `api-center.example.com` | Real public hostname |
| `gcp/gke/20-configmap.yaml` | `KAFKA_BROKERS: localhost:9092` | Confluent Cloud or in-cluster broker address |
| `gcp/gke/20-configmap.yaml` | `ALLOWED_ORIGINS: "*"` | Comma-separated list of actual allowed origins |

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
grep -rn 'example.com\|localhost:9092' gcp/gke/
```

Replace every placeholder in `gcp/gke/*.yaml` (see **Known Placeholders** above).

### 3. Build & push image

```bash
IMAGE="us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:$(git rev-parse --short HEAD)"

# Build using the GCP-optimised Dockerfile
docker build -f docker/Dockerfile.gcp -t "$IMAGE" .

# Authenticate Docker to Artifact Registry (once per machine)
gcloud auth configure-docker us-central1-docker.pkg.dev

docker push "$IMAGE"
echo "Pushed: $IMAGE"
```

### 4. Apply manifests

**First deploy:**

```bash
kubectl apply -f gcp/gke/
kubectl -n api-center rollout status deploy/api-center --timeout=5m
```

**Subsequent image updates only:**

```bash
kubectl -n api-center set image deploy/api-center api-center="$IMAGE"
kubectl -n api-center rollout status deploy/api-center --timeout=5m
```

### 5. Verify

See **Verification Checklist** below.

### 6. Post-deploy: update this doc

Update the **Current Image** table, append a **Change Log** entry, commit.

---

## Verification Checklist

Run after every deploy to confirm HPA, TLS, and traffic are healthy.

```bash
# 1. All resources present
kubectl -n api-center get deploy,svc,hpa,pdb,ingress,managedcertificate

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
# Expected: replicas climb above 3 within ~1 min

# 7. Scale-down after load stops (wait ~5 min)
kubectl -n api-center get hpa api-center
# Expected: replicas return to 3 (scaleDown.stabilizationWindowSeconds=300)
```

---

## Architecture Reference

See `gcp/gke/README.md` for the full architecture diagram. Summary:

```
Internet → GCLB (static IP, HTTPS, ManagedCert)
        → NEG (container-native LB)
        → api-center pods (3–30, scaled by HPA on CPU 70% / mem 80%)
        → Memorystore Redis (cache + rate-limit, shared across all replicas)
```

Secrets load at startup via `secrets.service.ts` → GCP Secret Manager. No key files in the image.
The pod KSA `api-center` is Workload Identity-bound to
`api-center-gke@api-center-492808.iam.gserviceaccount.com`.

---

## Change Log

> Append-only. Add a new row for every material deployment-affecting change.

| Date | Commit | Change | Reason |
|---|---|---|---|
| 2026-04-10 | initial | Created living deployment doc; GKE manifests (`00`–`80`), `provision.sh`, `README.md` authored | Initial GKE deployment setup with HPA |
