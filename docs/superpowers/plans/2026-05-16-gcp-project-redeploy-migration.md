# GCP Project Redeploy Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move API Center from the current GCP project/account path to a new GCP project controlled by the operator, with minimal downtime and a rollback window.

**Architecture:** Do not try to move the existing project unless the required current-organization IAM access is available. Build the new project in parallel, point it at the same external Confluent Cloud and AWS S3 pipeline, validate it, then switch DNS for `api-center.itsandbox.site`.

**Tech Stack:** Google Cloud project, GKE Autopilot, Artifact Registry, Secret Manager, Memorystore Redis, Workload Identity, GCLB Ingress, managed certificate, Confluent Cloud, AWS S3, API Center, API Shared Services, API Center Management.

---

## Decision

Use a **parallel redeploy** instead of a direct GCP project move.

Reason:

- Direct project migration needs current organization and destination organization permissions, plus organization policy setup.
- The current blocker is lack of org-admin access.
- API Center is mostly stateless at the pod layer.
- Runtime state is in Redis, Secret Manager, Confluent Cloud, AWS S3, and later Postgres.
- Confluent Cloud and AWS S3 can remain unchanged while the GCP hosting project changes.

## What I Need From You

Before implementation starts, provide or confirm these values:

| Item | Why it is needed | Your value |
|---|---|---|
| New GCP project ID | Target project for GKE, Artifact Registry, Secret Manager, Redis, and load balancer | `api-center-496422` |
| Billing account attached to the new project | GCP resources cannot be created without billing | Enabled: `billingAccounts/01BCAD-23ED98-EB04ED` |
| Target region | Recommended: `asia-southeast1` or `asia-southeast2` if available and cost acceptable; keep `us-central1` only if you want lowest disruption from current manifests | `asia-southeast1` |
| Public hostname | Current default is `api-center.itsandbox.site` | `api-center.itsandbox.site` |
| DNS provider access | Needed to switch the A record during cutover | Operator action still required |
| Whether to migrate Redis data | If yes, we need a registry/token export/import window; if no, we re-register services and issue fresh tokens | Do not migrate; issue new tribe tokens |
| Whether to migrate Postgres now | Current database schemas are planned/optional; runtime is still Redis-first | Do not migrate now |
| Whether management console stays local or gets privately deployed | Affects whether `apicenter-management` needs Workload Identity in the new project | Local/private only for now |

## Current Known Source Environment

| Resource | Current value |
|---|---|
| GCP project | `api-center-492808` |
| Region | `us-central1` |
| GKE cluster | `api-center` |
| Namespace | `api-center` |
| API Center hostname | `api-center.itsandbox.site` |
| API Center secret | `api-center-prod` |
| Shared services secret | `api-shared-services-prod` |
| Per-tribe secret prefix | `api-center-tribe-secret-` |
| Redis current host | `10.34.181.131:6379` |
| Kafka | Confluent Cloud |
| S3 export | Confluent Cloud S3 Sink Connector to AWS S3 |

## New Target Environment

| Resource | New value |
|---|---|
| GCP project | `api-center-496422` |
| Region | `asia-southeast1` |
| GKE cluster | `api-center` |
| Namespace | `api-center` |
| API Center hostname | `api-center.itsandbox.site` |
| Static IP | `34.8.167.159` |
| Redis host | `10.88.197.107:6379` |
| Artifact Registry | `asia-southeast1-docker.pkg.dev/api-center-496422/api-center` |
| API Center runtime GSA | `api-center-gke@api-center-496422.iam.gserviceaccount.com` |
| Management provisioner GSA | `apicenter-mgmt-provisioner@api-center-496422.iam.gserviceaccount.com` |

## Execution Notes

- Completed: project/billing verification, API enablement, Artifact Registry, GKE Autopilot, Memorystore Redis, static IP, runtime service account, management provisioner service account, Workload Identity bindings, Docker Artifact Registry auth, migration image pushes, Secret Manager versions, API Center deployment, shared-service deployments, and internal readiness validation.
- Adjusted: management provisioner uses custom role `apiCenterTribeSecretProvisioner` with `secretmanager.secrets.create`, `secretmanager.secrets.get`, and `secretmanager.versions.add`. It does not use broad `roles/secretmanager.admin`.
- Blocked: copying existing `api-center-prod` and `api-shared-services-prod` values from `api-center-492808`; current user lacks `secretmanager.versions.access` and old-cluster Kubernetes secret read permission.
- Secret action taken: created a fresh `api-center-prod` latest version from local management env plus new API Center JWT signing keys. Version 1 was disabled because the local PowerShell RSA export failed; version 2 is the valid latest version.
- Secret action taken: created `api-shared-services-prod` in the new project. Version 1 was disabled because Windows PowerShell wrote a UTF-8 BOM; version 3 is the valid latest version with Redis retargeted to the new Memorystore instance and provider keys loaded from the operator's supplied payload.
- Provider keys are present in the new `api-shared-services-prod` payload. Do not print or commit these values; rotate them later after the migration is stable.
- Deployment status: API Center and all six shared services are running in the new cluster. Internal readiness returned HTTP 200 with Kafka, Redis, and registry up.
- Tribe token status: `smoke-tribe` was recreated in the new project with a per-tribe Secret Manager secret and a fresh plaintext token for validation. The API Center deployment was restarted after the latest tribe-secret version so the 300-second cache could not hold a stale hash.
- Shared-service smoke status: internal token-based health checks through API Center passed for payment, SMS, email, Google auth, OTP, and geolocation.
- Confluent status: Kafka REST sees 31 topics. `tribe.smoke-tribe.events`, `tribe.servease.events`, and all six `api-center.shared.<service>.events` topics exist and are included in `api-center-s3-sink`. The S3 sink connector and task are both `RUNNING`.
- DNS status: public Cloudflare and Google DNS now resolve `api-center.itsandbox.site` to the new load balancer IP `34.8.167.159`. Local DNS cache was flushed and now resolves correctly too. The GKE managed certificate is still `Provisioning` with a stale `FailedNotVisible` domain status; wait for Google's certificate controller to re-check the corrected DNS before testing public HTTPS.

## File Structure

No code changes are required just to migrate hosting projects. Expected repo edits are documentation and environment-specific manifest updates only.

| Repo | Files to review or modify |
|---|---|
| `api-center` | `docs/deployment-gke.md`, `gcp/gke/*.yaml`, `gcp/gke/provision.sh`, `.env.example`, `docs/production-costing.md` |
| `api-shared-services` | `gcp/gke/00-shared-services.yaml`, `gcp/gke/README.md`, `scripts/sync-gke-secret.ps1`, `.env.example` |
| `apicenter-management` | `.env.example`, `gcp/gke/*.yaml` if privately deploying, `docs/operations/apicenter-management-runbook.md` |

---

## Phase 0: Access And Billing Check

Goal: prove the new project can actually host the platform before touching production DNS.

- [ ] **Step 1: Create or select the new GCP project**

  Operator action in Google Cloud Console:

  1. Create a new project under the account or organization you control.
  2. Attach billing.
  3. Record the project ID in this plan.

- [ ] **Step 2: Confirm local CLI can see the project**

  ```powershell
  gcloud auth login
  gcloud config set project <new-project-id>
  gcloud projects describe <new-project-id>
  ```

  Expected: project metadata prints successfully.

- [ ] **Step 3: Confirm billing is enabled**

  ```powershell
  gcloud beta billing projects describe <new-project-id>
  ```

  Expected: billing account is linked and billing is enabled.

- [ ] **Step 4: Enable required APIs**

  ```powershell
  gcloud services enable container.googleapis.com
  gcloud services enable artifactregistry.googleapis.com
  gcloud services enable secretmanager.googleapis.com
  gcloud services enable compute.googleapis.com
  gcloud services enable redis.googleapis.com
  gcloud services enable iamcredentials.googleapis.com
  gcloud services enable cloudresourcemanager.googleapis.com
  ```

  Expected: all services enable without permission errors.

Commit after this phase only if repo docs were updated.

---

## Phase 1: New GCP Foundation

Goal: create the base GCP resources that API Center needs.

- [ ] **Step 1: Choose target region**

  Recommended decision:

  - Use `asia-southeast1` if you want closer Singapore latency.
  - Use `asia-southeast2` if it better matches the existing Confluent/AWS Southeast Asia data path and resource availability.
  - Use `us-central1` only if you want the simplest manifest migration from current state.

- [ ] **Step 2: Create Artifact Registry**

  ```powershell
  gcloud artifacts repositories create api-center `
    --repository-format=docker `
    --location=<target-region> `
    --description="API Center container images"
  ```

  Expected: repository `api-center` exists in the target region.

- [ ] **Step 3: Create GKE Autopilot cluster**

  ```powershell
  gcloud container clusters create-auto api-center `
    --region=<target-region>
  ```

  Expected: cluster `api-center` is created.

- [ ] **Step 4: Fetch cluster credentials**

  ```powershell
  gcloud container clusters get-credentials api-center --region=<target-region>
  kubectl config current-context
  kubectl get ns
  ```

  Expected: `kubectl` points to the new project cluster.

- [ ] **Step 5: Create Memorystore Redis**

  Create one Redis instance for the current low-traffic shape.

  ```powershell
  gcloud redis instances create api-center-cache `
    --size=1 `
    --region=<target-region> `
    --redis-version=redis_7_0
  ```

  Expected: Redis primary endpoint is available.

- [ ] **Step 6: Reserve static global IP**

  ```powershell
  gcloud compute addresses create api-center-ip --global
  gcloud compute addresses describe api-center-ip --global --format="value(address)"
  ```

  Expected: one global IPv4 address is printed.

Commit doc updates after recording project, region, Redis endpoint, and static IP.

---

## Phase 2: IAM And Workload Identity

Goal: let API Center, shared services, and optional management pods read only the secrets and GCP resources they need.

- [ ] **Step 1: Create API Center runtime service account**

  ```powershell
  gcloud iam service-accounts create api-center-gke `
    --display-name="API Center GKE runtime"
  ```

- [ ] **Step 2: Grant API Center runtime roles**

  ```powershell
  gcloud projects add-iam-policy-binding <new-project-id> `
    --member="serviceAccount:api-center-gke@<new-project-id>.iam.gserviceaccount.com" `
    --role="roles/secretmanager.secretAccessor"
  ```

- [ ] **Step 3: Create management provisioner service account**

  ```powershell
  gcloud iam service-accounts create apicenter-mgmt-provisioner `
    --display-name="API Center Management provisioner"
  ```

- [ ] **Step 4: Grant management provisioning roles**

  Required for the local/private management console to provision per-tribe secrets.

  ```powershell
  gcloud projects add-iam-policy-binding <new-project-id> `
    --member="serviceAccount:apicenter-mgmt-provisioner@<new-project-id>.iam.gserviceaccount.com" `
    --role="roles/secretmanager.admin"

  gcloud projects add-iam-policy-binding <new-project-id> `
    --member="serviceAccount:apicenter-mgmt-provisioner@<new-project-id>.iam.gserviceaccount.com" `
    --role="roles/iam.serviceAccountTokenCreator"
  ```

- [ ] **Step 5: Bind Kubernetes service account to GCP service account**

  Apply the namespace first, then annotate the service account.

  ```powershell
  kubectl apply -f gcp/gke/00-namespace.yaml
  kubectl -n api-center create serviceaccount api-center
  kubectl -n api-center annotate serviceaccount api-center `
    iam.gke.io/gcp-service-account=api-center-gke@<new-project-id>.iam.gserviceaccount.com
  ```

Expected: pods using `serviceAccountName: api-center` can read Secret Manager without JSON keys.

---

## Phase 3: Secret Manager Rebuild

Goal: recreate secrets in the new project without leaking or committing secret values.

- [ ] **Step 1: Create `api-center-prod` in the new project**

  Source values from the current Secret Manager payload, but update project-specific values if needed.

  Required minimum keys:

  ```json
  {
    "PLATFORM_ADMIN_SECRET": "existing-or-rotated-admin-secret",
    "JWT_PRIVATE_KEY": "persistent-rs256-private-key-pem",
    "JWT_PUBLIC_KEY": "matching-rs256-public-key-pem",
    "TRIBE_SECRET_SOURCE": "gcp-secret-manager",
    "TRIBE_SECRET_GCP_PREFIX": "api-center-tribe-secret-",
    "TRIBE_SECRET_CACHE_TTL_SECONDS": "300",
    "KAFKA_BROKERS": "confluent-bootstrap-host:9092",
    "KAFKA_SASL_MECHANISM": "plain",
    "KAFKA_SASL_USERNAME": "confluent-kafka-api-key",
    "KAFKA_SASL_PASSWORD": "confluent-kafka-api-secret",
    "KAFKA_SSL_ENABLED": "true",
    "KAFKA_SSL_REJECT_UNAUTHORIZED": "true"
  }
  ```

  Command:

  ```powershell
  gcloud secrets create api-center-prod --replication-policy=automatic
  gcloud secrets versions add api-center-prod --data-file=<local-json-file>
  ```

- [ ] **Step 2: Create `api-shared-services-prod`**

  Required minimum keys depend on enabled providers. Current expected groups:

  ```json
  {
    "REDIS_URL": "redis://<new-redis-private-ip>:6379",
    "PAYMONGO_SECRET_KEY_TEST": "paymongo-test-secret",
    "PAYMONGO_SECRET_KEY_LIVE": "paymongo-live-secret",
    "PAYMONGO_WEBHOOK_SECRET_TEST": "paymongo-test-webhook-secret",
    "PAYMONGO_WEBHOOK_SECRET_LIVE": "paymongo-live-webhook-secret",
    "PAYMONGO_MODE": "test",
    "RESEND_API_KEY": "resend-api-key",
    "EMAIL_FROM_ADDRESS": "noreply@itsandbox.site",
    "GOOGLE_CLIENT_ID": "google-oauth-client-id",
    "GOOGLE_CLIENT_SECRET": "google-oauth-client-secret",
    "GOOGLE_REDIRECT_URI": "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback",
    "GOOGLE_MAPS_API_KEY": "google-maps-api-key",
    "SHARED_SERVICES_DATABASE_ENABLED": "false"
  }
  ```

  Command:

  ```powershell
  gcloud secrets create api-shared-services-prod --replication-policy=automatic
  gcloud secrets versions add api-shared-services-prod --data-file=<local-json-file>
  ```

- [ ] **Step 3: Recreate per-tribe secrets**

  For each active tribe:

  ```text
  api-center-tribe-secret-<service-id>
  ```

  Payload shape:

  ```json
  {
    "serviceId": "servease",
    "secretHashSha256": "sha256-hash-of-plaintext-tribe-secret",
    "status": "active",
    "rotatedAt": "2026-05-16T00:00:00.000Z"
  }
  ```

- [ ] **Step 4: Decide whether to rotate secrets**

  Recommended:

  - Keep Confluent/AWS provider credentials unchanged for the migration.
  - Rotate `PLATFORM_ADMIN_SECRET` only after the new project deploy is healthy.
  - Rotate tribe secrets only if you can coordinate with tribe owners.

Commit only docs/examples, never secret payloads.

---

## Phase 4: Manifest Re-targeting

Goal: update Kubernetes manifests for the new project and region.

- [ ] **Step 1: Update API Center GKE manifests**

  Modify these files:

  - `api-center/gcp/gke/10-serviceaccount.yaml`
  - `api-center/gcp/gke/20-configmap.yaml`
  - `api-center/gcp/gke/30-deployment.yaml`
  - `api-center/gcp/gke/70-managedcert.yaml`
  - `api-center/gcp/gke/80-ingress.yaml`

  Required changes:

  - project ID to `<new-project-id>`
  - region-specific image path to `<target-region>-docker.pkg.dev/<new-project-id>/api-center/api-center:<tag>`
  - Redis URL to `redis://<new-redis-private-ip>:6379`
  - `GCP_SECRET_NAME=api-center-prod`
  - hostname remains `api-center.itsandbox.site` unless DNS name changes

- [ ] **Step 2: Update shared-services GKE manifests**

  Modify:

  - `api-shared-services/gcp/gke/00-shared-services.yaml`
  - `api-shared-services/scripts/sync-gke-secret.ps1`
  - `api-shared-services/gcp/gke/README.md`

  Required changes:

  - project ID to `<new-project-id>`
  - image registry path to `<target-region>-docker.pkg.dev/<new-project-id>/api-center`
  - secret source remains `api-shared-services-prod`

- [ ] **Step 3: Update management local env examples**

  Modify:

  - `apicenter-management/.env.example`
  - `apicenter-management/README.md`
  - `apicenter-management/docs/operations/apicenter-management-runbook.md`

  Required changes:

  - `GOOGLE_CLOUD_PROJECT=<new-project-id>`
  - `GCP_IMPERSONATE_SERVICE_ACCOUNT=apicenter-mgmt-provisioner@<new-project-id>.iam.gserviceaccount.com`
  - Confluent values stay unchanged unless Confluent org also changes

Commit this phase as `docs: document new gcp project migration target` or equivalent.

---

## Phase 5: Build And Deploy In Parallel

Goal: deploy the new stack without changing public DNS yet.

- [ ] **Step 1: Build and push API Center image**

  ```powershell
  cd C:\Codes\apic\api-center
  $tag = git rev-parse --short HEAD
  $image = "<target-region>-docker.pkg.dev/<new-project-id>/api-center/api-center:$tag"
  docker build -f docker/Dockerfile.gcp -t $image .
  gcloud auth configure-docker <target-region>-docker.pkg.dev
  docker push $image
  ```

- [ ] **Step 2: Build and push shared-service images**

  ```powershell
  cd C:\Codes\apic\api-shared-services\shared-services
  $project = "<new-project-id>"
  $region = "<target-region>"
  $repo = "$region-docker.pkg.dev/$project/api-center"
  $tag = git rev-parse --short HEAD

  docker build -t "$repo/shared-payment-service:$tag" -f paymongo/Dockerfile .
  docker build -t "$repo/shared-sms-service:$tag" -f sms-gateway/Dockerfile .
  docker build -t "$repo/shared-email-service:$tag" -f email-gateway/Dockerfile .
  docker build -t "$repo/shared-gauth-service:$tag" -f gauth-gateway/Dockerfile .
  docker build -t "$repo/shared-otp-service:$tag" -f otp-gateway/Dockerfile .
  docker build -t "$repo/shared-geo-service:$tag" -f geo-gateway/Dockerfile .

  docker push "$repo/shared-payment-service:$tag"
  docker push "$repo/shared-sms-service:$tag"
  docker push "$repo/shared-email-service:$tag"
  docker push "$repo/shared-gauth-service:$tag"
  docker push "$repo/shared-otp-service:$tag"
  docker push "$repo/shared-geo-service:$tag"
  ```

- [ ] **Step 3: Apply API Center manifests**

  ```powershell
  cd C:\Codes\apic\api-center
  kubectl apply -f gcp/gke/
  kubectl -n api-center rollout status deploy/api-center --timeout=10m
  ```

- [ ] **Step 4: Sync and apply shared-service manifests**

  ```powershell
  cd C:\Codes\apic\api-shared-services
  .\scripts\sync-gke-secret.ps1
  kubectl apply -f gcp/gke/00-shared-services.yaml
  kubectl -n api-center rollout status deploy/payment-service --timeout=5m
  kubectl -n api-center rollout status deploy/sms-service --timeout=5m
  kubectl -n api-center rollout status deploy/email-service --timeout=5m
  kubectl -n api-center rollout status deploy/gauth-service --timeout=5m
  kubectl -n api-center rollout status deploy/otp-service --timeout=5m
  kubectl -n api-center rollout status deploy/geo-service --timeout=5m
  ```

Expected: new cluster has healthy API Center and shared-service pods before DNS cutover.

---

## Phase 6: Pre-Cutover Validation

Goal: verify the new project works before production traffic moves.

- [ ] **Step 1: Verify pods and HPA**

  ```powershell
  kubectl -n api-center get deploy,svc,hpa,pdb,ingress,managedcertificate
  kubectl -n api-center get pods
  kubectl -n api-center logs deploy/api-center --tail=100
  ```

  Expected:

  - API Center pods ready
  - Shared-service pods ready
  - HPA target metrics are present
  - no Kafka credential failure in logs

- [ ] **Step 2: Test using the load balancer IP before DNS**

  If TLS is not ready yet, test internal pod readiness first:

  ```powershell
  kubectl -n api-center port-forward deploy/api-center 8080:3000
  curl.exe http://localhost:8080/api/v1/health/ready
  ```

  Expected: readiness returns success.

- [ ] **Step 3: Test registry and tribe token flow**

  Use API Center Management against the new API Center base URL once reachable:

  ```env
  API_CENTER_BASE_URL=https://api-center.itsandbox.site
  API_CENTER_PLATFORM_ADMIN_SECRET=<new-or-existing-platform-admin-secret>
  GOOGLE_CLOUD_PROJECT=<new-project-id>
  ```

  Expected:

  - `/readiness` passes
  - registry list loads
  - tribe token request works for `smoke-tribe` or `servease`

- [ ] **Step 4: Test Confluent publish and S3 sink**

  Run smoke checks from `apicenter-management`.

  Expected:

  - API Center publishes to Confluent
  - tribe topic exists
  - shared-service export topics exist
  - S3 sink connector receives configured topics
  - records appear in AWS S3 after connector latency

Do not change DNS until this phase passes.

---

## Phase 7: DNS Cutover

Goal: move production traffic to the new project.

- [ ] **Step 1: Lower DNS TTL before cutover**

  In the DNS provider for `itsandbox.site`, lower `api-center.itsandbox.site` A record TTL to 60 seconds.

  Wait at least the previous TTL before final cutover.

- [ ] **Step 2: Confirm new GCLB static IP**

  ```powershell
  gcloud compute addresses describe api-center-ip --global --format="value(address)"
  ```

- [ ] **Step 3: Update DNS A record**

  Set:

  ```text
  api-center.itsandbox.site -> <new-global-static-ip>
  ```

- [ ] **Step 4: Watch certificate provisioning**

  ```powershell
  kubectl -n api-center describe managedcertificate api-center-cert
  kubectl -n api-center get ingress api-center -w
  ```

  Expected: managed certificate becomes active after DNS points to the new load balancer.

- [ ] **Step 5: Validate public endpoint**

  ```powershell
  curl.exe -I https://api-center.itsandbox.site/api/v1/health/ready
  ```

  Expected: `HTTP/2 200`.

---

## Phase 8: Post-Cutover Monitoring And Rollback Window

Goal: keep the old project available until the new project proves stable.

- [ ] **Step 1: Monitor API Center**

  Check:

  ```powershell
  kubectl -n api-center get hpa,pods
  kubectl -n api-center logs deploy/api-center --tail=200
  ```

- [ ] **Step 2: Monitor Confluent**

  In Confluent Cloud:

  - topic produce rate increases from the new deployment
  - S3 sink connector remains healthy
  - no connector task failure

- [ ] **Step 3: Monitor AWS S3**

  In S3:

  - new records arrive under expected topic prefixes
  - shared-service export topics continue to land

- [ ] **Step 4: Keep old project as rollback**

  Keep old GKE resources alive for 24 to 72 hours.

  Rollback path:

  ```text
  Change DNS A record back to the old global static IP.
  ```

- [ ] **Step 5: Remove old project only after validation**

  Delete old resources only after:

  - new project has handled normal traffic
  - management console works
  - shared-service smoke tests pass
  - Confluent and S3 exports are confirmed
  - no tribes are reporting token or routing failures

---

## Phase 9: Documentation And Cost Cleanup

Goal: make the new project the documented source of truth.

- [ ] **Step 1: Update `api-center/docs/deployment-gke.md`**

  Replace:

  - project ID
  - region
  - Artifact Registry path
  - static IP name or value
  - Redis endpoint
  - current image tag

- [ ] **Step 2: Update `api-center/docs/production-costing.md`**

  Add:

  - old project cost baseline
  - new project cost baseline
  - expected cost delta from region change
  - resources left alive during rollback window

- [ ] **Step 3: Update `api-shared-services/gcp/gke/README.md`**

  Replace:

  - project ID
  - image paths
  - secret sync command assumptions

- [ ] **Step 4: Update `apicenter-management` docs**

  Replace:

  - `GOOGLE_CLOUD_PROJECT`
  - provisioner service account email
  - any old project-specific local setup notes

- [ ] **Step 5: Commit documentation updates**

  ```powershell
  git status --short
  git add docs/deployment-gke.md docs/production-costing.md gcp/gke README.md
  git commit -m "docs: update gcp migration target state"
  ```

Run this separately per repo and only stage files that were intentionally edited.

---

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Cannot move project due org access | Use parallel redeploy to a new project |
| DNS cutover breaks TLS | Keep old project alive, lower TTL first, monitor managed cert |
| Redis registry state is missing | Export/import or re-register services before cutover |
| Tribe tokens fail | Recreate per-tribe Secret Manager secrets before cutover |
| Confluent S3 sink misses new topics | Verify topic creation and connector config before DNS cutover |
| Shared services lose provider credentials | Recreate `api-shared-services-prod` before deploying pods |
| Unexpected cost increase in new region | Compare GKE, Redis, load balancer, monitoring, and egress after 24 hours |

## Direct Project Move Alternative

Only use this if you gain the required org-level access.

Direct project migration requires:

- permissions on the source project and parent
- permissions on the destination organization or folder
- organization policy export/import permissions
- billing compatibility
- IAM inheritance review

If any of those are unavailable, do not spend more time on direct migration. Parallel redeploy is cleaner for this system.

## Completion Criteria

The migration is complete when:

- `api-center.itsandbox.site` resolves to the new GCP load balancer
- API Center readiness returns `200`
- registry list works from `apicenter-management`
- token request works for a test tribe
- all shared-service smoke checks pass
- Confluent receives gateway and shared-service events
- S3 receives topic exports
- old project is documented as rollback-only or decommissioned
