# APICenter Total Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move APICenter from a validated test pilot pipeline to a governed multi-tribe test/prod data pipeline with live management visibility, central APICenter governance metrics, tribe-owned Silver/Gold data products, and repeatable production promotion gates.

**Architecture:** APICenter is the central governing tribe/control plane. Product tribes own their domain events and tribe-specific curated data, while APICenter owns topic governance, event envelope standards, raw S3, Glue/Athena infrastructure, Bronze/Common Silver standards, platform Gold metrics, access controls, and pipeline state evidence. The current validated path is event-driven and closest to the AWS serverless data lake diagram; the target adds the lakehouse Bronze/Silver/Gold and feedback-loop model without turning APICenter into a direct operational database ETL pipeline.

**Tech Stack:** NestJS/TypeScript APICenter gateway, Next.js APICenter management, `@implementsprint/sdk`, Confluent Kafka and S3 Sink, AWS S3, AWS Glue/Athena, PowerShell pipeline scripts, Zod schemas, Vitest/Jest, GitHub Actions.

---

## Current Baseline

The current test pipeline is validated for the pilot tribe topic:

```text
test.tribe.codex-sdk-20260520041053.events
  -> Confluent S3 Sink
  -> s3://api-center-raw-data/topics/test.tribe.codex-sdk-20260520041053.events/
  -> api_center_raw.topic_records
  -> bronze.tribe_events
  -> common_silver.tribe_event_envelope
  -> gold_platform.pipeline_health_daily
  -> s3://api-center-athena-results/athena-results/platform/validation/test/
```

Validated evidence:

```text
raw query id: 50b5595b-1d53-4872-bc2e-700a54169c19
raw record count: 1000
quality query id: 40f73aca-a584-4922-ba34-4641b56b271a
quality errors: 0
gold query id: cd109872-3578-4e58-a226-280b04ff9bb1
gold event count: 1000
```

Existing durable architecture doc:

```text
docs/data-pipeline/apicenter-total-data-pipeline-architecture.md
```

Existing rollout evidence:

```text
docs/data-pipeline/operational-rollout-status-2026-05-20.md
```

## Non-Negotiable Rules

- Test and prod are separate lanes. Test success does not imply prod approval.
- Tribe visibility is per tribe topic. Microservice visibility comes from `sourceServiceId`.
- APICenter is the central governing tribe. It owns shared standards, governance, pipeline health, access controls, and platform Gold metrics.
- Raw S3 is platform-only. BI and tribe readers use governed Athena results, Tribe Silver, or Gold.
- Topic onboarding state advances from evidence, not route success.
- Every new tribe should enter through the same state ladder without pipeline rewrites.
- Production promotion requires approval evidence, data ownership, reader groups, bounded queries, and prod validation.

## Scope Boundary

This plan includes the APICenter data pipeline for:

```text
test/prod.tribe.<tribe_id>.events
test/prod.api-center.shared.<shared_service_id>.events
test/prod APICenter gateway, registry, auth, audit, and pipeline ops events
```

It covers both test and prod lanes. Prod remains gated until the production topic,
reader, schema, and validation evidence exists.

CampusOne and CI/CD are outside this implementation plan until those systems are
provisioned into APICenter. The pipeline design leaves room for them by using
`environment`, `source_topic`, `source_system`, `tribe_id`, and
`source_service_id`, but this plan only implements APICenter-owned pipeline
surfaces first.

## Phase Overview

| Phase | Name                                            | Outcome                                                                             |
| ----- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0     | Permission cleanup and temporary policy removal | Validator can list result prefixes; temporary provisioner rights are removed.       |
| 1     | Environment-specific workgroups                 | Test and prod Athena workgroups cannot overwrite each other's result locations.     |
| 2     | Live pipeline health provider                   | Management reads live curated pipeline-health data instead of local files.          |
| 3     | APICenter ops topic alignment                   | Central governing tribe telemetry parses correctly in Bronze.                       |
| 4     | Shared-service Silver and Gold                  | Payment/email/sms/gauth/otp/geo telemetry becomes queryable and attributable.       |
| 5     | Topic projection automation                     | New tribes and shared-service topics cannot drift from Athena projection values.    |
| 6     | Event schema governance                         | Event types and schema versions are governed before production promotion.           |
| 7     | Tribe Silver/Gold factory                       | Each tribe can get approved curated data products without custom pipeline rewrites. |
| 8     | Production pilot promotion                      | First prod tribe topic is validated end to end with approval evidence.              |
| 9     | Platform dashboards and feedback loop           | APICenter management shows live health, governance, quality, and cost signals.      |
| 10    | Materialization and scale hardening             | Views graduate to materialized Parquet/CTAS/Glue jobs where usage requires it.      |
| 11    | Decision intelligence and prescriptive feedback | Optional ML/prescriptive layer starts only after stable Gold metrics exist.         |

---

## Phase 0: Finish Permission Cleanup

**Purpose:** Complete the AWS permission cleanup after the test rollout and remove temporary write privileges.

**Files:**

- Modify: `api-center/infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json`
- Modify: `api-center/infra/aws-data-pipeline/policies/athena-results-provisioner-policy.json`
- Modify: `api-center/docs/data-pipeline/operational-rollout-status-2026-05-20.md`
- Verify: `api-center/scripts/data-pipeline/validate-athena-results-layout.ps1`

**Steps:**

- [x] **Step 1: Reapply validator runtime policy**

Use an AWS admin profile or console to update `APICenterDataPipelineValidator` with:

```text
api-center/infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json
```

Expected capability:

```text
s3:ListBucket on api-center-athena-results with s3:prefix athena-results/*
```

- [x] **Step 2: Verify result bucket inventory works**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\validate-athena-results-layout.ps1 `
  -Bucket api-center-athena-results `
  -Profile apic
```

Expected:

```text
The command returns JSON with bucket, scanned, unclassified_count, and rows.
No AccessDenied for s3:ListBucket.
```

- [x] **Step 3: Remove temporary provisioner policy**

Remove this inline policy from `APICenterDataPipelineValidator` after no more bucket/workgroup write changes are needed:

```text
APICenterAthenaResultsProvisionerTemporary
```

The policy source is:

```text
api-center/infra/aws-data-pipeline/policies/athena-results-provisioner-policy.json
```

- [x] **Step 4: Confirm apply writes are no longer available**

Run:

```powershell
.\scripts\data-pipeline\provision-athena-results-controls.ps1 `
  -Environment test `
  -TribeId codex-sdk-20260520041053 `
  -Profile apic `
  -Apply
```

Expected after temporary policy removal:

```text
The role should not be able to create/update provisioning resources.
Use dry-run for normal operators.
```

- [x] **Step 5: Update rollout evidence**

Append to:

```text
api-center/docs/data-pipeline/operational-rollout-status-2026-05-20.md
```

Record:

```text
validator_policy_reapplied_at:
result_layout_validation_command:
result_layout_validation_status:
temporary_provisioner_policy_removed_at:
operator:
```

**Exit Criteria:**

- Result layout validation succeeds.
- Temporary provisioner policy is removed.
- Validator role remains least-privilege for validation, not provisioning.

---

## Phase 1: Split Athena Workgroups By Environment

**Purpose:** Prevent prod operations from overwriting test result locations and make test/prod isolation enforceable.

**Files:**

- Modify: `api-center/scripts/data-pipeline/provision-athena-results-controls.ps1`
- Modify: `api-center/scripts/data-pipeline/apply-athena-catalog.ps1`
- Modify: `api-center/scripts/data-pipeline/resolve-athena-output-location.ps1`
- Modify: `api-center/infra/aws-data-pipeline/README.md`
- Modify: `api-center/docs/data-pipeline/athena-results-runbook.md`
- Modify: `api-center/docs/data-pipeline/retention-access-cost-controls.md`
- Modify: `api-center/infra/aws-data-pipeline/policies/athena-results-provisioner-policy.json`
- Modify: `api-center/infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json`

**Target Workgroups:**

```text
api-center-platform-validation-test
api-center-platform-validation-prod
api-center-management-test
api-center-management-prod
api-center-tribe-<tribe_id>-test
api-center-tribe-<tribe_id>-prod
```

**Steps:**

- [x] **Step 1: Add environment-specific workgroup naming helper**

In `provision-athena-results-controls.ps1`, derive workgroup names from `Purpose`, `Environment`, and `TribeId`:

```text
platform-validation + test -> api-center-platform-validation-test
platform-validation + prod -> api-center-platform-validation-prod
management + test -> api-center-management-test
management + prod -> api-center-management-prod
tribe + test + logistics -> api-center-tribe-logistics-test
tribe + prod + logistics -> api-center-tribe-logistics-prod
```

- [x] **Step 2: Keep legacy workgroups readable during migration**

Do not delete the existing test workgroups immediately:

```text
api-center-platform-validation
api-center-management
api-center-tribe-codex-sdk-20260520041053
```

Mark them as legacy in docs and migrate commands to the new names.

- [x] **Step 3: Update IAM templates**

Allow environment-specific workgroup ARNs:

```text
arn:aws:athena:*:*:workgroup/api-center-platform-validation-*
arn:aws:athena:*:*:workgroup/api-center-management-*
arn:aws:athena:*:*:workgroup/api-center-tribe-*
```

- [x] **Step 4: Provision test workgroups with new names**

Run dry-run:

```powershell
.\scripts\data-pipeline\provision-athena-results-controls.ps1 `
  -Environment test `
  -TribeId codex-sdk-20260520041053 `
  -Profile apic-admi `
  -DryRun
```

Expected output locations:

```text
s3://api-center-athena-results/athena-results/platform/validation/test/
s3://api-center-athena-results/athena-results/management/test/
s3://api-center-athena-results/athena-results/tribe/codex-sdk-20260520041053/test/
```

Apply only with an admin or provisioner profile. Do not reattach the temporary
provisioner policy to the validator role for normal validation work.

- [x] **Step 5: Re-run catalog dry-run against the new test workgroup**

Run:

```powershell
.\scripts\data-pipeline\apply-athena-catalog.ps1 `
  -Environment test `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -DryRun
```

Expected:

```text
Every step uses output_location under s3://api-center-athena-results/athena-results/platform/validation/test/.
```

**Exit Criteria:**

- New test workgroups exist and point to test result prefixes.
- Docs no longer recommend environment-neutral workgroups for new work.
- Prod has planned but unapplied workgroups until production approval.

---

## Phase 2: Implement Live Pipeline Health Provider

**Purpose:** Make APICenter management read live pipeline-health data from APICenter/Athena instead of local evidence files.

**Files:**

- Modify: `api-center/src/data-pipeline/*`
- Create: `api-center/src/data-pipeline/pipeline-health.controller.ts`
- Create: `api-center/src/data-pipeline/pipeline-health.service.ts`
- Create: `api-center/src/data-pipeline/pipeline-health.dto.ts`
- Create: `api-center/src/data-pipeline/pipeline-health.service.spec.ts`
- Modify: `api-center/src/app.module.ts`
- Modify: `apicenter-management/src/lib/server/pipeline-health-provider.ts`
- Modify: `apicenter-management/src/lib/server/pipeline-health-provider.test.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/health/route.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`

**Steps:**

- [x] **Step 1: Define the APICenter response contract**

Use the existing management row fields:

```text
environment
tribeId
sourceServiceId
eventType
eventDay
eventCount
latestOccurredAt
latestIngestedAt
connectorName
connectorState
s3Prefix
latestS3ObjectKey
latestS3ObjectAt
latestBronzeObservedAt
latestCommonSilverObservedAt
latestGoldObservedAt
qualityErrorCount
athenaResultLocation
bytesScanned
lastRefreshedAt
```

- [x] **Step 2: Add APICenter service test**

Test that `PipelineHealthService` maps Athena/Gold rows into API response rows and rejects unsupported environments.

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/data-pipeline/pipeline-health.service.spec.ts
```

Expected first run before implementation:

```text
FAIL because PipelineHealthService does not exist.
```

- [x] **Step 3: Implement APICenter provider service**

Start with a server-side provider that can run in two modes:

```text
PIPELINE_HEALTH_SOURCE=fixture | athena
```

Use `fixture` for unit tests and local development. Use `athena` only when AWS env/profile is configured.

- [x] **Step 4: Add APICenter route**

Route:

```text
GET /api/v1/data-pipeline/health?environment=test
GET /api/v1/data-pipeline/health?environment=prod
```

This route returns only curated health rows, not raw records.

- [x] **Step 5: Update management `api-center` provider**

In `apicenter-management/src/lib/server/pipeline-health-provider.ts`, make `PIPELINE_HEALTH_PROVIDER=api-center` call the APICenter endpoint.

Expected behavior:

```text
local-file -> read local evidence file
api-center -> fetch APICenter curated endpoint
```

- [x] **Step 6: Verify management tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/pipeline-health-provider.test.ts src/app/api/local/data-pipeline/health/route.test.ts
npx tsc --noEmit
```

Expected:

```text
Provider tests pass for both local-file and api-center modes.
```

**Exit Criteria:**

- `PIPELINE_HEALTH_PROVIDER=api-center` works against APICenter.
- Local file remains fallback.
- Management can show live test pipeline-health rows.

---

## Phase 3: Align APICenter Ops Topics And Bronze Parser

**Purpose:** Make central governing tribe telemetry parse correctly in Bronze and become usable for platform Gold metrics.

**Files:**

- Modify: `api-center/infra/aws-data-pipeline/topic-projection-values.txt`
- Modify: `api-center/infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql`
- Modify: `api-center/infra/aws-data-pipeline/catalog/common-silver-events.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-apicenter-ops-topic.sql`
- Modify: `api-center/docs/data-pipeline/apicenter-total-data-pipeline-architecture.md`
- Modify: APICenter event emitters under `api-center/src/**` after locating the actual emitter path with `rg "gateway.request|token-issued|service-registered|audit" src`

**Decision:**

Keep current projected topic names and update the Bronze parser to support them:

```text
test.api-center.gateway.request
test.api-center.gateway.response
test.api-center.gateway.error
test.api-center.auth.token-issued
test.api-center.registry.service-registered
```

Do not force an immediate topic rename unless Confluent publisher evidence proves the runtime already uses `api-center.ops.*.events`.

**Steps:**

- [x] **Step 1: Add parser cases for existing APICenter topic names**

Update `bronze-apicenter-ops-events.sql` so `ops_stream` can resolve:

```text
gateway.request
gateway.response
gateway.error
auth.token-issued
registry.service-registered
audit.log
external.request
```

- [x] **Step 2: Add validation query**

Create `validate-apicenter-ops-topic.sql` with bounded partitions:

```sql
SELECT
  source_topic,
  environment,
  ops_stream,
  event_type,
  COUNT(*) AS event_count
FROM bronze.apicenter_ops_events
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
GROUP BY 1, 2, 3, 4;
```

- [x] **Step 3: Reapply catalog**

Run:

```powershell
.\scripts\data-pipeline\apply-athena-catalog.ps1 `
  -Environment test `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Wait
```

- [x] **Step 4: Validate ops rows when data exists**

Run:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-apicenter-ops-topic.sql `
  -Database api_center_raw `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Environment test `
  -ResultPurpose platform-validation `
  -Parameters @{ environment = "test"; year = "2026"; month = "05"; day = "20" } `
  -Wait
```

Expected:

```text
If APICenter ops data exists, rows group under the correct ops_stream.
If no data exists, query succeeds with zero data rows and no parser error.
```

**Exit Criteria:**

- Bronze ops view matches the actual projected topic names.
- APICenter central governance events have a parseable Bronze lane.

---

## Phase 4: Add Shared-Service Common Silver And Gold

**Purpose:** Turn platform-owned shared-service telemetry into governed usage, provider-health, and cost analytics.

**Files:**

- Modify: `api-center/infra/aws-data-pipeline/catalog/bronze-shared-service-events.sql`
- Modify: `api-center/infra/aws-data-pipeline/catalog/common-silver-events.sql`
- Create: `api-center/infra/aws-data-pipeline/catalog/gold-shared-service-usage.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-shared-service-usage.sql`
- Modify: `api-center/scripts/data-pipeline/apply-athena-catalog.ps1`
- Modify: `api-center/docs/data-pipeline/metric-dictionary.md`
- Modify: `api-center/docs/data-pipeline/apicenter-total-data-pipeline-architecture.md`

**Target Views:**

```text
common_silver.shared_service_event_envelope
gold_platform.shared_service_usage_daily
gold_platform.shared_service_provider_health_daily
```

**Steps:**

- [x] **Step 1: Add Common Silver shared-service envelope**

Columns:

```text
source_topic
environment
shared_service_id
event_type
schema_version
provider
provider_status
occurred_at
ingested_at
quality_status
quality_error
year
month
day
hour
raw_record
```

- [x] **Step 2: Add shared-service usage Gold**

Aggregate by:

```text
environment
tribe_id
shared_service_id
provider
provider_status
event_day
```

Metrics:

```text
event_count
success_count
failure_count
latest_occurred_at
latest_ingested_at
```

- [x] **Step 3: Add catalog file to apply script**

Add `gold-shared-service-usage.sql` after `gold-platform-health.sql`.

- [x] **Step 4: Validate with bounded query**

Run:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-shared-service-usage.sql `
  -Database api_center_raw `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Environment test `
  -ResultPurpose platform-validation `
  -Parameters @{ environment = "test"; year = "2026"; month = "05"; day = "16" } `
  -Wait
```

Expected:

```text
Query succeeds. Rows appear when shared-service events exist.
```

Validated evidence:

```text
usage_query_execution_id: e9f125de-1311-4e16-a65b-1aa9e8c6b0f7
provider_health_query_execution_id: 8126a6de-ea04-4735-a620-69d7d331f11a
environment: test
year: 2026
month: 05
day: 16
validated_shared_services: email, gauth, geo, otp, payment, sms
```

**Exit Criteria:**

- Shared-service telemetry has Common Silver and Gold views.
- APICenter can answer which shared services are used and whether providers are healthy.

---

## Phase 5: Automate Topic Projection From Confluent

**Purpose:** Prevent Athena from missing late-provisioned tribe or shared-service topics.

**Files:**

- Modify: `api-center/scripts/data-pipeline/resolve-athena-topic-projection.js`
- Create: `api-center/scripts/data-pipeline/check-topic-projection-drift.ps1`
- Create: `api-center/scripts/data-pipeline/check-topic-projection-drift.test.js` if the repo test pattern supports Node script tests, otherwise add a Jest test under `api-center/src/data-pipeline`
- Modify: `api-center/.github/workflows/*` or create a data-pipeline validation workflow if CI already exists in this repo
- Modify: `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`

**Steps:**

- [x] **Step 1: Add projection drift command**

Command contract:

```powershell
.\scripts\data-pipeline\check-topic-projection-drift.ps1 `
  -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt `
  -ExpectedTopic test.tribe.logistics.events
```

Expected:

```text
Exit 0 if expected topic exists.
Exit 1 with a clear message if missing.
```

- [x] **Step 2: Add Confluent optional source**

Support:

```text
CONFLUENT_CLOUD_API_KEY
CONFLUENT_CLOUD_API_SECRET
CONFLUENT_KAFKA_CLUSTER_ID
```

If credentials are missing, the command should still validate the tracked file.

Implementation note:

```text
check-topic-projection-drift.ps1 uses the S3 Sink connector config when
CONFLUENT_CLOUD_API_KEY, CONFLUENT_CLOUD_API_SECRET,
CONFLUENT_ENVIRONMENT_ID, CONFLUENT_KAFKA_CLUSTER_ID, and
CONFLUENT_S3_CONNECTOR_NAME are present.

It falls back to Kafka REST topic listing when CONFLUENT_KAFKA_REST_ENDPOINT,
CONFLUENT_KAFKA_API_KEY, CONFLUENT_KAFKA_API_SECRET, and
CONFLUENT_KAFKA_CLUSTER_ID are present.
```

- [x] **Step 3: Add CI check**

CI should fail if:

- a managed topic is in onboarding state but missing from projection values
- projection values are not sorted
- generated enum does not match `raw-topic-tables.sql`

- [x] **Step 4: Update new tribe onboarding runbook**

Make this a required promotion gate:

```text
Topic exists in Confluent
Topic exists in S3 Sink include list
Topic exists in topic-projection-values.txt
Generated enum is applied to raw-topic-tables.sql
Catalog apply succeeded
```

Validated evidence:

```text
npm test -- src/data-pipeline/resolve-athena-topic-projection.spec.ts --runInBand
npm run check:data-pipeline-projection
.\scripts\data-pipeline\check-topic-projection-drift.ps1 -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt -ExpectedTopic test.tribe.logistics.events -SkipConfluent
.\scripts\data-pipeline\check-topic-projection-drift.ps1 -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt -ExpectedTopic test.tribe.not-yet-onboarded.events -SkipConfluent
```

**Exit Criteria:**

- Late-provisioned tribes can be added without manual Athena drift.
- CI catches projection mismatch before deployment.

---

## Phase 6: Add Event Schema Governance

**Purpose:** Move from envelope-only quality checks to governed event type and schema-version compatibility.

**Files:**

- Create: `api-center/docs/data-pipeline/event-schema-governance.md`
- Create: `api-center/src/data-pipeline/event-schema-registry.service.ts`
- Create: `api-center/src/data-pipeline/event-schema-registry.service.spec.ts`
- Create: `api-center/src/data-pipeline/event-schema-registry.controller.ts`
- Create: `api-center/infra/aws-data-pipeline/catalog/event-schema-registry.sql` if schema metadata is first stored/queryable in Athena, or a Supabase migration if it belongs in the control-plane database
- Modify: `api-center/src/kafka/*` after locating the governed publish service
- Modify: `api-shared-services/src/types.ts` only if SDK event typing needs to expose schema identifiers more explicitly

**Minimum Schema Record:**

```text
tribe_id
event_type
schema_version
environment
owner
steward
json_schema
compatibility_mode
status
approved_by
approved_at
```

**Steps:**

- [x] **Step 1: Define schema governance doc**

Document allowed compatibility modes:

```text
backward
forward
full
none-for-test-only
```

- [x] **Step 2: Add service tests**

Cases:

```text
accept known event_type/schema_version
reject unknown prod event_type
allow unknown test event_type only when test policy allows discovery
reject breaking schema version without approval
```

- [x] **Step 3: Add registry service**

Start with a durable control-plane source if available. If database persistence is not ready, use a file-backed provider only for test.

- [x] **Step 4: Enforce at publish boundary**

APICenter governed publish should:

```text
test -> warn or accept discovery events under policy
prod -> require approved event_type and schema_version
```

- [x] **Step 5: Expose validation evidence**

Add publish decision metadata:

```text
schema_validation_status
schema_registry_version
schema_validation_error
```

**Exit Criteria:**

- Prod event types are not accepted without schema approval.
- Bronze quality checks can distinguish malformed envelope from schema mismatch.

---

## Phase 7: Build Tribe Silver/Gold Factory

**Purpose:** Let every tribe get approved curated data products without custom pipeline rewrites.

**Files:**

- Modify: `api-center/infra/aws-data-pipeline/catalog/tribe-silver-template.sql`
- Modify: `api-center/infra/aws-data-pipeline/catalog/tribe-gold-template.sql`
- Create: `api-center/scripts/data-pipeline/generate-tribe-curated-sql.ps1`
- Create: `api-center/docs/data-pipeline/tribe-curated-data-product-runbook.md`
- Modify: `api-center/docs/data-pipeline/metric-dictionary.md`
- Modify: `api-center/docs/data-pipeline/tribe-data-governance-checklist.md`

**Inputs:**

```text
tribe_id
environment
domain_event_type
metric_name
owner
steward
approved_reader_group
```

**Steps:**

- [x] **Step 1: Add generator dry-run**

Run:

```powershell
.\scripts\data-pipeline\generate-tribe-curated-sql.ps1 `
  -TribeId logistics `
  -Environment test `
  -EventType order.created `
  -MetricName order_created_daily `
  -DryRun
```

Expected:

```text
Prints silver_logistics.order_created and gold_logistics.order_created_daily SQL without applying.
```

- [x] **Step 2: Add approval metadata**

Generated SQL header must include:

```text
owner
steward
approved_reader_group
environment
source common_silver view
```

- [x] **Step 3: Add bounded validation query**

Generated validation query must filter:

```text
environment
tribe_id
event_type
year
month
day
```

- [x] **Step 4: Run for pilot tribe in test**

Use:

```text
tribe_id: codex-sdk-20260520041053
event_type: codex.pipeline.flush
metric_name: pipeline_flush_daily
environment: test
```

**Exit Criteria:**

- A new tribe data product can be generated and validated from templates.
- Tribe-specific Silver/Gold is repeatable without hand-copying SQL.

---

## Phase 8: Promote First Production Tribe Topic

**Purpose:** Validate the same pipeline in prod with strict approval and no test/prod leakage.

**Files:**

- Modify: `api-center/infra/aws-data-pipeline/topic-projection-values.txt`
- Modify: `api-center/infra/aws-data-pipeline/catalog/raw-topic-tables.sql`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/data-pipeline/operational-rollout-status-2026-05-20.md` or create a new dated prod rollout status doc
- Modify: Confluent S3 Sink config through the approved operator workflow

**Required Approval Record:**

```text
approved_prod_physical_topic:
owner_tribe_id:
source_service_ids:
data_owner:
data_steward:
approved_reader_groups:
metric_dictionary_rows_approved:
raw_prod_retention_days:
athena_workgroup:
bytes_scanned_limit:
operator:
approval_timestamp:
```

**Steps:**

- [x] **Step 1: Pick the prod pilot tribe**

Use a real tribe with owner approval. Do not use the temporary SDK smoke tribe unless it is explicitly approved as a prod pilot.

Current status:

```text
approved_pilot: logistics
approval_record: docs/data-pipeline/production-pilot-approval-logistics.json
approved_prod_physical_topic: prod.tribe.logistics.events
preflight_added: scripts/data-pipeline/check-production-pilot-approval.ps1
template_added: docs/data-pipeline/production-pilot-approval-template.json
```

- [x] **Step 2: Provision prod topic and S3 Sink include**

Physical topic:

```text
prod.tribe.<tribe_id>.events
```

Current status:

```text
operator_script: scripts/data-pipeline/ensure-confluent-topic-and-sink.ps1
env_file: ../apicenter-management/.env.live
topic: prod.tribe.logistics.events
connector: api-center-prod-s3-sink
dry_run_before_apply: topic_exists=false, s3_sink_includes_topic=false, connector_topic_count=31
apply_status: topic_created=true, s3_sink_updated=true
post_apply: topic_exists=true, s3_sink_includes_topic=true, connector_topic_count=32
```

- [x] **Step 3: Add prod topic to projection**

Update:

```text
infra/aws-data-pipeline/topic-projection-values.txt
infra/aws-data-pipeline/catalog/raw-topic-tables.sql
```

Current status:

```text
projection_promoter: scripts/data-pipeline/promote-production-pilot-projection.ps1
approved_topic_added: prod.tribe.logistics.events
live_connector_topics_synced: true
topic_count: 63
drift_check: ok=true, warnings=[]
```

- [x] **Step 4: Apply catalog with prod workgroup**

Run:

```powershell
.\scripts\data-pipeline\apply-athena-catalog.ps1 `
  -Environment prod `
  -Workgroup api-center-platform-validation-prod `
  -Profile apic `
  -Wait
```

Current status:

```text
prod_result_controls: created with apic-admi
prod_catalog_apply: refreshed after syncing all live prod connector topics
workgroup: api-center-platform-validation-prod
result_prefix: s3://api-center-athena-results/athena-results/platform/validation/prod/
final_query_ids:
  - 5ba9ec84-6fc1-4297-9173-7685d3afabba
  - 91a45c94-ea32-4e0a-b87d-4b70bce7d487
  - f6d8c661-5500-4a81-8c52-9fbb799fa6aa
  - 6130b686-5be0-412c-94bc-fcb02639e97a
  - b713a87b-c947-450f-aff8-18d7e51e6e43
  - d53bd757-3770-4fc5-b173-33f1bd26c841
  - bc11b92b-ed9a-4e45-9621-eafb5eba86d2
  - d6e4e0b5-01e5-4954-894e-0d872bc9f9bd
  - 1605f97a-a8d4-4169-a263-1c454b4ee692
  - b85f7275-b10a-45a8-a7ce-ce26bc28bb6f
  - 9781641d-3b17-4200-b4cd-8aaec673f565
  - 4a5b40cb-4d54-4117-a6cc-19020f051fee
  - 2255e9a3-2b55-491e-ada5-43ca898b6e95
  - abc94aec-8d2d-43a6-a9a1-3f67b901e965
  - e8fd40c6-4c18-458c-86c9-ffdb1fabdc44
  - 9ea503c3-2193-47c6-894b-c0e33c154305
  - 077bc300-2cd8-43de-bfd3-4502ad61ebeb
  - 2bd70304-02ad-4308-b251-820d6ebf33d7
  - 48ecf064-8271-48d8-bd64-cd3cfd8fbd7f
  - 0b25e753-c49f-4688-96e7-d91bd7254ffe
```

- [x] **Step 5: Publish prod smoke event through APICenter**

Publish through the SDK/gateway, not directly to Kafka.

Required event envelope:

```text
topic: prod.tribe.<tribe_id>.events
sourceServiceId: approved producer service
eventType: approved prod event type
metadata.schemaVersion: approved schema version
payload.occurredAt: ISO timestamp
```

Current status:

```text
operator_script: scripts/data-pipeline/run-prod-logistics-smoke.js
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-schema-fix-d1eb7e6-202605211822
schema_registry: config/event-schema-registry.json
approved_schema: prod.logistics.order.created@1.0.0
single_smoke_id: prod-logistics-smoke-20260520183309
single_publish_status: accepted=true, schema_validation_status=approved
batch_smoke_id: prod-logistics-smoke-20260520183710
batch_publish_count: 1000
batch_publish_status: accepted=true, schema_validation_status=approved
schema_registry_version: apicenter-event-schemas-2026-05-21
secret_cache_note: token retry was required after rotation because API pods cache tribe secret hashes
```

- [x] **Step 6: Validate S3, Raw, Bronze, Silver, Gold**

Run bounded queries equivalent to the test pilot:

```text
validate-s3-prefix.ps1
validate-raw-topic.sql
validate-quality-thresholds.sql
validate-common-silver.sql
pipeline-health-daily.sql
```

Current status:

```text
s3_prefix: s3://api-center-raw-data/topics/prod.tribe.logistics.events/
latest_s3_object_key: topics/prod.tribe.logistics.events/year=2026/month=05/day=20/hour=18/prod.tribe.logistics.events+0+0000000000.json
latest_s3_object_at: 2026-05-20T18:41:05+00:00
raw_query_id: 40da3dfc-0674-4c65-aac0-f54fb378b613
raw_record_count: 1000
quality_query_id: a560149c-5e15-4164-bc83-e3e426ce2697
quality_invalid_count: 0
quality_missing_tribe_id_count: 0
quality_missing_source_service_id_count: 0
quality_unexpected_environment_count: 0
common_silver_query_id: 42f0c628-f1e0-493b-bccd-ef8c455cc203
common_silver_count: 1000
gold_query_id: 93965804-1563-490b-b421-8f898230e849
gold_event_count: 1000
gold_latest_ingested_at: 2026-05-20 18:42:02.167 UTC
```

- [x] **Step 7: Run prod leak guard**

Confirm prod dashboard queries do not read test data and test dashboards do not read prod data.

Current status:

```text
leak_guard_query: infra/aws-data-pipeline/queries/validate-environment-leak-guard.sql
query_execution_id: 1bf40983-7643-4e79-b569-a3077bb4d8bb
leaked_environment_count: 0
checked_record_count: 1000
```

**Exit Criteria:**

- First prod tribe topic reaches Gold.
- Quality thresholds pass or have explicit signed exception.
- Prod results write to prod prefixes.
- No test/prod leakage.

---

## Phase 9: Platform Dashboards And Governance Feedback

**Purpose:** Make APICenter management show live central-governance metrics, not only raw validation evidence.

**Files:**

- Modify: `apicenter-management/src/components/data-pipeline-health-panel.tsx`
- Modify: `apicenter-management/src/components/service-detail/service-pipeline-panel.tsx`
- Create: `apicenter-management/src/components/data-pipeline-governance-panel.tsx`
- Create: `apicenter-management/src/components/data-pipeline-cost-panel.tsx`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `api-center/src/data-pipeline/*`
- Create/modify: platform Gold SQL files under `api-center/infra/aws-data-pipeline/catalog/`

**Dashboards:**

```text
Pipeline health by tribe/source/event/day
Topic onboarding state by tribe/environment
Quality errors by tribe/event/source service
Shared-service usage by tribe/service/provider
Gateway decisions allowed/denied by tribe/service/scope
Athena bytes scanned by workgroup/query/day
```

**Steps:**

- [x] **Step 1: Add platform Gold views**

Create:

```text
gold_platform.event_quality_daily
gold_platform.gateway_decision_daily
gold_platform.shared_service_usage_daily
gold_platform.athena_query_cost_daily
```

Current status:

```text
catalog_file: infra/aws-data-pipeline/catalog/gold-platform-governance.sql
apply_script: scripts/data-pipeline/apply-athena-catalog.ps1
test_catalog_apply_status: succeeded
workgroup: api-center-platform-validation-test
new_governance_query_ids:
  - 521474f2-eedf-4ae7-ac07-8ff60594f9ef
  - 0e1a6c93-0523-4a71-bdf4-9de7227bac56
  - 88ea84b7-0609-41e2-a4b8-7d9140d73af2
  - 32bf5cc8-8ed9-4e21-b888-c55197ff4d8c
cost_source_note: gold_platform.athena_query_cost_daily is ready for APICenter Athena query-execution events, but those events are not emitted yet.
```

- [x] **Step 2: Expose curated APICenter endpoints**

Routes:

```text
GET /api/v1/data-pipeline/quality?environment=test
GET /api/v1/data-pipeline/shared-service-usage?environment=test
GET /api/v1/data-pipeline/gateway-decisions?environment=test
GET /api/v1/data-pipeline/cost?environment=test
```

Current status:

```text
api-center_files:
  - src/data-pipeline/pipeline-governance.service.ts
  - src/data-pipeline/pipeline-governance.service.spec.ts
  - src/data-pipeline/pipeline-health.controller.ts
  - src/data-pipeline/pipeline-health.dto.ts
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-governance-fix-d1eb7e6-202605210317
cloud_build_id: a79040d7-acd7-4412-8727-70eea8223574
rollout_status: deployment/api-center successfully rolled out
route_smoke_status: health, quality, shared-service-usage, gateway-decisions, and cost returned HTTP 200 with success=true
runtime_mode_blocker: deployed API Center is still fixture-mode for pipeline governance, so live Athena rows are not returned from GKE yet.
```

- [x] **Step 3: Add management panels**

Keep the UI operational, not marketing-style:

```text
compact tables
status badges
environment filters
tribe filters
stale and quality alerts
links to evidence/query IDs
```

Current status:

```text
management_files:
  - src/app/data-pipeline/page.tsx
  - src/components/data-pipeline-dashboard-client.tsx
  - src/components/data-pipeline-governance-panel.tsx
  - src/components/data-pipeline-cost-panel.tsx
  - src/components/service-detail/service-pipeline-panel.tsx
  - src/components/service-detail-client.tsx
  - src/lib/server/pipeline-governance-provider.ts
  - src/lib/server/pipeline-governance-store.ts
  - src/app/api/local/data-pipeline/quality/route.ts
  - src/app/api/local/data-pipeline/shared-service-usage/route.ts
  - src/app/api/local/data-pipeline/gateway-decisions/route.ts
  - src/app/api/local/data-pipeline/cost/route.ts
```

- [x] **Step 4: Add feedback actions**

Management should surface actions:

```text
re-run validation
mark evidence reviewed
open onboarding state record
block promotion
request tribe schema fix
```

Current status:

```text
Feedback actions now use a durable mutation contract:
  - DTO, controller, service, and management proxy exist.
  - Records persist to api_center_ops.pipeline_feedback_actions when DATABASE_ENABLED=true.
  - Actor, role, action, environment, target, reason, evidence link, status, and correlationId are retained.
  - Prod promotion.blocked requires a non-empty reason.
  - Live smoke created reviewed feedback record 5206456c-fa75-4730-b625-c843a07ad216 and direct Postgres lookup found rows=1 with correlationId=corr_phase9_reviewfix_smoke.
```

**Exit Criteria:**

- APICenter management answers the north-star question from curated data.
- Operators can see stale, invalid, or expensive pipeline behavior.

Current exit status:

```text
fixed_with_evidence: deployed API Center reads Athena through the AWS SDK runtime and no longer depends on AWS CLI shell-out.
fixed_with_evidence: APICenter emits Athena query-execution telemetry and gold_platform.athena_query_cost_daily returned measured rows for the test partition.
fixed_with_evidence: feedback actions have durable Postgres-backed mutation contracts and management controls.
fixed_with_evidence: data-pipeline routes accept optional year/month/day partition parameters, so operators can review populated historical partitions without freezing the deployed default date.
prod_gate_evidence: dated 2026-05-20 route smoke returned test health=1, test quality=1, prod health=1, and prod quality=1; prod leak guard query 37dcfed2-432f-415f-8b52-ac32c34fc7d8 returned leaked_environment_count=0 and checked_record_count=1000; local management prod smoke returned Athena-backed prod rows and created reviewed feedback record aef1a203-5b39-411f-9aff-fe76a4c92456.
```

---

## Phase 10: Materialization And Scale Hardening

**Purpose:** Move high-use curated views from pure Athena views to materialized Parquet/optimized outputs when usage justifies it.

**Files:**

- Create: `api-center/docs/data-pipeline/materialization-strategy.md`
- Create: `api-center/infra/aws-data-pipeline/catalog/materialized/`
- Create: `api-center/scripts/data-pipeline/materialize-silver-gold.ps1`
- Modify: `api-center/docs/data-pipeline/retention-access-cost-controls.md`
- Modify: `api-center/infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json`

**Materialization Candidates:**

```text
common_silver.tribe_event_envelope
gold_platform.pipeline_health_daily
gold_platform.shared_service_usage_daily
gold_platform.gateway_decision_daily
gold_<tribe_id> high-traffic metric tables
```

**Steps:**

- [x] **Step 1: Define materialization threshold**

Materialize when any condition is true:

```text
dashboard query is scheduled
query repeatedly scans more than approved bytes
query reads broad partitions
BI group requires stable extract
tribe Gold metric is production-facing
```

Current status:

```text
strategy_doc: docs/data-pipeline/materialization-strategy.md
thresholds_defined: scheduled dashboard, repeated broad scan, broad partition reads, BI stable extract, production-facing tribe metric
first_candidates: common_silver.tribe_event_envelope plus platform Gold health, quality, shared-service usage, gateway decisions, and Athena query cost
```

- [x] **Step 2: Add CTAS or Glue job template**

Output layout:

```text
s3://api-center-curated-data/<layer>/<dataset>/environment=<env>/year=YYYY/month=MM/day=DD/
```

Current status:

```text
ctas_script: scripts/data-pipeline/materialize-silver-gold.ps1
catalog_stub: infra/aws-data-pipeline/catalog/materialized/platform-materialized-tables.sql
target_database: materialized_platform
dry_run_first: required before live execution
```

- [x] **Step 3: Add compaction and retention policy**

Rules:

```text
Raw JSON: archive and governed retention
Bronze materialized: 365 days unless exception
Silver: owner-specific retention
Gold: metric-specific retention
Athena query results: 7-30 days
```

Current status:

```text
retention_doc: docs/data-pipeline/retention-access-cost-controls.md updated with curated materialized output guidance
validator_policy: infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json includes api-center-curated-data and materialized_platform permissions
athena_result_controls: test/prod materialization workgroups created with result prefix s3://api-center-athena-results/athena-results/platform/materialization/<environment>/
ctas_workgroup_guardrail: api-center-materialization-* keeps bytes-scanned limit but does not enforce output location so CTAS can write approved external_location under api-center-curated-data
review_fix_replace: -Replace now requires -ConfirmReplaceCleanup and deletes existing target prefix objects before CTAS
review_fix_catalog_scope: validator role can mutate materialized_platform only; source catalogs remain read-only for validation/materialization
review_fix_region: provisioner passes --region to Athena workgroup get/create/update operations
review_fix_tribe_scope: Common Silver materialization supports -TribeId for tribe-facing filtered exports
```

- [x] **Step 4: Validate BI read path**

BI must read:

```text
curated Parquet or Gold views
```

BI must not read:

```text
s3://api-center-raw-data/topics/*
```

Current evidence:

```text
test_materialized_table: materialized_platform.gold_platform_pipeline_health_daily_test_20260520
test_materialized_path: s3://api-center-curated-data/gold/platform/pipeline_health_daily/environment=test/year=2026/month=05/day=20/
test_materialization_query_id: 455be652-9283-476b-81f1-b4fe94c9afb1
materialized_row_count_query_id: 638a8a33-deb5-40cf-8cc8-003814fae9e1
materialized_row_count: 1
source_row_count_query_id: 8de5fede-5c43-4453-adcd-f01faf573d20
source_row_count: 1
reader_handoff_doc: docs/data-pipeline/tribe-platform-aws-access-handoff.md includes curated bucket and materialized_platform read access; raw topic access remains denied/not granted for BI readers
athena_results_layout_check: scanned=473, unclassified_count=0
prod_materialization_workgroup: api-center-materialization-prod created and verified with output s3://api-center-athena-results/athena-results/platform/materialization/prod/
```

**Exit Criteria:**

- Expensive dashboards no longer depend on repeated raw/Bronze scans.
- Curated datasets are partitioned, compacted, and access-controlled.

---

## Phase 11: Decision Intelligence And Prescriptive Feedback

**Purpose:** Add anomaly detection, recommendation, and prescriptive feedback only after the governed Gold layer is stable enough to trust.

**Files:**

- Create: `api-center/docs/data-pipeline/decision-intelligence-strategy.md`
- Create: `api-center/infra/aws-data-pipeline/catalog/gold-platform-decision-signals.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/decision-signals-daily.sql`
- Create: `api-center/src/data-pipeline/decision-signals.service.ts`
- Create: `api-center/src/data-pipeline/decision-signals.service.spec.ts`
- Create: `api-center/src/data-pipeline/decision-signals.controller.ts`
- Modify: `apicenter-management/src/components/data-pipeline-governance-panel.tsx`
- Modify: `apicenter-management/src/lib/schemas.ts`

**Allowed Inputs:**

```text
gold_platform.pipeline_health_daily
gold_platform.event_quality_daily
gold_platform.gateway_decision_daily
gold_platform.shared_service_usage_daily
gold_platform.athena_query_cost_daily
approved tribe Gold metrics
```

Do not train or score from raw S3 unless APICenter records a platform exception
with data-owner approval.

**Steps:**

- [x] **Step 1: Define decision signal contract**

Create a stable output contract:

```text
signal_id
environment
tribe_id
source_service_id
signal_type
severity
metric_name
observed_value
expected_value
recommendation
evidence_query_id
evidence_window_start
evidence_window_end
created_at
status
```

Current status:

```text
strategy_doc: docs/data-pipeline/decision-intelligence-strategy.md
dto_contract: src/data-pipeline/pipeline-health.dto.ts exposes PipelineDecisionSignalRow and allowed signal/severity/status enums
```

- [x] **Step 2: Start with deterministic rules before ML**

Implement deterministic signals first. Phase 11 v1 is threshold-based; rolling
baselines and rate/window comparisons remain a later maturity step after enough
stable Gold history exists.

```text
pipeline_stale when latest_ingested_at is missing
bronze_quality_regression when quality_error_count > 0
athena_cost_spike when max_bytes_scanned > 1073741824
gateway_denial_spike when denied_count > 0
shared_service_error_spike when failure_count > 0
```

Current status:

```text
catalog_view: infra/aws-data-pipeline/catalog/gold-platform-decision-signals.sql
query_file: infra/aws-data-pipeline/queries/decision-signals-daily.sql
source_tables: gold_platform.pipeline_health_daily, event_quality_daily, athena_query_cost_daily, gateway_decision_daily, shared_service_usage_daily
ml_status: not started; deterministic rules only
baseline_status: not started; rolling baselines and rate checks are documented as next maturity work after stable Gold history exists
test_catalog_apply_query_id: acda4303-686e-4a80-ae99-156c89353581
test_decision_signal_query_id: cbde08d3-0488-4aeb-a50e-0e280bcb058e
test_decision_signal_rows: 3 medium shared_service_error_spike rows for 2026-05-20
```

- [x] **Step 3: Add API endpoint**

Route:

```text
GET /api/v1/data-pipeline/decision-signals?environment=test
GET /api/v1/data-pipeline/decision-signals?environment=prod
```

Response source:

```text
gold_platform.decision_signals_daily
```

Current status:

```text
service: src/data-pipeline/decision-signals.service.ts
controller: src/data-pipeline/decision-signals.controller.ts
route: GET /api/v1/data-pipeline/decision-signals
test: src/data-pipeline/decision-signals.service.spec.ts
runtime_source: inherits PIPELINE_GOVERNANCE_SOURCE=athena in deployed GKE; falls back through governance and health provider settings before local fixture mode
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-signals-fix-d1eb7e6-20260521235419
cloud_build_id: 8aefc271-4a38-4eb8-9681-84465ccb8954
rollout_status: deployment/api-center successfully rolled out
route_smoke_status: readiness ok; decision-signals returned HTTP 200 with success=true and meta.source=athena-proxy for test and prod on 2026-05-20
test_route_smoke_count: 3
prod_route_smoke_count: 0
review_fix_deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix-d1eb7e6-20260522001734
review_fix_cloud_build_id: 9884dad4-96d9-4cd1-b669-43a780daf797
review_fix_route_smoke_status: readiness ok; decision-signals stayed meta.source=athena-proxy with test count=3 after false-positive feedback rollout
review_fix2_deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix2-d1eb7e6-20260522003353
review_fix2_cloud_build_id: 9a6b5a94-ac35-4efc-aff3-d2a0a7a3cc84
review_fix2_route_smoke_status: readiness ok; decision-signals stayed meta.source=athena-proxy with test count=3; valid false-positive signal feedback created/listed with status=closed; invalid false-positive event feedback rejected with HTTP 400
```

- [x] **Step 4: Add management review surface**

Management should show:

```text
signal type
severity
affected tribe
affected source service
recommendation
evidence query id
review status
```

Actions should be explicit:

```text
acknowledge
mark false positive
open onboarding state
request tribe fix
block prod promotion
```

Current status:

```text
management_schema: apicenter-management/src/lib/schemas.ts includes PipelineDecisionSignalRow
management_route: apicenter-management/src/app/api/local/data-pipeline/decision-signals/route.ts
management_client: getDataPipelineDecisionSignals
management_surface: DataPipelineGovernancePanel shows signal type, severity, tribe, source, recommendation, evidence, review status, and feedback actions
false_positive_action: decision.false_positive.marked on targetType=signal closes false-positive reviews without opening tribe state
false_positive_database_migration: supabase/migrations/20260521235900_extend_pipeline_feedback_for_decision_signals.sql applied to live API Center DB; rollback insert smoke accepted decision.false_positive.marked on targetType=signal
false_positive_route_smoke: POST/GET feedback-actions succeeded for decision.false_positive.marked on targetType=signal with status=closed
false_positive_signal_only_guard: supabase/migrations/20260522003000_constrain_false_positive_feedback_target.sql applied; rollback DB smoke and live API smoke reject decision.false_positive.marked unless targetType=signal
management_validation: focused schema/governance panel tests passed 11/11; npx tsc --noEmit passed; npm run build passed and includes /api/local/data-pipeline/decision-signals
```

- [x] **Step 5: Gate ML experiments**

Only run ML experiments after:

```text
at least 30 days of stable Gold metrics exists for the target metric
schema versions are governed
prod and test are separated by workgroup and result prefix
data owner approves the feature set
false-positive review workflow exists in management
```

Initial ML candidates:

```text
pipeline staleness risk prediction
event quality anomaly detection
shared-service provider degradation prediction
Athena scan cost anomaly detection
topic cleanup recommendation
```

Current status:

```text
ml_gate_doc: docs/data-pipeline/decision-intelligence-strategy.md states ML is blocked until 30 days of stable approved Gold data, governed schema versions, separated test/prod workgroups/result prefixes, data-owner feature approval, and false-positive review workflow.
implementation_scope: deterministic rules only; no ML training or scoring code added.
api_validation: decision-signals and pipeline-feedback focused tests passed; false-positive non-signal target regression covered; typecheck passed; build passed
```

**Exit Criteria:**

- Deterministic decision signals exist before ML.
- Operators can review recommendations with evidence.
- ML experiments use approved Gold/Silver data only.
- Prescriptive actions never mutate tribe state without operator approval.

---

## Execution Order

Recommended order:

```text
Phase 0 -> Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 -> Phase 5 -> Phase 6 -> Phase 7 -> Phase 8 -> Phase 9 -> Phase 10 -> Phase 11
```

Parallelizable after Phase 1:

- Phase 3 ops topic alignment
- Phase 4 shared-service Silver/Gold
- Phase 5 topic projection automation
- Phase 6 schema governance design
- Phase 11 decision intelligence design after Phase 9 defines the exact governance signals

Do not start Phase 8 production promotion until:

- Phase 0 is complete
- Phase 1 has prod-safe workgroup separation
- Phase 5 prevents projection drift
- Phase 6 has at least production event schema approval for the pilot event type

## Verification Matrix

| Area                            | Command                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Result layout                   | `.\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket api-center-athena-results -Profile apic`                                                                                                                                                                 |
| Catalog dry-run                 | `.\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment test -Workgroup api-center-platform-validation-test -Profile apic -DryRun`                                                                                                                                    |
| Catalog apply                   | `.\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment test -Workgroup api-center-platform-validation-test -Profile apic -Wait`                                                                                                                                      |
| Raw validation                  | `.\scripts\data-pipeline\run-athena-query.ps1 -QueryFile .\infra\aws-data-pipeline\queries\validate-raw-topic.sql -Database api_center_raw -Workgroup api-center-platform-validation-test -Profile apic -Environment test -ResultPurpose platform-validation -Wait`          |
| Quality validation              | `.\scripts\data-pipeline\run-athena-query.ps1 -QueryFile .\infra\aws-data-pipeline\queries\validate-quality-thresholds.sql -Database api_center_raw -Workgroup api-center-platform-validation-test -Profile apic -Environment test -ResultPurpose platform-validation -Wait` |
| APICenter tests                 | `cd C:\Codes\apic\api-center; npm test`                                                                                                                                                                                                                                      |
| Management tests                | `cd C:\Codes\apic\apicenter-management; npm test`                                                                                                                                                                                                                            |
| Management typecheck            | `cd C:\Codes\apic\apicenter-management; npx tsc --noEmit`                                                                                                                                                                                                                    |
| SDK tests if event types change | `cd C:\Codes\apic\api-shared-services; npm run ci`                                                                                                                                                                                                                           |

## Definition Of Done

This plan is complete when:

- Test and prod have separate Athena workgroups and result prefixes.
- APICenter management reads live curated pipeline health through `PIPELINE_HEALTH_PROVIDER=api-center`.
- APICenter ops events, shared-service events, and tribe-owned events all have Bronze and Common Silver lanes.
- Platform Gold answers pipeline health, quality, shared-service usage, gateway decisions, and cost questions.
- Tribe Silver/Gold can be generated from templates for any approved tribe.
- First production tribe topic is validated end to end from SDK publish to Gold.
- Raw S3 remains platform-only.
- BI and tribe access use only governed result prefixes or curated datasets.
- Topic onboarding state advances only from data-plane evidence.
- Late-provisioned tribes do not require pipeline code rewrites.
- Prescriptive decision signals use approved Gold/Silver inputs and keep operator review in the loop.

## Open Risks

| Risk                                                        | Mitigation                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Temporary provisioner permissions are left attached         | Phase 0 removes them and records evidence.                                                                               |
| Environment-neutral workgroups overwrite result locations   | Phase 1 creates environment-specific workgroups.                                                                         |
| APICenter ops topic names and parser stay mismatched        | Phase 3 aligns parser or topic naming before ops dashboards are trusted.                                                 |
| New tribes are added to Confluent but not Athena projection | Phase 5 adds drift checks and CI.                                                                                        |
| Prod event schemas are accepted without approval            | Phase 6 gates prod publish by schema registry.                                                                           |
| Tribe dashboards read raw S3                                | Access model and Phase 10 materialization keep dashboards on curated outputs.                                            |
| Athena costs grow from broad scans                          | Workgroup scan limits, bounded query requirements, and Gold cost dashboards catch drift.                                 |
| Databricks scope expands too early                          | Keep Databricks prototype-only until materialization and production dashboards need it.                                  |
| ML recommendations are trusted before the data is stable    | Phase 11 starts with deterministic rules, requires Gold/Silver inputs, and keeps operator approval before state changes. |
