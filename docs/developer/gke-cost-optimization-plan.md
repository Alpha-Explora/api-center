# GKE Cost Optimization Plan

Date: 2026-05-11

Goal: reduce GKE and Confluent spend without changing API Center functionality.

## Current Live Snapshot

Observed from the `api-center` GKE cluster on 2026-05-11:

| Area | Current state |
| --- | --- |
| Cluster | `api-center` in `us-central1` |
| Mode | GKE Autopilot-style node management; node pools cannot be modified directly |
| API Center pods | 3 running pods before cost-profile change |
| HPA | was min `3`, max `6`; cost profile changes this to min `2`, max `3` |
| PDB | was `minAvailable: 2`; cost profile changes this to `minAvailable: 1` |
| Deployment request | was `250m` CPU, `256Mi` memory per pod; cost profile changes CPU to `150m` |
| Deployment limit | `1` CPU, `512Mi` memory per pod |
| HPA current CPU | about `26%` of requested CPU |
| HPA current memory | about `64%` of requested memory |
| Pod CPU usage | about `61m`, `61m`, `82m` |
| Pod memory usage | about `80Mi`, `165Mi`, `244Mi` |
| Node pool control | `gcloud container node-pools list` returns Autopilot node-pool access error |

## Immediate Rollout Blocker

Do not restart API Center until `KAFKA_BROKERS` is corrected in Secret Manager.

The latest `api-center-prod` secret has the required Kafka keys and no
`KAFKA_SSL_CA_PEM`, but the broker value does not currently match the required
Confluent Cloud bootstrap host shape.

Required shape:

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

Rules:

- Do not include `SASL_SSL://` or any protocol prefix.
- Do not use the Confluent cluster ID as the broker.
- Do not use the Schema Registry endpoint.
- Do not use the old Kubernetes broker ending in `.svc.cluster.local:9092`.
- Do not include `KAFKA_SSL_CA_PEM` for Confluent Cloud.

## Phase 0: Finish Confluent Secret Cutover

1. In Confluent Cloud, open the Kafka cluster.
2. Copy the bootstrap server from the cluster connection settings.
3. Update `api-center-prod` with that value as `KAFKA_BROKERS`.
4. Keep `KAFKA_SASL_USERNAME` and `KAFKA_SASL_PASSWORD` as the Confluent Kafka
   cluster API key and secret.
5. Validate the secret without printing values.
6. Restart API Center only after validation passes.

Validation command:

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

## Phase 1: Rollout After Secret Validation

```bash
kubectl -n api-center rollout restart deploy/api-center
kubectl -n api-center rollout status deploy/api-center --timeout=10m
kubectl -n api-center get pods
kubectl -n api-center logs deploy/api-center --tail=120
```

Expected log signal:

```text
Kafka producer connected
```

Then verify an API Center request produces an event in Confluent Cloud, starting
with `api-center.audit.log`.

## Phase 2: Active Cost-Saving Profile

This is the currently selected low-credit profile:

- HPA min replicas: `2`
- HPA max replicas: `3`
- Deployment initial replicas: `2`
- PDB `minAvailable: 1`
- CPU request: `150m`
- Keep memory request at `256Mi`.

Patch shape:

```yaml
replicas: 2

resources:
  requests:
    cpu: 150m
    memory: 256Mi
  limits:
    cpu: "1"
    memory: 512Mi
```

Why CPU is the first safe target:

- Current observed pod CPU is about `61m` to `82m`.
- Current request is `250m`.
- Reducing to `150m` still leaves measured CPU below the HPA target.
- Memory should not be reduced yet because one pod was observed near `244Mi`
  against the current `256Mi` request.

Availability tradeoff:

- This keeps functionality the same and keeps one spare pod for most single-pod
  failures, while using fewer idle pods than the previous min `3` profile.
- It is still less resilient than the old min `3` profile during upgrades,
  multi-node issues, or simultaneous failures.
- If production availability becomes important again, restore HPA min `3`, max
  `6`, and PDB `minAvailable: 2`.

Validation after this patch:

```bash
kubectl -n api-center apply -f infra/gcp/gke/30-deployment.yaml
kubectl -n api-center rollout status deploy/api-center --timeout=10m
kubectl -n api-center get hpa api-center
kubectl -n api-center top pods
curl -I https://api-center.itsandbox.site/api/v1/health/ready
```

Observe for at least 24 hours before lowering CPU again.

## Phase 3: Higher Availability Profile

Use this when API Center needs production-style availability again:

- HPA min replicas: `3`
- HPA max replicas: `6`
- PDB `minAvailable: 2`
- CPU request: `150m` or higher based on observed usage
- Memory request: `256Mi` or higher based on observed usage

## Phase 4: Confluent and S3 Cost Controls

Keep functionality the same while reducing Kafka/S3 cost pressure:

- Keep Confluent Cloud Basic while traffic is low.
- Keep 1 partition per topic until throughput requires more.
- Keep short Kafka retention for raw event topics, for example 1 to 7 days.
- Use S3 as the durable long-term archive.
- Keep the S3 sink connector task count at 1 until lag requires more.
- Prefer compressed connector output if downstream consumers can read it.
- Avoid debug-level API Center logs in production.

## Phase 5: Code-Level Cost Controls

The first code-level controls are intentionally narrow and do not change API
behavior:

- Production logging writes to stdout only. GKE collects stdout/stderr into
  Cloud Logging, so in-container `logs/combined.log` and `logs/error.log` files
  are not needed.
- Morgan HTTP request logging skips `/health/*` and `/api/v1/health/*`.
- Kafka audit publishing skips `/health/*` and `/api/v1/health/*`.

Why:

- Kubernetes and GCLB probes are frequent.
- Probe traffic is already visible in Kubernetes/GCLB health status.
- Storing probe traffic in logs, Kafka, the Confluent S3 connector, and S3 adds
  recurring cost without useful audit value.

Keep:

- Metrics collection for all routes unless Prometheus/cardinality cost becomes a
  separate issue.
- Registry health checks at the current 30-second interval until shared-service
  routing has stabilized.

## Recommendation

Next safe action:

1. Correct `KAFKA_BROKERS`.
2. Apply the cost profile manifests in this order: PDB, HPA, Deployment.
3. Restart and verify API Center only after the Confluent broker validates.
4. Keep memory unchanged until a longer metrics window proves it is safe to lower.
