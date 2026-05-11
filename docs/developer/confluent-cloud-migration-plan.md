# Confluent Cloud Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align APICenter and `api-shared-services` around Confluent Cloud as the managed Kafka/event backbone before the user enters Confluent producer secrets and redeploys.

**Architecture:** APICenter remains the synchronous gateway: GCP API Gateway -> APICenter -> tribe/shared service through registry and proxy checks. Confluent Cloud is the asynchronous event backbone: APICenter/shared services -> Confluent topics -> Confluent S3 Sink Connector -> AWS S3 raw data lake. Do not remove APICenter Kafka publishing code; replace only self-managed Kafka infrastructure/config assumptions.

**Tech Stack:** NestJS, KafkaJS, Docker Compose, GKE YAML, GCP Secret Manager, Confluent Cloud, Confluent Amazon S3 Sink Connector, AWS S3, TypeScript SDK, Jest, Vitest.

---

## Single Source of Truth

This is the active plan. It consolidates and supersedes:

- `docs/developer/confluent-cloud-repo-fix-plan.md`
- Earlier broad content in `docs/developer/confluent-cloud-migration-plan.md`
- Self-hosted operational direction in `docs/kafka-plan.md`
- Self-hosted DR direction in `docs/kafka-dr-runbook.md`

Keep `docs/confluent-cloud-s3-sink-setup.md` as the operational runbook for the actual Confluent/S3 setup state.

## Current Repo Findings

- `src/kafka/kafka.service.ts` already supports Confluent-compatible KafkaJS config through `KAFKA_BROKERS`, `KAFKA_SSL_ENABLED`, `KAFKA_SASL_MECHANISM`, `KAFKA_SASL_USERNAME`, and `KAFKA_SASL_PASSWORD`.
- `src/kafka/topics.ts`, `src/kafka/schemas/*`, audit publishing, registry events, and `src/kafka-governance/*` should stay.
- `docker-compose.yml` still makes local Kafka, Schema Registry, Kafka REST Proxy, and Kafka UI look like the normal stack.
- `gcp/gke/kafka/*`, `docs/kafka-plan.md`, and `docs/kafka-dr-runbook.md` still describe self-managed Kafka/Strimzi/MirrorMaker.
- `gcp/gke/20-configmap.yaml` and `api-center-config.live.yaml` still contain self-managed or localhost Kafka values.
- `api-shared-services/src/TribeClient.ts` exposes both direct Kafka REST helpers and governed APICenter Kafka helpers.

## Current Confluent Target

From `docs/confluent-cloud-s3-sink-setup.md`:

- Active target cluster: `api-center-gcp-dev-main`
- Cluster ID: `lkc-850n9q`
- Cloud/region: AWS `ap-southeast-2`
- Bootstrap endpoint: `pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092`
- S3 sink connector: `api-center-s3-sink`
- S3 bucket: `api-center-raw-data`
- Old cluster: `lkc-vgdkm5` in `ap-southeast-3`; do not delete until new cluster, producer, connector, and S3 export are verified.

---

## Phase 0: Plan Cleanup and Guardrails

**Purpose:** Make the docs unambiguous before any runtime change.

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\developer\confluent-cloud-migration-plan.md`
- Delete: `C:\Codes\apic\api-center\docs\developer\confluent-cloud-repo-fix-plan.md`
- Modify: `C:\Codes\apic\api-center\docs\kafka-plan.md`
- Modify: `C:\Codes\apic\api-center\docs\kafka-dr-runbook.md`

- [ ] **Step 0.1: Keep this file as the single active plan**

Verify only this file contains the active Confluent implementation plan:

```powershell
Get-ChildItem -File docs\developer\*confluent*plan*.md
```

Expected after cleanup:

```text
docs\developer\confluent-cloud-migration-plan.md
```

- [ ] **Step 0.2: Mark self-hosted Kafka docs historical**

Add this banner to the top of `docs/kafka-plan.md`:

```md
> Current production direction: Confluent Cloud. The self-hosted Strimzi/GKE Kafka plan below is historical fallback context. Use `docs/developer/confluent-cloud-migration-plan.md` as the active implementation plan.
```

Add this banner to the top of `docs/kafka-dr-runbook.md`:

```md
> Current production direction: Confluent Cloud plus Confluent-managed S3 Sink. The MirrorMaker/self-hosted Kafka DR runbook below is historical fallback context. Use `docs/developer/confluent-cloud-migration-plan.md` as the active implementation plan.
```

- [ ] **Step 0.3: Verify no duplicate active plan remains**

Run:

```powershell
Select-String -Path docs\developer\*.md,docs\*.md -Pattern 'active implementation plan|Current production direction: Confluent Cloud'
```

Expected: this file is the active plan; old self-hosted docs point here.

---

## Phase 1: Repo Fix Before User Secret Setup

**Purpose:** Make production-facing config and docs point to Confluent before the user adds secrets.

**Files:**
- Modify: `C:\Codes\apic\api-center\.env.example`
- Modify: `C:\Codes\apic\api-center\gcp\gke\20-configmap.yaml`
- Modify: `C:\Codes\apic\api-center\api-center-config.live.yaml`
- Modify: `C:\Codes\apic\api-center\docs\confluent-cloud-s3-sink-setup.md`
- Modify: `C:\Codes\apic\api-center\README.md`
- Modify: `C:\Codes\apic\api-center\docs\developer\README.md`

- [ ] **Step 1.1: Update `.env.example` Kafka section**

Use Confluent-safe placeholders as the active path:

```env
KAFKA_PROVIDER=confluent
KAFKA_BROKERS=<confluent-bootstrap-server>:9092
KAFKA_CLIENT_ID=api-center
KAFKA_GROUP_ID=api-center-group
KAFKA_SSL_ENABLED=true
KAFKA_SSL_REJECT_UNAUTHORIZED=true
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=<confluent-api-key>
KAFKA_SASL_PASSWORD=<confluent-api-secret>
KAFKA_READINESS_REQUIRED=false
```

Keep localhost Kafka only as a commented local fallback:

```env
# Local offline fallback only:
# KAFKA_PROVIDER=local
# KAFKA_BROKERS=localhost:9092
# KAFKA_SSL_ENABLED=false
# KAFKA_SASL_MECHANISM=
# KAFKA_SASL_USERNAME=
# KAFKA_SASL_PASSWORD=
```

- [ ] **Step 1.2: Update GKE ConfigMap**

In `gcp/gke/20-configmap.yaml`, keep only non-secret Confluent values:

```yaml
KAFKA_PROVIDER: "confluent"
KAFKA_CLIENT_ID: "api-center"
KAFKA_GROUP_ID: "api-center-group"
KAFKA_SSL_ENABLED: "true"
KAFKA_SSL_REJECT_UNAUTHORIZED: "true"
KAFKA_SASL_MECHANISM: "plain"
KAFKA_READINESS_REQUIRED: "false"
```

Do not commit `KAFKA_SASL_USERNAME` or `KAFKA_SASL_PASSWORD`. Store them in GCP Secret Manager during Phase 5.

- [ ] **Step 1.3: Clean live config**

Remove `KAFKA_BROKERS: localhost:9092` from `api-center-config.live.yaml`.

Use:

```yaml
KAFKA_PROVIDER: confluent
KAFKA_CLIENT_ID: api-center
KAFKA_GROUP_ID: api-center-group
KAFKA_SSL_ENABLED: "true"
KAFKA_SSL_REJECT_UNAUTHORIZED: "true"
KAFKA_SASL_MECHANISM: plain
KAFKA_READINESS_REQUIRED: "false"
```

- [ ] **Step 1.4: Add active target and user setup checklist**

In `docs/confluent-cloud-s3-sink-setup.md`, add near the top:

```md
## Current Active Target

- Active target cluster: `api-center-gcp-dev-main`
- Active target cluster ID: `lkc-850n9q`
- Region: AWS `ap-southeast-2`
- S3 sink connector: `api-center-s3-sink`
- S3 bucket: `api-center-raw-data`
- Old cluster `lkc-vgdkm5` must not be deleted until API Center produces real records into `lkc-850n9q` and S3 export is verified.

## User Setup After Repo Fix

1. Create or choose an API Center producer API key for cluster `lkc-850n9q`.
2. Grant producer permissions to `api-center.*` and required `tribe.*` topics.
3. Store `KAFKA_BROKERS`, `KAFKA_SASL_USERNAME`, and `KAFKA_SASL_PASSWORD` in GCP Secret Manager.
4. Redeploy API Center.
5. Trigger auth, registry, or proxied traffic.
6. Confirm Confluent receives records.
7. Confirm `api-center-s3-sink` remains running.
8. Confirm S3 receives exported objects.
```

- [ ] **Step 1.5: Verify config references**

Run:

```powershell
Select-String -Path .env.example,gcp\gke\20-configmap.yaml,api-center-config.live.yaml -Pattern 'localhost:9092|kafka:29092|api-center-kafka-kafka-bootstrap'
```

Expected: matches appear only in local fallback or historical comments.

---

## Phase 2: Runtime Config Validation

**Purpose:** Prevent production from booting with stale local/self-managed Kafka settings.

**Files:**
- Modify: `C:\Codes\apic\api-center\src\config\config.service.ts`
- Modify: `C:\Codes\apic\api-center\src\config\config.service.spec.ts`

- [ ] **Step 2.1: Add config tests**

Add tests for:

```text
production + KAFKA_PROVIDER=confluent + localhost broker => fatal config error
production + KAFKA_PROVIDER=confluent + api-center-kafka broker => fatal config error
production + KAFKA_PROVIDER=confluent + missing SASL username/password => fatal config error
production + KAFKA_PROVIDER=confluent + SSL disabled => fatal config error
production + valid Confluent config => no Kafka config error
```

Run:

```powershell
npm run test -- src/config/config.service.spec.ts
```

- [ ] **Step 2.2: Implement provider validation**

Add `provider` to `this.kafka`:

```ts
provider: process.env.KAFKA_PROVIDER || 'confluent',
```

Add production validation:

```ts
if (this.isProduction && this.kafka.provider === 'confluent') {
  if (this.kafka.brokers.some((broker) => broker.includes('localhost') || broker.includes('kafka:') || broker.includes('api-center-kafka'))) {
    errors.push('KAFKA_BROKERS must point to Confluent Cloud in production');
  }
  if (!this.kafka.sslEnabled) {
    errors.push('KAFKA_SSL_ENABLED=true is required for Confluent Cloud');
  }
  if (this.kafka.saslMechanism !== 'plain') {
    errors.push('KAFKA_SASL_MECHANISM=plain is required for Confluent Cloud');
  }
  if (!this.kafka.saslUsername || !this.kafka.saslPassword) {
    errors.push('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are required for Confluent Cloud');
  }
}
```

- [ ] **Step 2.3: Verify**

Run:

```powershell
npm run test -- src/config/config.service.spec.ts
npm run typecheck
```

Expected: PASS.

---

## Phase 3: Quarantine Self-Managed Kafka Infrastructure

**Purpose:** Keep self-hosted Kafka only as explicit local/historical fallback.

**Files:**
- Modify: `C:\Codes\apic\api-center\docker-compose.yml`
- Modify: `C:\Codes\apic\api-center\gcp\gke\kafka\README.md`
- Modify: `C:\Codes\apic\api-center\gcp\gke\kafka\dr\README.md`
- Modify: `C:\Codes\apic\api-center\gcp\gke\deploy-kafka-stack.ps1`
- Modify: `C:\Codes\apic\api-center\gcp\gke\deploy-kafka-stack.sh`
- Modify: `C:\Codes\apic\api-center\gcp\gke\run-kafka-rollout.ps1`

- [ ] **Step 3.1: Put local Kafka services behind a profile**

Add this to `kafka`, `schema-registry`, `kafka-rest`, and `kafka-ui` services:

```yaml
profiles:
  - local-kafka
```

Remove the hard APICenter dependency on `kafka` for the default compose path.

- [ ] **Step 3.2: Add fallback banners**

At the top of `gcp/gke/kafka/README.md` and `gcp/gke/kafka/dr/README.md`, add:

```md
> Current production direction: Confluent Cloud. These self-hosted Kafka manifests are retained only as historical or emergency fallback assets.
```

- [ ] **Step 3.3: Guard self-hosted rollout scripts**

Make `deploy-kafka-stack.ps1`, `deploy-kafka-stack.sh`, and `run-kafka-rollout.ps1` require an explicit `AllowSelfHostedKafka` or `--allow-self-hosted-kafka` flag before applying self-hosted Kafka resources.

Expected default message:

```text
Self-hosted Kafka rollout is disabled. Use Confluent Cloud for production Kafka.
```

- [ ] **Step 3.4: Verify script guard**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\gcp\gke\run-kafka-rollout.ps1 -DryRun
```

Expected: it does not apply self-hosted Kafka unless the explicit allow flag is present.

---

## Phase 4: API and SDK Surface Alignment

**Purpose:** Make governed Kafka publishing the primary tribe-facing path.

**Files:**
- Modify: `C:\Codes\apic\api-center\src\external\apis\index.ts`
- Modify: `C:\Codes\apic\api-center\src\external\apis\kafka.ts`
- Modify: `C:\Codes\apic\api-center\src\external\external.service.spec.ts`
- Modify: `C:\Codes\apic\api-center\src\external\guards\external-policy.guard.spec.ts`
- Modify: `C:\Codes\apic\api-shared-services\README.md`
- Modify: `C:\Codes\apic\api-shared-services\src\TribeClient.ts`
- Modify: `C:\Codes\apic\api-shared-services\tests\TribeClient.test.ts`

- [ ] **Step 4.1: Disable legacy external Kafka REST by default**

Add:

```env
KAFKA_EXTERNAL_REST_ENABLED=false
```

Change external API construction so `kafka` is registered only when this variable is true.

- [ ] **Step 4.2: Add API Center tests**

Add tests that verify:

```text
KAFKA_EXTERNAL_REST_ENABLED=false => external API catalogue excludes kafka
KAFKA_EXTERNAL_REST_ENABLED=true => external API catalogue includes kafka
```

Run:

```powershell
npm run test -- src/external/external.service.spec.ts src/external/guards/external-policy.guard.spec.ts
```

- [ ] **Step 4.3: Mark SDK direct Kafka REST helpers as legacy**

Add this comment above `kafkaListClusters`, `kafkaListTopics`, and `kafkaProduceRecords`:

```ts
/**
 * Legacy direct Kafka REST bridge helper.
 * Prefer kafkaGetGovernanceCatalog() and kafkaPublish() for new tribe integrations.
 */
```

Add to `api-shared-services/README.md`:

```md
### Kafka with Confluent Cloud

For new tribe integrations, prefer `kafkaGetGovernanceCatalog()` and `kafkaPublish()`. These call APICenter's governed Kafka API, and APICenter publishes to the configured Confluent Cloud cluster.

The direct Kafka REST helpers (`kafkaListClusters`, `kafkaListTopics`, `kafkaProduceRecords`) are legacy compatibility helpers for `/api/v1/external/kafka/*`.
```

- [ ] **Step 4.4: Verify SDK**

Run in `C:\Codes\apic\api-shared-services`:

```powershell
npm run typecheck
npm run test -- tests/TribeClient.test.ts
```

Expected: PASS.

---

## Phase 5: User Secret Setup

**Purpose:** User enters provider secrets outside git after repo guardrails are in place.

**Owner:** User or operator with Confluent and GCP Secret Manager access.

- [ ] **Step 5.1: Create or choose API Center producer key**

Create a Confluent API key for cluster:

```text
lkc-850n9q
```

Use it only for APICenter producing events.

- [ ] **Step 5.2: Grant producer permissions**

Grant the API Center producer principal:

```text
WRITE and DESCRIBE on topic prefix api-center.
WRITE and DESCRIBE on topic prefix tribe.
CREATE only if APICenter is allowed to create missing topics.
```

- [ ] **Step 5.3: Store runtime secrets in GCP Secret Manager**

Set:

```env
KAFKA_BROKERS=pkc-ldvj1.ap-southeast-2.aws.confluent.cloud:9092
KAFKA_SASL_USERNAME=<api-center-producer-api-key>
KAFKA_SASL_PASSWORD=<api-center-producer-api-secret>
```

Do not commit these values.

---

## Phase 6: Deploy and Verify

**Purpose:** Prove API Center publishes real records to Confluent and the S3 sink exports them.

**Files:**
- Modify: `C:\Codes\apic\api-center\test-all-steps.ps1`
- Modify: `C:\Codes\apic\api-center\docs\developer\UPGRADE_TEST_MATRIX.md`
- Create: `C:\Codes\apic\api-center\scripts\verify-confluent-config.js`
- Create: `C:\Codes\apic\api-center\scripts\verify-confluent-topics.js`
- Modify: `C:\Codes\apic\api-center\package.json`

- [ ] **Step 6.1: Add local verification scripts**

Create `scripts/verify-confluent-config.js` to check env shape without printing secrets:

```text
KAFKA_PROVIDER=confluent
KAFKA_BROKERS contains .confluent.cloud:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME is set
KAFKA_SASL_PASSWORD is set
```

Create `scripts/verify-confluent-topics.js` to compare `src/kafka/topics.ts` topic names with `docs/confluent-topic-settings.csv`.

Add package scripts:

```json
"verify:confluent-config": "node scripts/verify-confluent-config.js",
"verify:confluent-topics": "node scripts/verify-confluent-topics.js"
```

- [ ] **Step 6.2: Redeploy API Center**

After Phase 5 secrets are set:

```powershell
kubectl -n api-center rollout restart deploy/api-center
kubectl -n api-center rollout status deploy/api-center --timeout=10m
```

- [ ] **Step 6.3: Verify API Center health and traffic**

Run:

```text
GET /api/v1/health/ready
POST /api/v1/auth/token
one proxied tribe/shared route if available
```

Expected: API Center serves traffic and Kafka publish failures do not block synchronous proxy routing.

- [ ] **Step 6.4: Verify Confluent**

Check cluster `lkc-850n9q`:

```text
api-center.audit.log receives new records
api-center.auth.token-issued receives new records after token issuance
api-center.registry.* receives records after registration lifecycle changes
```

- [ ] **Step 6.5: Verify S3 sink**

Check:

```text
connector api-center-s3-sink is RUNNING
task 0 is RUNNING
bucket api-center-raw-data receives exported objects
```

Note: S3 export may not appear immediately because current connector settings use `flush.size=1000` and hourly partitioning.

---

## Phase 7: Retire Old Paths

**Purpose:** Remove cost and confusion only after live validation.

- [ ] **Step 7.1: Confirm cutover is complete**

Do not proceed unless:

```text
API Center produces records to lkc-850n9q
api-center-s3-sink exports records to S3
No production config points to old cluster lkc-vgdkm5
No production config points to self-hosted Strimzi Kafka
```

- [ ] **Step 7.2: Retire old Confluent cluster**

Only after approval, retire/delete:

```text
old cluster lkc-vgdkm5 in ap-southeast-3
```

- [ ] **Step 7.3: Decide whether to delete self-hosted Kafka manifests**

If self-hosted fallback is no longer needed, remove:

```text
gcp/gke/kafka/*
gcp/gke/deploy-kafka-stack.*
gcp/gke/run-kafka-rollout.ps1 Kafka-only paths
```

If fallback is still desired, keep banners and explicit allow flags.

---

## Acceptance Criteria

- [ ] This file is the only active Confluent implementation plan.
- [ ] Old Kafka plan/runbook are marked historical/fallback and point here.
- [ ] Production-facing config no longer points to `localhost:9092`, `kafka:29092`, or `api-center-kafka-kafka-bootstrap`.
- [ ] Real secrets are not committed.
- [ ] `src/kafka/*` and `src/kafka-governance/*` remain intact.
- [ ] `/api/v1/kafka/governance` and `/api/v1/kafka/publish` remain the preferred SDK path.
- [ ] Legacy `/api/v1/external/kafka/*` is disabled by default or explicitly marked legacy.
- [ ] Self-hosted Kafka rollout requires an explicit fallback flag.
- [ ] User setup steps are documented in the Confluent runbook.
- [ ] API Center produces real records to `lkc-850n9q`.
- [ ] Confluent S3 sink exports records to `api-center-raw-data`.
- [ ] Old cluster `lkc-vgdkm5` is retired only after validation.
