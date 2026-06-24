# APICenter on GKE (Autopilot) with Horizontal Pod Autoscaling

This directory deploys APICenter to **Google Kubernetes Engine (Autopilot)** with native **Horizontal Pod Autoscaling**, Memorystore Redis, Workload Identity, and a Google-managed TLS Ingress.

> Pick **GKE** over [Cloud Run](../cloudrun.yaml) when you need:
> - Replicas beyond Cloud Run's practical ceiling (~10–100 with cold-start jitter)
> - VPC-only access to Memorystore / private services
> - Long-lived connections (gRPC streaming, SSE, WebSockets)
> - Fine control over rollout strategy, PDBs, topology spread

---

## Architecture

```
Internet
   │
   ▼  HTTPS (443)
┌────────────────────────────────────────────┐
│  Google Cloud Load Balancer (GCLB)         │
│  • Static global IP (api-center-ip)        │
│  • ManagedCertificate (auto-renewed)       │
│  • Health check → /api/v1/health/ready     │
└────────────────────┬───────────────────────┘
                     │ container-native LB (NEG)
   ┌─────────────────┼─────────────────┐
   ▼                 ▼                 ▼
┌─────────┐      ┌─────────┐      ┌─────────┐
│ pod 1   │      │ pod 2   │      │ pod N   │   ← HPA scales 3 → 30
│ (auto)  │      │ (auto)  │      │ (auto)  │      on CPU 70% / mem 80%
└────┬────┘      └────┬────┘      └────┬────┘
     └─────────────┬──┴──────────────────┘
                   ▼
        ┌──────────────────────┐
        │ Memorystore Redis    │
        │ • cache (registry)   │
        │ • rate-limit         │
        └──────────────────────┘
```

All pods are stateless and identical. Registry entries, refresh tokens, and rate-limit counters live in one shared Memorystore instance for the current low-traffic profile. Split rate-limit counters into a second Redis instance only when traffic is high enough to justify the extra cost.

Optional Postgres control-plane support is present in the application, but it is
not the active registry source until Supabase migrations are applied, Redis
data is backfilled, and parity checks pass. Keep
`DATABASE_ENABLED=false`, `REGISTRY_SOURCE=redis`, and
`REGISTRY_DUAL_WRITE=false` for the current deployed shape.

---

## Files

| File | Purpose |
|---|---|
| `00-namespace.yaml` | `api-center` namespace |
| `10-serviceaccount.yaml` | KSA bound to GCP SA via Workload Identity |
| `20-configmap.yaml` | Non-secret env (Redis URLs, project, secret name, CORS) |
| `30-deployment.yaml` | Deployment + probes + resource requests (HPA-tuned) |
| `40-service.yaml` | ClusterIP Service with NEG + BackendConfig annotations |
| `41-backendconfig.yaml` | GCLB health-check + draining config |
| `50-hpa.yaml` | HPA: 2-3 replicas, CPU 70% / mem 80%, fast scale-up |
| `60-pdb.yaml` | PDB `minAvailable: 1` for the current low-credit profile |
| `70-managedcert.yaml` | Google-managed TLS cert |
| `80-ingress.yaml` | GCE Ingress (HTTPS only, static IP) |
| `provision.sh` | One-time GCP setup (cluster, Memorystore, Workload Identity, IP) |

---

## Deploy

### 1. Provision GCP resources (one-time)

```bash
PROJECT_ID=apicenter-alpha-20260623 \
REGION=asia-southeast1 \
SECRET_NAME=api-center-prod \
PUBLIC_HOSTNAME=api.example.com \
./provision.sh
```

The script prints the values you need to plug into the manifests.

### 2. Fill in placeholders

Every `<PLACEHOLDER>` in the YAML files. Quick search:

```bash
grep -rn '<[A-Z_]*>' gcp/gke/
```

You will need to replace:
- `<PROJECT_ID>` (in `10-serviceaccount.yaml`, `20-configmap.yaml`)
- `<SECRET_NAME>` (in `20-configmap.yaml`)
- `<CACHE_REDIS_HOST>` / `<RATELIMIT_REDIS_HOST>` (in `20-configmap.yaml`)
- `<ALLOWED_ORIGINS>` (in `20-configmap.yaml`)
- `<IMAGE>` (in `30-deployment.yaml`)
- `<PUBLIC_HOSTNAME>` (in `70-managedcert.yaml`, `80-ingress.yaml`)
Add these secrets to Secret Manager payload before rollout:
- `KAFKA_BROKERS`
- `KAFKA_SASL_USERNAME`
- `KAFKA_SASL_PASSWORD`
- `JWT_PRIVATE_KEY`
- `JWT_PUBLIC_KEY`
- `TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>`

`20-configmap.yaml` sets `AUTH_PROVIDER=composite`. In this mode API Center
issues tribe machine-to-machine JWTs itself and still validates Descope tokens as
a migration fallback. Do not add per-tribe Descope client secrets unless you
intentionally change the provider back to `descope`.

For Confluent Cloud, the Kafka portion of `api-center-prod` must look like:

```json
{
  "KAFKA_BROKERS": "pkc-xxxxx.<region>.<provider>.confluent.cloud:9092",
  "KAFKA_SASL_MECHANISM": "plain",
  "KAFKA_SASL_USERNAME": "<confluent-kafka-api-key>",
  "KAFKA_SASL_PASSWORD": "<confluent-kafka-api-secret>",
  "KAFKA_SSL_ENABLED": "true",
  "KAFKA_SSL_REJECT_UNAUTHORIZED": "true"
}
```

Do not include `KAFKA_SSL_CA_PEM`, protocol prefixes such as `SASL_SSL://`, or old
in-cluster brokers ending in `.svc.cluster.local:9092`.

### 3. Apply

```bash
gcloud container clusters get-credentials api-center --region=asia-southeast1 --project=apicenter-alpha-20260623
kubectl apply -f gcp/gke/
```

Restart the deployment after updating the Secret Manager payload:

```bash
kubectl -n api-center rollout restart deploy/api-center
kubectl -n api-center rollout status deploy/api-center --timeout=10m
```

### 3a. Apply the test namespace overlay

The low-cost test/live split keeps the same cluster and deploys the test stack
into `api-center-test`.

```powershell
kubectl kustomize gcp/gke/test --load-restrictor LoadRestrictionsNone | kubectl apply -f -
kubectl -n api-center-test rollout status deploy/api-center --timeout=10m
```

The test overlay sets:

```text
GCP_SECRET_NAME=api-center-test
KAFKA_TOPIC_PREFIX=test.
api-center-test.itsandbox.site
api-center-test-ip
```

Point Cloudflare DNS for `api-center-test.itsandbox.site` to the reserved test
IP before expecting the managed certificate to become active.

Verify API Center is reading Confluent credentials:

```bash
kubectl -n api-center logs deploy/api-center --tail=100
kubectl -n api-center get pods
```

Kafka records are verified in Confluent Cloud, not through in-cluster Kafka tools.

Cost optimization guidance lives in:

```text
docs/developer/gke-cost-optimization-plan.md
```

For the current Autopilot cluster, optimize pod requests and HPA settings rather
than trying to edit node pools directly.

### 4. Wait for the Ingress + cert

```bash
kubectl -n api-center get ingress api-center -w
kubectl -n api-center describe managedcertificate api-center-cert
```

Cert provisioning takes 10–20 minutes after DNS resolves to the static IP.

---

## Rolling a new image

```bash
kubectl -n api-center set image deploy/api-center \
  api-center=asia-southeast1-docker.pkg.dev/$PROJECT/api-center/api-center:vX.Y.Z
kubectl -n api-center rollout status deploy/api-center
```

Before applying static manifests, confirm `30-deployment.yaml` will not roll the
deployment back to a stale pinned image tag. Prefer `kubectl set image` with the
intended build tag, record the tag in release evidence, then apply only
non-image manifest changes.

---

## Verify HPA

```bash
# Check the HPA has metrics (TARGETS column should show real percentages,
# not <unknown>)
kubectl -n api-center get hpa api-center

# Drive synthetic load
hey -z 2m -c 200 https://api.example.com/api/v1/health/live

# Watch it scale
watch kubectl -n api-center get hpa,pods
```

Expected: replicas climb past 2 within ~1 minute, settle, then scale back down ~5 minutes after load stops (matches `scaleDown.stabilizationWindowSeconds: 300` in `50-hpa.yaml`).

---

## Notes

- Kafka uses Confluent Cloud. Store broker and SASL credentials in GCP Secret Manager before rollout.
- The active low-credit profile uses HPA min `2`, max `3`, and PDB `minAvailable: 1`. This saves idle spend while keeping one spare pod.
- **Request-rate-based scaling** (e.g. RPS) requires the Cloud Monitoring custom-metrics adapter and an external metric on the GCLB. Left as a `TODO` in `50-hpa.yaml`.
- **Cloud Armor** can be attached by uncommenting the `securityPolicy` block in `41-backendconfig.yaml`.


