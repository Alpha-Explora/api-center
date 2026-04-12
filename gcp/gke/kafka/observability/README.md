# Kafka Observability Pack

This pack provides optional Kafka monitoring artifacts for Prometheus Operator and Grafana.

## Contents

- `10-kafka-alert-rules.yaml`: Prometheus alerts for broker health, replication, and APICenter lag
- `20-grafana-dashboard-configmap.yaml`: starter Grafana dashboard configmap

## Prerequisites

- Prometheus Operator CRDs installed (`PrometheusRule`)
- Kafka exporter metrics being scraped in your monitoring stack
- Grafana sidecar import enabled (if using configmap dashboard import)

## Deploy

```bash
kubectl apply -k gcp/gke/kafka/observability
```

## Verify

```bash
kubectl -n kafka get prometheusrule api-center-kafka-alert-rules
kubectl -n kafka get configmap api-center-kafka-dashboard
```
