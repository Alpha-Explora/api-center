# API Center Reliability Hardening Plan

Date: 2026-05-11

This plan records the reliability work applied after the Confluent Cloud and
GKE cost-optimization pass.

## Current Deployment Profile

- GKE Deployment starts with 2 replicas.
- HPA scales from 2 to 3 pods on CPU and memory pressure.
- PDB keeps at least 1 pod available during voluntary disruption.
- Kafka uses Confluent Cloud. Self-managed Kafka broker fallbacks should not be
  used in production secrets or deployment manifests.

## Phase Status

| Phase | Goal | Status | Delivered |
| --- | --- | --- | --- |
| 1 | Improve Kafka publish visibility | Completed | Publish success/failure counter and producer connected gauge. |
| 2 | Simplify config initialization | Completed | Bootstrap secret loading is the only config-secret load path; stale module service removed. |
| 3 | Prevent shared-service contract drift | Completed | Contract snapshots now validate manifest `exposes` routes in both repos. |
| 4 | Add deploy smoke checks | Completed | `npm run smoke:gke` and `npm run smoke:gke:check-config`. |
| 5 | Reduce unsafe external proxy typing | Completed | HTTP method normalization rejects unsupported methods and removes the `as any` proxy path. |
| 6 | Harden registry reconciliation | Completed | Redis drift detection compares stable entry fingerprints, not only `updatedAt`. |

## Operator Checks

Run these before a GKE rollout:

```bash
npm test -- --runInBand
npm run typecheck
npm run check:contracts
npm run check:boundaries
npm run smoke:gke:check-config
kubectl apply --dry-run=client -f infra/gcp/gke/30-deployment.yaml -f infra/gcp/gke/50-hpa.yaml -f infra/gcp/gke/60-pdb.yaml
```

Run the live smoke test after the new image is deployed and the correct
production credentials are available:

```bash
npm run smoke:gke
```

## Remaining Deployment Prerequisite

Before deploying, confirm the `api-center-prod` Secret Manager JSON has the
Confluent Cloud bootstrap server:

```json
{
  "KAFKA_BROKERS": "<confluent-bootstrap-server>:9092",
  "KAFKA_SSL_ENABLED": "true",
  "KAFKA_SASL_MECHANISM": "plain",
  "KAFKA_SASL_USERNAME": "<confluent-api-key>",
  "KAFKA_SASL_PASSWORD": "<confluent-api-secret>"
}
```

The old self-managed Kubernetes broker address must be removed from production
secrets.
