# Test And Live Environment Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split API Center into a safe test/staging environment and a live/prod environment without duplicating every expensive managed dependency before traffic justifies it.

**Architecture:** Use the current GCP deployment as the test/staging base first, then create an isolated live/prod environment when the platform is ready for real users and payments. Kafka and S3 should be separated by environment at the data-contract level immediately, using topic prefixes and S3 prefixes, while Confluent cluster and S3 bucket isolation can be upgraded later if cost and risk justify it.

**Tech Stack:** GKE Autopilot, GCP Secret Manager, Memorystore Redis, Confluent Cloud Kafka, Confluent S3 Sink, AWS S3, API Center, API Shared Services, API Center Management.

---

## Recommendation

Do not create two full GKE clusters immediately unless live traffic or payment risk requires it this week.

Use this sequence:

```text
Now:
  one GKE cluster
  separate namespaces and secrets
  one Confluent cluster
  one S3 bucket
  environment-prefixed topics

Later, when live is real:
  separate prod GKE cluster or separate prod GCP project
  optionally separate prod Confluent cluster
  optionally separate prod S3 bucket
```

This keeps cost lower while still preventing test events from mixing with live events.

## Implementation Status

Completed on 2026-05-16:

- API Center now supports `KAFKA_TOPIC_PREFIX`.
- Production API Center is deployed with image `env-split-20260516`.
- Production ConfigMap sets `KAFKA_TOPIC_PREFIX=prod.`.
- Test API Center namespace `api-center-test` is deployed with `KAFKA_TOPIC_PREFIX=test.`.
- Test shared services are deployed in `api-center-test` and read Kubernetes secret `api-shared-services-test`.
- Secret Manager test secrets were created without rotating provider credentials:
  - `api-center-test`
  - `api-shared-services-test`
  - `api-center-test-tribe-secret-smoke-tribe`
- Created 47 prefixed Confluent topics for `test.*`, `prod.*`, and known tribe topics.
- Updated `api-center-s3-sink` from 30 to 77 configured topics.
- Confluent S3 sink connector is `RUNNING`; task `0` is `RUNNING`.
- Production public readiness returns HTTP `200` at `https://api-center.itsandbox.site/api/v1/health/ready`.

Pending operator action:

- Add Cloudflare DNS record:

```text
api-center-test.itsandbox.site -> 34.8.14.214
```

Use DNS-only / gray cloud until the GKE managed certificate becomes `Active`.

## Target Environments

| Environment | Short name | Purpose | Hostname | GKE shape |
|---|---|---|---|---|
| Test/staging | `test` | smoke tests, provider test mode, local tribe validation | `api-center-test.itsandbox.site` | current cluster, separate namespace |
| Live/prod | `prod` | real users, real payments, real data export | `api-center.itsandbox.site` | later separate cluster/project preferred |

## Kafka And S3 Strategy

### Current Best Path: One Confluent Cluster, Environment-Prefixed Topics

Keep the current active Confluent cluster:

```text
Cluster: api-center-gcp-dev-main
Cluster ID: lkc-850n9q
Region: ap-southeast-2
S3 sink connector: api-center-s3-sink
S3 bucket: api-center-raw-data
```

Add a configurable Kafka topic prefix:

```text
KAFKA_TOPIC_PREFIX=test.
KAFKA_TOPIC_PREFIX=prod.
```

Topic examples:

```text
test.api-center.gateway.request
test.api-center.gateway.response
test.api-center.audit.log
test.api-center.shared.sms.events
test.api-center.shared.email.events
test.api-center.shared.payment.events
test.api-center.shared.otp.events
test.api-center.shared.geo.events
test.api-center.shared.gauth.events
test.tribe.smoke-tribe.events

prod.api-center.gateway.request
prod.api-center.gateway.response
prod.api-center.audit.log
prod.api-center.shared.sms.events
prod.api-center.shared.email.events
prod.api-center.shared.payment.events
prod.api-center.shared.otp.events
prod.api-center.shared.geo.events
prod.api-center.shared.gauth.events
prod.tribe.servease.events
```

S3 output will naturally separate by topic directory:

```text
s3://api-center-raw-data/topics/test.api-center.shared.payment.events/year=YYYY/month=MM/day=DD/hour=HH/
s3://api-center-raw-data/topics/prod.api-center.shared.payment.events/year=YYYY/month=MM/day=DD/hour=HH/
```

This is good enough for current scale because:

- test and live records do not share topic names
- S3 paths are separated
- one connector task can still cover the current low partition count
- tribes still never receive Confluent credentials
- API Center remains the only producer

### Later Stronger Path: Separate Prod Confluent And S3

Use this only when cost and operational risk justify it:

```text
test API Center -> test Confluent cluster -> test S3 bucket
prod API Center -> prod Confluent cluster -> prod S3 bucket
```

Benefits:

- stronger blast-radius isolation
- easier deletion of test data
- clearer IAM boundaries
- prod connector cannot be broken by test topic changes

Costs:

- another Confluent cluster
- another S3 sink connector task
- another AWS bucket/IAM path
- more setup and monitoring

## Environment Secret Model

Use separate Secret Manager secrets even if they initially contain similar values.

```text
api-center-test
api-center-prod
api-shared-services-test
api-shared-services-prod
```

Payment mode:

```json
{
  "PAYMENT_PROVIDER_MODE": "test",
  "PAYMONGO_TEST_SECRET_KEY": "test-secret",
  "PAYMONGO_LIVE_SECRET_KEY": "live-secret",
  "PAYMONGO_TEST_WEBHOOK_SECRET": "test-webhook-secret",
  "PAYMONGO_LIVE_WEBHOOK_SECRET": "live-webhook-secret"
}
```

Test shared services use:

```text
PAYMENT_PROVIDER_MODE=test
GOOGLE_REDIRECT_URI=https://api-center-test.itsandbox.site/api/v1/shared/gauth/oauth/callback
```

Live shared services use:

```text
PAYMENT_PROVIDER_MODE=live
GOOGLE_REDIRECT_URI=https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback
```

## File Structure

| Repo | File | Responsibility |
|---|---|---|
| `api-center` | `src/kafka/topics.ts` | Apply environment prefix to topic names |
| `api-center` | `src/config/config.service.ts` | Read `KAFKA_TOPIC_PREFIX` |
| `api-center` | `src/kafka/kafka.service.spec.ts` | Verify prefixed topic publishing |
| `api-center` | `gcp/gke/20-configmap.yaml` | Prod runtime config |
| `api-center` | `gcp/gke/20-configmap.test.yaml` | Test runtime config |
| `api-center` | `gcp/gke/30-deployment.yaml` | Prod deployment secret name and image |
| `api-center` | `gcp/gke/30-deployment.test.yaml` | Test deployment secret name and image |
| `api-center` | `gcp/gke/80-ingress.yaml` | Prod hostname |
| `api-center` | `gcp/gke/80-ingress.test.yaml` | Test hostname |
| `api-shared-services` | `gcp/gke/00-shared-services.yaml` | Prod shared-service config |
| `api-shared-services` | `gcp/gke/00-shared-services.test.yaml` | Test shared-service config |
| `apicenter-management` | `.env.example` | Document test/prod operator variables |
| `apicenter-management` | `src/lib/event-topics.ts` | Show environment-aware topic names |
| `api-center` | `docs/confluent-cloud-s3-sink-setup.md` | Document test/prod topic and S3 layout |
| `api-center` | `docs/production-costing.md` | Document cost difference between shared and isolated environments |

---

## Phase 1: Freeze The Environment Naming

Goal: stop using one ambiguous "prod" name for every workflow.

- [x] **Step 1: Decide hostnames**

Use:

```text
api-center-test.itsandbox.site
api-center.itsandbox.site
```

Expected result:

```text
test traffic and smoke tests use api-center-test.itsandbox.site
live traffic uses api-center.itsandbox.site
```

- [x] **Step 2: Decide namespace names**

Use:

```text
api-center-test
api-center-prod
```

Expected result:

```text
kubectl -n api-center-test get pods
kubectl -n api-center-prod get pods
```

- [x] **Step 3: Decide topic prefixes**

Use:

```text
test.
prod.
```

Expected result:

```text
test.api-center.audit.log
prod.api-center.audit.log
```

- [ ] **Step 4: Commit the decision doc**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/superpowers/plans/2026-05-16-test-live-environment-split.md
git commit -m "docs: plan test and live environment split"
```

## Phase 2: Add Environment-Aware Kafka Topics

Goal: prevent test and live data from landing in the same Kafka topics.

- [x] **Step 1: Add `KAFKA_TOPIC_PREFIX` config**

Modify `api-center/src/config/config.service.ts`.

Add config property:

```ts
kafkaTopicPrefix: process.env.KAFKA_TOPIC_PREFIX || "",
```

Expected behavior:

```text
empty prefix keeps existing topic names
test. prefix publishes to test.<topic>
prod. prefix publishes to prod.<topic>
```

- [x] **Step 2: Add a topic prefix helper**

Modify `api-center/src/kafka/topics.ts`.

Add:

```ts
export function withTopicPrefix(topic: string, prefix?: string) {
  const cleanPrefix = (prefix ?? "").trim();
  if (!cleanPrefix) return topic;
  return `${cleanPrefix.replace(/\.+$/, "")}.${topic}`;
}
```

- [x] **Step 3: Route publishing through the helper**

Modify `api-center/src/kafka/kafka.service.ts`.

Before publishing:

```ts
const topic = withTopicPrefix(input.topic, this.config.kafkaTopicPrefix);
```

Expected result:

```text
KAFKA_TOPIC_PREFIX=test. and topic api-center.audit.log becomes test.api-center.audit.log
```

- [x] **Step 4: Add unit tests**

Modify `api-center/src/kafka/kafka.service.spec.ts`.

Test cases:

```ts
expect(withTopicPrefix("api-center.audit.log", "")).toBe("api-center.audit.log");
expect(withTopicPrefix("api-center.audit.log", "test.")).toBe("test.api-center.audit.log");
expect(withTopicPrefix("tribe.servease.events", "prod")).toBe("prod.tribe.servease.events");
```

- [x] **Step 5: Run verification**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- kafka.service.spec.ts
npm run typecheck
```

Actual:

```text
focused Jest passed with --runInBand
API Center typecheck passed
Docker image build passed and pushed
```

## Phase 3: Create Test Namespace In Current Cluster

Goal: run test/staging beside prod without paying for a second cluster yet.

- [x] **Step 1: Create namespace manifest**

Create `api-center/gcp/gke/test/00-namespace.yaml`.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: api-center-test
```

- [x] **Step 2: Create test service account manifest**

Create `api-center/gcp/gke/test/10-serviceaccount.yaml`.

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api-center
  namespace: api-center-test
  annotations:
    iam.gke.io/gcp-service-account: api-center-gke@api-center-496422.iam.gserviceaccount.com
```

- [x] **Step 3: Create test ConfigMap**

Implemented as a Kustomize patch:

```text
api-center/gcp/gke/test/patches/configmap.yaml
```

Set:

```yaml
KAFKA_TOPIC_PREFIX: "test."
GCP_SECRET_NAME: "api-center-test"
REDIS_URL: "redis://10.88.197.107:6379"
NODE_ENV: "production"
```

- [x] **Step 4: Create test deployment**

Implemented as a Kustomize patch:

```text
api-center/gcp/gke/test/patches/deployment.yaml
```

Use:

```yaml
namespace: api-center-test
replicas: 1
```

Expected:

```text
test API Center runs one replica first
HPA can scale it later
```

- [x] **Step 5: Apply test manifests**

Run:

```powershell
cd C:\Codes\apic\api-center
kubectl apply -f gcp/gke/test/
kubectl -n api-center-test rollout status deploy/api-center --timeout=10m
```

Actual command used because the overlay references the shared base manifests:

```powershell
kubectl kustomize gcp/gke/test --load-restrictor LoadRestrictionsNone | kubectl apply -f -
kubectl -n api-center-test rollout status deploy/api-center --timeout=10m
```

Expected:

```text
deployment/api-center successfully rolled out
```

## Phase 4: Split Secrets

Goal: changing test provider settings must not restart or affect live.

- [x] **Step 1: Create `api-center-test`**

Copy the shape of `api-center-prod`, but set:

```json
{
  "TRIBE_SECRET_GCP_PREFIX": "api-center-test-tribe-secret-",
  "KAFKA_TOPIC_PREFIX": "test."
}
```

Do not reuse live tribe plaintext secrets for test.

- [x] **Step 2: Create `api-shared-services-test`**

Copy the shape of `api-shared-services-prod`, but set:

```json
{
  "PAYMENT_PROVIDER_MODE": "test",
  "GOOGLE_REDIRECT_URI": "https://api-center-test.itsandbox.site/api/v1/shared/gauth/oauth/callback"
}
```

- [ ] **Step 3: Keep `api-center-prod` for live**

Set:

```json
{
  "TRIBE_SECRET_GCP_PREFIX": "api-center-prod-tribe-secret-",
  "KAFKA_TOPIC_PREFIX": "prod."
}
```

- [ ] **Step 4: Keep `api-shared-services-prod` for live**

Set:

```json
{
  "PAYMENT_PROVIDER_MODE": "live",
  "GOOGLE_REDIRECT_URI": "https://api-center.itsandbox.site/api/v1/shared/gauth/oauth/callback"
}
```

- [ ] **Step 5: Restart only the environment that changed**

For test:

```powershell
kubectl -n api-center-test rollout restart deploy/api-center
kubectl -n api-center-test rollout status deploy/api-center --timeout=10m
```

For prod:

```powershell
kubectl -n api-center-prod rollout restart deploy/api-center
kubectl -n api-center-prod rollout status deploy/api-center --timeout=10m
```

## Phase 5: Provision Kafka Topics And S3 Sink Coverage

Goal: make sure every environment topic exists before traffic uses it.

- [x] **Step 1: Create test baseline topics**

Create:

```text
test.api-center.gateway.request
test.api-center.gateway.response
test.api-center.gateway.error
test.api-center.external.request
test.api-center.audit.log
test.api-center.auth.token-issued
test.api-center.auth.token-refreshed
test.api-center.auth.token-revoked
test.api-center.registry.service-registered
test.api-center.registry.service-deregistered
test.api-center.registry.service-deprecated
test.api-center.registry.service-retired
test.api-center.registry.service-version-changed
test.api-center.registry.service-health-changed
test.api-center.tribe.request
test.api-center.tribe.response
test.api-center.shared.sms.events
test.api-center.shared.email.events
test.api-center.shared.payment.events
test.api-center.shared.otp.events
test.api-center.shared.geo.events
test.api-center.shared.gauth.events
```

- [x] **Step 2: Create prod baseline topics**

Create the same list with `prod.` prefix.

- [x] **Step 3: Create tribe topics per environment**

For test:

```text
test.tribe.<tribeId>.events
```

For prod:

```text
prod.tribe.<tribeId>.events
```

- [x] **Step 4: Add all environment topics to the S3 sink**

Using `apicenter-management`, add every `test.*` and `prod.*` topic that should export to:

```text
api-center-s3-sink
```

Expected result:

```text
connector state RUNNING
task 0 RUNNING
connector topics include test and prod topics
```

- [ ] **Step 5: Verify S3 separation**

After smoke tests, check for:

```text
s3://api-center-raw-data/topics/test.api-center.audit.log/
s3://api-center-raw-data/topics/prod.api-center.audit.log/
s3://api-center-raw-data/topics/test.api-center.shared.payment.events/
s3://api-center-raw-data/topics/prod.api-center.shared.payment.events/
```

## Phase 6: Add Test Hostname

Goal: use `api-center-test.itsandbox.site` without disturbing prod.

- [x] **Step 1: Reserve or reuse an ingress IP**

For the same cluster, create a separate global IP:

```powershell
gcloud compute addresses create api-center-test-ip --global --project api-center-496422
gcloud compute addresses describe api-center-test-ip --global --project api-center-496422 --format="value(address)"
```

Actual reserved IP:

```text
34.8.14.214
```

- [x] **Step 2: Create test ManagedCertificate**

Implemented as a Kustomize patch:

```text
api-center/gcp/gke/test/patches/managedcert.yaml
```

```yaml
apiVersion: networking.gke.io/v1
kind: ManagedCertificate
metadata:
  name: api-center-test-cert
  namespace: api-center-test
spec:
  domains:
    - api-center-test.itsandbox.site
```

- [x] **Step 3: Create test ingress**

Implemented as a Kustomize patch:

```text
api-center/gcp/gke/test/patches/ingress.yaml
```

Set:

```yaml
kubernetes.io/ingress.global-static-ip-name: api-center-test-ip
networking.gke.io/managed-certificates: api-center-test-cert
```

Host:

```text
api-center-test.itsandbox.site
```

- [ ] **Step 4: Point Cloudflare DNS**

Create:

```text
api-center-test.itsandbox.site -> <api-center-test-ip>
```

Use:

```text
api-center-test.itsandbox.site -> 34.8.14.214
```

Use DNS-only / gray cloud while Google managed certificate provisions.

- [ ] **Step 5: Verify test HTTPS**

Run:

```powershell
kubectl -n api-center-test get managedcertificate api-center-test-cert
curl.exe -I https://api-center-test.itsandbox.site/api/v1/health/ready
```

Expected:

```text
managed certificate Active
readiness returns HTTP 200
```

## Phase 7: Decide When To Create A Second GKE Cluster

Goal: avoid paying for prod isolation too early, but have a clean trigger.

Create a second GKE cluster or second GCP project when one of these becomes true:

```text
real users depend on uptime
live PayMongo mode is enabled
production tribes depend on API Center
test changes are happening weekly or daily
provider webhooks are live
data retention/compliance matters
```

When that happens, use:

```text
test project/cluster:
  api-center-test.itsandbox.site
  api-center-test
  api-shared-services-test
  KAFKA_TOPIC_PREFIX=test.

prod project/cluster:
  api-center.itsandbox.site
  api-center-prod
  api-shared-services-prod
  KAFKA_TOPIC_PREFIX=prod.
```

## Phase 8: Optional Full Kafka And S3 Isolation

Goal: split data infrastructure only when necessary.

Use separate Confluent and S3 only when prod needs stronger isolation:

```text
test:
  Confluent cluster: api-center-test
  S3 sink: api-center-test-s3-sink
  S3 bucket: api-center-test-raw-data

prod:
  Confluent cluster: api-center-prod
  S3 sink: api-center-prod-s3-sink
  S3 bucket: api-center-prod-raw-data
```

Migration steps:

- [ ] Create prod Confluent cluster in the same AWS region as the prod S3 bucket.
- [ ] Create prod baseline topics with `prod.` prefix.
- [ ] Create prod S3 bucket.
- [ ] Create prod AWS IAM role for Confluent S3 Sink.
- [ ] Create prod provider integration.
- [ ] Create prod S3 sink connector.
- [ ] Put prod Kafka credentials only in `api-center-prod`.
- [ ] Validate prod API Center publishes to prod Confluent.
- [ ] Validate prod S3 receives records.
- [ ] Keep test Confluent and S3 separate for smoke data.

## Acceptance Criteria

- Test and live use different hostnames.
- Test and live use different Secret Manager secrets.
- Test and live publish to different Kafka topics.
- S3 paths clearly separate test and live records.
- Test PayMongo and live PayMongo can coexist without editing the same secret.
- Tribes do not receive Confluent credentials in either environment.
- API Center Management can provision environment-specific tribe topics.
- The platform can move from shared Confluent/S3 to fully isolated Confluent/S3 without changing tribe-facing SDK behavior.

## Cost Notes

Cheap current split:

```text
one GKE cluster
one Redis
one Confluent cluster
one S3 sink connector
one S3 bucket
two namespaces
two hostnames
two secret sets
```

Higher-isolation split:

```text
two GKE clusters or two GCP projects
two Redis instances
one or two Confluent clusters
two S3 sink connectors if data pipeline is fully isolated
one or two S3 buckets
```

The main new fixed costs in the cheap split are another load balancer/static IP and a small amount of extra pod capacity. The main new fixed costs in the full split are a second GKE baseline, second Redis, and second S3 sink connector.

## Operator Answer

Kafka and S3 do not require a second cluster immediately. The clean low-cost design is:

```text
test API Center -> test.* Kafka topics -> same S3 sink -> s3://api-center-raw-data/topics/test.*
prod API Center -> prod.* Kafka topics -> same S3 sink -> s3://api-center-raw-data/topics/prod.*
```

Later, if prod needs hard isolation:

```text
test API Center -> test Confluent cluster -> test S3 bucket
prod API Center -> prod Confluent cluster -> prod S3 bucket
```

Do the environment topic prefix first. It gives most of the data-safety benefit now without doubling Confluent/S3 infrastructure cost.
