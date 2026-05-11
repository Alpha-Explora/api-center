# Self-Hosted Kafka on GKE (Strimzi + KRaft)

> Current production direction: Confluent Cloud. These self-hosted Kafka manifests are retained only as historical or emergency fallback assets.

This folder contains fallback manifests for running a self-hosted Kafka cluster
in GKE for APICenter when Confluent Cloud is unavailable or explicitly rejected.

## What this deploys

- Kafka namespace (`kafka`)
- Namespace-level ingress policy for APICenter pods to Kafka brokers
- Strimzi-managed Kafka in KRaft mode (no ZooKeeper)
- 1 combined controller+broker node via `KafkaNodePool` (quota-safe baseline)
- TLS + SCRAM-SHA-512 internal listener
- Kafka user (`api-center`) with least-privilege ACLs
- Baseline APICenter topics

## Prerequisites

- Existing GKE cluster credentials configured in `kubectl`
- Helm 3.x installed
- Strimzi operator installed (script included in this folder)

## Install Strimzi operator

```bash
./gcp/gke/kafka/21-install-strimzi.sh
kubectl -n strimzi-operator get pods
```

The operator is configured to watch only the `kafka` namespace.

## Deploy Kafka resources manually

```bash
# Fallback-only manual path. Prefer the guarded rollout scripts below.
kubectl apply -k gcp/gke/kafka
kubectl -n kafka get kafkas,kafkanodepools,kafkausers,kafkatopics
```

## Wait for readiness

```bash
kubectl -n kafka wait kafka/api-center-kafka --for=condition=Ready --timeout=20m
kubectl -n kafka get pods
```

## Configure APICenter runtime

Use these values in APICenter runtime config:

- `KAFKA_BROKERS=api-center-kafka-kafka-bootstrap.kafka.svc.cluster.local:9092`
- `KAFKA_SSL_ENABLED=true`
- `KAFKA_SSL_REJECT_UNAUTHORIZED=true`
- `KAFKA_SSL_CA_PEM=<cluster CA cert PEM from secret manager>`
- `KAFKA_SASL_MECHANISM=scram-sha-512`
- `KAFKA_SASL_USERNAME=api-center`
- `KAFKA_SASL_PASSWORD=<from KafkaUser secret>`

Fetch generated user password:

```bash
kubectl -n kafka get secret api-center -o jsonpath='{.data.password}' | base64 -d; echo
```

Fetch cluster CA certificate (for `KAFKA_SSL_CA_PEM`):

```bash
kubectl -n kafka get secret api-center-kafka-cluster-ca-cert \
	-o jsonpath='{.data.ca\.crt}' | base64 -d
```

Or sync Kafka Secret Manager values automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\sync-kafka-secretmanager.ps1 -SecretName api-center-prod
```

## Verify topic health

```bash
kubectl -n kafka get kafkatopics
```

## Notes

- This baseline is tuned to fit constrained GKE quotas. For high availability,
  scale out with separate controller/broker pools once CPU/memory/disk quotas
  are increased.
- For stricter isolation, place Kafka in a dedicated GKE cluster and use VPC peering.
- For DR, deploy a second cluster and replicate critical topics with MirrorMaker 2.

## Optional packs

- DR replication: `gcp/gke/kafka/dr/`
- Observability rules/dashboard: `gcp/gke/kafka/observability/`
- DR failover runbook: `docs/kafka-dr-runbook.md`

## One-command deployment

These commands are fallback-only and require an explicit self-hosted Kafka allow flag.

```bash
bash gcp/gke/deploy-kafka-stack.sh --allow-self-hosted-kafka --with-observability
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\deploy-kafka-stack.ps1 -AllowSelfHostedKafka -WithObservability
```

To include DR resources as part of deployment:

```bash
bash gcp/gke/deploy-kafka-stack.sh --allow-self-hosted-kafka --with-observability --with-dr
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\deploy-kafka-stack.ps1 -AllowSelfHostedKafka -WithObservability -WithDr
```

Post-deploy verification:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\verify-kafka-stack.ps1 -CheckObservability
```

Full rollout orchestration:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\run-kafka-rollout.ps1 -AllowSelfHostedKafka -WithObservability
```

Dry-run orchestration (no cluster or secret writes):

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\run-kafka-rollout.ps1 -DryRun
```

Rollback to a previous Secret Manager version:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\rollback-kafka-secretmanager.ps1 -RollbackVersion <version>
```

Kafka credential/CA alignment smoke check:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\smoke-kafka-config.ps1 -SecretName api-center-prod
```

Kafka runtime produce/consume smoke check:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\smoke-kafka-topic.ps1
```

Include runtime topic smoke in full rollout:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\run-kafka-rollout.ps1 -AllowSelfHostedKafka -WithObservability -CheckKafkaTopicSmoke
```
