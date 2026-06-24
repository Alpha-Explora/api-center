#!/usr/bin/env bash
# =============================================================================
# provision.sh — One-time GCP setup for the api-center GKE deployment
# =============================================================================
# Idempotent where possible. Safe to re-run; existing resources are skipped.
#
# Usage:
#   PROJECT_ID=my-proj REGION=us-central1 SECRET_NAME=api-center-prod \
#   PUBLIC_HOSTNAME=api.example.com ./provision.sh
# =============================================================================
set -euo pipefail

: "${PROJECT_ID:?PROJECT_ID is required}"
: "${REGION:?REGION is required, e.g. us-central1}"
: "${SECRET_NAME:?SECRET_NAME is required (Secret Manager secret name)}"
: "${PUBLIC_HOSTNAME:?PUBLIC_HOSTNAME is required, e.g. api.example.com}"

CLUSTER_NAME="${CLUSTER_NAME:-api-center}"
GSA_NAME="${GSA_NAME:-api-center-gke}"
GSA_EMAIL="${GSA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KSA_NS="api-center"
KSA_NAME="api-center"
ARTIFACT_REPO="${ARTIFACT_REPO:-api-center}"
CACHE_INSTANCE="${CACHE_INSTANCE:-api-center-cache}"
STATIC_IP_NAME="${STATIC_IP_NAME:-api-center-ip}"

gcloud config set project "${PROJECT_ID}"

echo "==> Enabling APIs"
gcloud services enable \
  container.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  redis.googleapis.com \
  compute.googleapis.com \
  certificatemanager.googleapis.com

echo "==> Creating Artifact Registry repo: ${ARTIFACT_REPO}"
gcloud artifacts repositories describe "${ARTIFACT_REPO}" \
  --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${ARTIFACT_REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="api-center container images"

echo "==> Creating Autopilot cluster: ${CLUSTER_NAME}"
gcloud container clusters describe "${CLUSTER_NAME}" \
  --region="${REGION}" >/dev/null 2>&1 || \
  gcloud container clusters create-auto "${CLUSTER_NAME}" \
    --region="${REGION}" \
    --release-channel=regular

gcloud container clusters get-credentials "${CLUSTER_NAME}" --region="${REGION}"

echo "==> Creating Memorystore (Redis) — cache + rate-limit"
gcloud redis instances describe "${CACHE_INSTANCE}" --region="${REGION}" >/dev/null 2>&1 || \
  gcloud redis instances create "${CACHE_INSTANCE}" \
    --size=1 --region="${REGION}" --tier=basic \
    --redis-version=redis_7_0 \
    --redis-config maxmemory-policy=allkeys-lru

CACHE_HOST=$(gcloud redis instances describe "${CACHE_INSTANCE}" --region="${REGION}" --format='value(host)')
echo "    redis: ${CACHE_HOST}:6379"

echo "==> Creating GCP service account ${GSA_EMAIL}"
gcloud iam service-accounts describe "${GSA_EMAIL}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${GSA_NAME}" \
    --display-name="api-center GKE Workload Identity"

echo "==> Granting Secret Manager accessor on secret ${SECRET_NAME}"
gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
  --member="serviceAccount:${GSA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"

echo "==> Binding Workload Identity (KSA ${KSA_NS}/${KSA_NAME} → ${GSA_EMAIL})"
gcloud iam service-accounts add-iam-policy-binding "${GSA_EMAIL}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:${PROJECT_ID}.svc.id.goog[${KSA_NS}/${KSA_NAME}]"

echo "==> Reserving global static IP: ${STATIC_IP_NAME}"
gcloud compute addresses describe "${STATIC_IP_NAME}" --global >/dev/null 2>&1 || \
  gcloud compute addresses create "${STATIC_IP_NAME}" --global

STATIC_IP=$(gcloud compute addresses describe "${STATIC_IP_NAME}" --global --format='value(address)')

cat <<EOF

=============================================================================
Provisioning complete. Update your manifests with these values:

  GCP_PROJECT_ID            ${PROJECT_ID}
  GCP_SECRET_NAME           ${SECRET_NAME}
  REDIS_CACHE_URL           redis://${CACHE_HOST}:6379
  REDIS_RATE_LIMIT_URL      redis://${CACHE_HOST}:6379
  PUBLIC_HOSTNAME           ${PUBLIC_HOSTNAME}
  Static IP (DNS A record)  ${STATIC_IP}
  Image registry            ${REGION}-docker.pkg.dev/${PROJECT_ID}/${ARTIFACT_REPO}/api-center

Then:
  1. Edit gcp/gke/*.yaml — replace every <PLACEHOLDER>
  2. Point ${PUBLIC_HOSTNAME} A record at ${STATIC_IP}
  3. kubectl apply -f gcp/gke/
=============================================================================
EOF


