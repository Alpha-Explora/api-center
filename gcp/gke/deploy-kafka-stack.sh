#!/usr/bin/env bash
set -euo pipefail

WITH_OBSERVABILITY=false
WITH_DR=false
KAFKA_WAIT_TIMEOUT="${KAFKA_WAIT_TIMEOUT:-20m}"
API_WAIT_TIMEOUT="${API_WAIT_TIMEOUT:-10m}"

usage() {
  cat <<'EOF'
Usage: ./gcp/gke/deploy-kafka-stack.sh [options]

Options:
  --with-observability   Apply Kafka observability pack
  --with-dr              Apply Kafka DR MirrorMaker2 pack
  --kafka-timeout <dur>  Kafka readiness wait timeout (default: 20m)
  --api-timeout <dur>    API rollout timeout (default: 10m)
  --help                 Show this help

Environment:
  KAFKA_WAIT_TIMEOUT     Overrides Kafka readiness timeout
  API_WAIT_TIMEOUT       Overrides API rollout timeout
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-observability)
      WITH_OBSERVABILITY=true
      shift
      ;;
    --with-dr)
      WITH_DR=true
      shift
      ;;
    --kafka-timeout)
      KAFKA_WAIT_TIMEOUT="$2"
      shift 2
      ;;
    --api-timeout)
      API_WAIT_TIMEOUT="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_cmd kubectl
require_cmd helm

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if ! kubectl config current-context >/dev/null 2>&1; then
  echo "kubectl context is not configured. Run gcloud container clusters get-credentials first." >&2
  exit 1
fi

echo "[1/6] Installing or updating Strimzi operator"
"$ROOT_DIR/gcp/gke/kafka/21-install-strimzi.sh"

echo "[2/6] Applying base GKE manifests"
kubectl apply -f "$ROOT_DIR/gcp/gke/"

echo "[3/6] Applying Kafka manifests"
kubectl apply -k "$ROOT_DIR/gcp/gke/kafka"

echo "[4/6] Waiting for Kafka readiness"
kubectl -n kafka wait kafka/api-center-kafka --for=condition=Ready --timeout="$KAFKA_WAIT_TIMEOUT"

echo "[5/6] Waiting for API rollout"
kubectl -n api-center rollout status deploy/api-center --timeout="$API_WAIT_TIMEOUT"

if [[ "$WITH_OBSERVABILITY" == "true" ]]; then
  echo "[6/6] Applying observability pack"
  kubectl apply -k "$ROOT_DIR/gcp/gke/kafka/observability"
fi

if [[ "$WITH_DR" == "true" ]]; then
  if grep -q "dr-kafka-bootstrap.example.internal" "$ROOT_DIR/gcp/gke/kafka/dr/10-mirrormaker2.yaml"; then
    echo "DR manifest still uses placeholder target bootstrap server. Update gcp/gke/kafka/dr/10-mirrormaker2.yaml first." >&2
    exit 1
  fi

  for secret_name in mirrormaker2-source-credentials mirrormaker2-target-credentials; do
    if ! kubectl -n kafka get secret "$secret_name" >/dev/null 2>&1; then
      echo "Required DR secret not found in kafka namespace: $secret_name" >&2
      exit 1
    fi
  done

  echo "[6/6] Applying DR pack"
  kubectl apply -k "$ROOT_DIR/gcp/gke/kafka/dr"
fi

echo "Deployment workflow completed successfully."
