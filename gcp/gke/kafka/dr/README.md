# Kafka DR Replication (MirrorMaker2)

This folder provides a baseline Strimzi `KafkaMirrorMaker2` deployment to replicate
APICenter topics from the primary in-cluster Kafka to a DR Kafka cluster.

## What to customize

Before apply, update [10-mirrormaker2.yaml](10-mirrormaker2.yaml):

- `target.bootstrapServers`
- target trusted cert secret name
- source/target usernames
- credentials secret names
- topic and group patterns if needed

## Required Secrets

Create credentials in `kafka` namespace:

```bash
kubectl -n kafka create secret generic mirrormaker2-source-credentials \
  --from-literal=password='<SOURCE_PASSWORD>'

kubectl -n kafka create secret generic mirrormaker2-target-credentials \
  --from-literal=password='<TARGET_PASSWORD>'
```

## Deploy

```bash
kubectl apply -k gcp/gke/kafka/dr
kubectl -n kafka get kafkamirrormaker2
```

## Verify

```bash
kubectl -n kafka describe kafkamirrormaker2 api-center-kafka-dr
kubectl -n kafka logs deploy/api-center-kafka-dr-mirrormaker2-connect -f
```

## DR Objective Baseline

- RPO target: <= 15 minutes for critical topics
- RTO target: <= 60 minutes after failover decision

## Operations

Use `docs/kafka-dr-runbook.md` for controlled failover and rollback steps.
