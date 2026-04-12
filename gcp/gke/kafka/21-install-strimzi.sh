#!/usr/bin/env bash
set -euo pipefail

VALUES_FILE="$(dirname "$0")/20-strimzi-operator-values.yaml"

helm repo add strimzi https://strimzi.io/charts/ >/dev/null
helm repo update >/dev/null

helm upgrade --install strimzi-kafka-operator strimzi/strimzi-kafka-operator \
  --namespace strimzi-operator \
  --create-namespace \
  --values "$VALUES_FILE"

echo "Strimzi operator installed."
