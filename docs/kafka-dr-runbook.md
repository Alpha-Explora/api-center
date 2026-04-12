# Kafka DR Failover Runbook

This runbook defines controlled failover from the primary Kafka cluster in GKE
to the DR Kafka cluster replicated by MirrorMaker2.

## Scope

- Primary cluster: api-center-kafka (namespace kafka)
- DR replication: KafkaMirrorMaker2 resource api-center-kafka-dr
- Covered topics: api-center.*

## Preconditions

- MirrorMaker2 is running and healthy.
- DR cluster is reachable and accepting writes.
- APICenter secret payload supports runtime broker and credential switch.
- On-call and platform owner approval is granted.

## Failover Triggers

Failover can be considered when one or more conditions are sustained:

- Primary Kafka unavailable for more than 10 minutes.
- Offline partitions cannot be recovered inside RTO budget.
- Data durability risk due to sustained ISR collapse.

## Failover Procedure

### 1. Freeze writes if possible

- Stop non-critical producers.
- Keep critical producers paused and queued where supported.

### 2. Validate DR replication health

```bash
kubectl -n kafka get kafkamirrormaker2 api-center-kafka-dr
kubectl -n kafka describe kafkamirrormaker2 api-center-kafka-dr
```

Confirm replication is recent enough for acceptable RPO.

### 3. Prepare DR broker and credentials

- Capture DR bootstrap endpoint.
- Capture DR username and password for APICenter producer principal.
- Capture DR cluster CA cert PEM.

### 4. Update Secret Manager payload

Update api-center-prod with DR values:

- KAFKA_BROKERS=<dr-bootstrap>
- KAFKA_SASL_USERNAME=<dr-username>
- KAFKA_SASL_PASSWORD=<dr-password>
- KAFKA_SSL_CA_PEM=<dr-ca-pem>

### 5. Restart APICenter deployment

```bash
kubectl -n api-center rollout restart deploy/api-center
kubectl -n api-center rollout status deploy/api-center --timeout=10m
```

### 6. Verify post-failover traffic

- Verify /api/v1/health/ready = 200.
- Verify event-producing paths create new records.
- Verify consumer lag is stable for critical groups.

## Rollback to Primary

When primary is stable and approved for return:

1. Restore primary Kafka values in Secret Manager.
	Alternative: restore a previously known-good payload using
	`gcp/gke/rollback-kafka-secretmanager.ps1`.
2. Roll APICenter deployment.
3. Verify health and producer/consumer behavior.
4. Resume normal writes.

## Post-Incident Actions

- Record actual RTO and RPO.
- Capture exact timestamp of switch and restore.
- Open follow-up issues for gaps discovered in runbook execution.
