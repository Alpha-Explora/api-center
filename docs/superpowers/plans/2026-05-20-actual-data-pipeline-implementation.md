# Actual Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real APICenter analytics pipeline after Confluent S3 Sink: raw S3 validation, Glue/Athena cataloging, Bronze normalization, Common Silver, tribe-specific Silver/Gold, and a first visualization/API-ready data product.

**Architecture:** Keep APICenter as the governed event control plane and Confluent S3 Sink as the raw export mechanism. Implement the first dependable data platform slice with AWS-native S3 + Glue + Athena because it proves the lake path at low operational cost; keep Databricks as a later curated transform/warehouse option once raw, Bronze, and access governance are proven. Late-provisioned tribes enter the same pipeline through topic-state records and metadata refresh, not new code paths.

**Tech Stack:** APICenter SDK `publishTribeEvent()`, Confluent Cloud Kafka, Confluent S3 Sink, AWS S3, AWS Glue Data Catalog, Amazon Athena, PowerBI/QuickSight/management-console read layer, optional Databricks prototype or production workspace later.

---

## Current Baseline

The tribe/topic work already proves:

```text
tribe backend
  -> @implementsprint/sdk publishTribeEvent()
  -> APICenter /api/v1/kafka/publish
  -> APICenter auth, registry, scope, and tenant-topic checks
  -> Confluent physical topic such as test.tribe.<ownerTribeId>.events
  -> Confluent S3 Sink topic inclusion
```

This plan starts after that point:

```text
Confluent S3 Sink
  -> s3://api-center-raw-data/topics/<physical-topic-name>/...
  -> Glue/Athena raw tables
  -> Bronze normalized event table/view
  -> Common Silver
  -> Tribe Silver/Gold or shared Gold
  -> dashboard/API/BI surface
```

## Scope Decisions

- First implementation target is AWS-native Glue/Athena, not Databricks-first.
- Active system scope is APICenter only.
- Test and prod must remain isolated by `environment` parsed from physical topic prefixes.
- Raw S3 remains platform-only; production dashboards must not query raw S3 directly.
- Bronze and Common Silver must be generic enough for late-provisioned tribes.
- Tribe-specific Silver/Gold starts only after event semantics and metric definitions are approved.
- APICenter operational analytics is required, but it must use approved sanitized ops export streams, not a blanket export of every internal APICenter infrastructure topic.
- Other non-provisioned systems are out of scope for this implementation plan until they are explicitly onboarded and provisioned.
- Databricks Free Edition is prototype-only; it must not be treated as the production multi-tribe platform.

## North Star Question

The APICenter north star for this pipeline is:

```text
From tribe request to gateway decision to event export to visualization, can we trace who called what, whether it was allowed, what happened, how much it cost, and where the data landed?
```

That breaks into five APICenter visibility questions:

1. Who called what: caller tribe, source service, target service, route, event type.
2. Whether it was allowed: auth result, scopes, consumes policy, gateway decision, denial reason.
3. What happened: response status, provider outcome, latency, retry/failure classification.
4. How much it cost: provider cost, event volume, Confluent/S3/Athena/BI cost drivers.
5. Where the data landed: Kafka physical topic, S3 prefix/object, Bronze/Silver/Gold table, dashboard/API surface.

The implementation must answer all five for APICenter, but with separate topic lanes and schemas so tribe business analytics, shared-service telemetry, and APICenter operational analytics do not get mixed accidentally. Do not add any other system-specific north star to this plan until that system has gone through onboarding, classification, topic provisioning, and data-product approval.

## Topic Inclusion Lanes

The pipeline includes all approved export topics, not every Kafka topic.

| Lane | Included topics | Owner | Bronze target | Notes |
| --- | --- | --- | --- | --- |
| Tribe business events | `test.tribe.<ownerTribeId>.events`, `prod.tribe.<ownerTribeId>.events` | Tribe semantics, platform pipeline | `bronze.tribe_events` | Microservices use `sourceServiceId`; no per-service topic by default. |
| Shared-service exports | `test.api-center.shared.<serviceId>.events`, `prod.api-center.shared.<serviceId>.events` | Platform shared-service owner | `bronze.shared_service_events` | Sanitized provider/service telemetry only. |
| APICenter operational analytics | `test.api-center.ops.<stream>.events`, `prod.api-center.ops.<stream>.events` | Platform API/data owner | `bronze.apicenter_ops_events` | Gateway, auth, policy, registry, Kafka publish, and S3 export health events. |

Do not include these internal/control topics by default:

```text
api-center.tribe.request
api-center.tribe.response
api-center.shared.request
api-center.shared.response
api-center.audit.log
api-center.registry.service-registered
api-center.registry.service-deregistered
__consumer_offsets
__*
```

If an internal topic becomes analytically important, create a sanitized
`api-center.ops.<stream>.events` export first, with schema, redaction,
retention, and approval. Do not point the data lake directly at request/response
or audit topics that may contain payloads, credentials, tokens, or PII.

## Existing Repo Anchors

Use these existing docs as the requirements source:

- `api-center/docs/superpowers/plans/2026-05-19-tribe-data-pipeline-ownership.md`
- `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`
- `api-center/docs/data-pipeline/raw-to-bronze-runbook.md`
- `api-center/docs/data-pipeline/retention-access-cost-controls.md`
- `api-center/docs/data-pipeline/silver-gold-ownership-runbook.md`
- `api-center/docs/data-pipeline/tribe-data-governance-checklist.md`
- `api-center/docs/data-pipeline/tribe-event-contract.md`
- `api-center/docs/confluent-cloud-s3-sink-setup.md`
- `api-center/docs/production-costing.md`

## Planned File Structure

Create implementation artifacts under `api-center/infra/aws-data-pipeline/` and validation helpers under `api-center/scripts/data-pipeline/`.

| Path | Purpose |
| --- | --- |
| `api-center/infra/aws-data-pipeline/README.md` | Operator entrypoint, environment variables, and execution order. |
| `api-center/infra/aws-data-pipeline/catalog/raw-topic-tables.sql` | Athena/Glue external table DDL for raw S3 topic folders. |
| `api-center/infra/aws-data-pipeline/catalog/bronze-tribe-events.sql` | Bronze table/view DDL and normalization rules. |
| `api-center/infra/aws-data-pipeline/catalog/bronze-shared-service-events.sql` | Bronze table/view DDL for approved shared-service export topics. |
| `api-center/infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql` | Bronze table/view DDL for approved APICenter operational analytics streams. |
| `api-center/infra/aws-data-pipeline/catalog/common-silver-events.sql` | Common Silver view/table for normalized cross-tribe event analytics. |
| `api-center/docs/data-pipeline/apicenter-operational-analytics-contract.md` | Approved APICenter ops streams, schemas, redaction rules, and forbidden raw topics. |
| `api-center/infra/aws-data-pipeline/catalog/gold-platform-health.sql` | First shared Gold metrics for pipeline health and event freshness. |
| `api-center/infra/aws-data-pipeline/catalog/tribe-silver-template.sql` | Template for tribe-owned Silver models. |
| `api-center/infra/aws-data-pipeline/catalog/tribe-gold-template.sql` | Template for tribe-owned Gold metrics. |
| `api-center/infra/aws-data-pipeline/queries/validate-raw-topic.sql` | Parameterized Athena raw validation query. |
| `api-center/infra/aws-data-pipeline/queries/validate-bronze-topic.sql` | Parameterized Bronze validation query. |
| `api-center/infra/aws-data-pipeline/queries/validate-common-silver.sql` | Parameterized Common Silver query. |
| `api-center/infra/aws-data-pipeline/queries/pipeline-health-daily.sql` | Gold pipeline-health query. |
| `api-center/scripts/data-pipeline/validate-s3-prefix.ps1` | AWS CLI validation for S3 object arrival under a physical topic. |
| `api-center/scripts/data-pipeline/run-athena-query.ps1` | Reusable Athena query runner with workgroup, database, and output location. |
| `api-center/scripts/data-pipeline/validate-topic-pipeline.ps1` | End-to-end raw S3 + Athena + Bronze validation wrapper. |
| `api-center/docs/data-pipeline/actual-pipeline-runbook.md` | Human runbook for setup, validation, rollback, and operating states. |
| `api-center/docs/data-pipeline/metric-dictionary.md` | Required metric definitions and sign-off table for Gold outputs. |

---

## Phase 0: Close Prerequisites

**Purpose:** Ensure the tribe-topic work is closed enough that the data pipeline is not debugging APICenter basics.

**Files:**
- Modify: `api-center/docs/superpowers/plans/2026-05-19-tribe-boundary-events-sdk.md`
- Modify: `api-center/docs/superpowers/plans/2026-05-19-tribe-data-pipeline-ownership.md`

- [ ] **Step 1: Record SDK package install verification**

Add this note to `2026-05-19-tribe-boundary-events-sdk.md` under the SDK 1.2.1 verification section:

```text
GitHub Packages install visibility, 2026-05-20:
- Operator configured GITHUB_TOKEN with read:packages locally.
- npm view @implementsprint/sdk@1.2.1 version --registry=https://npm.pkg.github.com returned 1.2.1.
- Durable npm config uses @implementsprint registry mapping and ${GITHUB_TOKEN}; no raw token is committed.
```

- [ ] **Step 2: Commit the safe SDK npm config**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
git add .npmrc
git commit -m "chore: add github packages registry config"
```

Expected:

```text
1 file changed
.npmrc contains ${GITHUB_TOKEN}, not a raw token
```

- [ ] **Step 3: Decide whether to keep external consumer npmrc edits**

If external consumer repos should keep durable install config, commit them in their own repos. If this work was only for APICenter testing, revert only the `.npmrc` edits in the touched consumer repos.

Do not add those consumer systems to this data-pipeline plan, and do not change package dependencies in this step.

- [ ] **Step 4: Confirm topic state baseline**

Record the current verified test topic evidence:

```text
temporary_tribe: codex-sdk-20260520041053
temporary_source_service: codex-sdk-20260520041053-api
physical_topic: test.tribe.codex-sdk-20260520041053.events
confluent_cluster: lkc-850n9q
s3_sink_connector: api-center-test-s3-sink
sdk_publish_result: accepted=true
microservice_topic_boundary_result: 403 outside tenant boundary
```

Expected:

```text
The data pipeline starts from a known topic that reached Sink included and Publishing.
```

---

## Phase 1: Validate Raw S3 And AWS Access

**Purpose:** Prove that S3 objects can be observed and queried before building any Bronze/Silver abstraction.

**Files:**
- Create: `api-center/scripts/data-pipeline/validate-s3-prefix.ps1`
- Create: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`

- [ ] **Step 1: Write the S3 prefix validator script**

Create `api-center/scripts/data-pipeline/validate-s3-prefix.ps1`:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$Bucket,
  [Parameter(Mandatory=$true)][string]$PhysicalTopic,
  [string]$Profile = $env:AWS_PROFILE,
  [int]$MaxKeys = 20
)

$ErrorActionPreference = "Stop"

$aws = "aws"
$prefix = "topics/$PhysicalTopic/"
$args = @("s3api", "list-objects-v2", "--bucket", $Bucket, "--prefix", $prefix, "--max-keys", "$MaxKeys")

if ($Profile) {
  $args += @("--profile", $Profile)
}

$json = & $aws @args | ConvertFrom-Json
$objects = @($json.Contents)

[pscustomobject]@{
  bucket = $Bucket
  physical_topic = $PhysicalTopic
  prefix = "s3://$Bucket/$prefix"
  object_count_returned = $objects.Count
  latest_key = ($objects | Sort-Object LastModified -Descending | Select-Object -First 1).Key
  latest_object_at = ($objects | Sort-Object LastModified -Descending | Select-Object -First 1).LastModified
} | ConvertTo-Json -Depth 5
```

- [ ] **Step 2: Run the S3 prefix validator against test**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\validate-s3-prefix.ps1 `
  -Bucket api-center-raw-data `
  -PhysicalTopic test.tribe.codex-sdk-20260520041053.events `
  -Profile apic
```

Expected:

```text
JSON output with prefix s3://api-center-raw-data/topics/test.tribe.codex-sdk-20260520041053.events/
object_count_returned >= 1 after connector flush
```

If `object_count_returned = 0`, stay in `Publishing but not flushed` and check connector task state, lag, flush size, and whether enough records were published.

- [ ] **Step 3: Add raw S3 evidence section to the runbook**

Create `api-center/docs/data-pipeline/actual-pipeline-runbook.md` with:

```markdown
# Actual Data Pipeline Runbook

## Raw S3 Evidence

Record this for every topic before cataloging:

```text
owner_tribe_id:
source_service_ids:
environment:
physical_topic:
s3_prefix:
latest_s3_object_key:
latest_s3_object_at:
object_count:
validator_command:
validator_output_link:
operator:
checked_at:
```

Do not mark a topic `Raw observed` until at least one object appears under the exact physical topic prefix.
```

- [ ] **Step 4: Commit Phase 1**

Run:

```powershell
cd C:\Codes\apic\api-center
git add scripts/data-pipeline/validate-s3-prefix.ps1 docs/data-pipeline/actual-pipeline-runbook.md docs/data-pipeline/new-tribe-s3-onboarding-runbook.md
git commit -m "feat: add raw s3 pipeline validation"
```

---

## Phase 2: Define Glue/Athena Raw Catalog

**Purpose:** Make raw Confluent S3 Sink data queryable without changing tribe onboarding code.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/README.md`
- Create: `api-center/infra/aws-data-pipeline/catalog/raw-topic-tables.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-raw-topic.sql`
- Create: `api-center/scripts/data-pipeline/run-athena-query.ps1`

- [ ] **Step 1: Create infrastructure README**

Create `api-center/infra/aws-data-pipeline/README.md`:

```markdown
# APICenter AWS Data Pipeline

This folder contains the first production-leaning analytics pipeline after Confluent S3 Sink.

Execution order:

1. Validate S3 object arrival with `scripts/data-pipeline/validate-s3-prefix.ps1`.
2. Create or update Glue/Athena raw catalog objects from `catalog/raw-topic-tables.sql`.
3. Run `queries/validate-raw-topic.sql`.
4. Create Bronze from `catalog/bronze-tribe-events.sql`.
5. Create Common Silver from `catalog/common-silver-events.sql`.
6. Create Gold metrics after approval from `catalog/gold-platform-health.sql`.

Required environment:

```text
AWS_PROFILE
ATHENA_WORKGROUP
ATHENA_DATABASE
ATHENA_OUTPUT_LOCATION
API_CENTER_RAW_BUCKET
```

Raw S3 is not a BI source. Production dashboards must read curated Silver or Gold outputs.
```

- [ ] **Step 2: Create raw catalog DDL**

Create `api-center/infra/aws-data-pipeline/catalog/raw-topic-tables.sql`:

```sql
CREATE DATABASE IF NOT EXISTS api_center_raw;

CREATE EXTERNAL TABLE IF NOT EXISTS api_center_raw.topic_records (
  raw_line string
)
PARTITIONED BY (
  physical_topic string
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'
WITH SERDEPROPERTIES (
  'serialization.format' = '1'
)
LOCATION 's3://api-center-raw-data/topics/';
```

Note: if the Confluent S3 Sink writes JSON records with a different folder shape or file format, replace this DDL after Phase 1 captures a real object sample. Do not guess silently.

- [ ] **Step 3: Create raw validation query**

Create `api-center/infra/aws-data-pipeline/queries/validate-raw-topic.sql`:

```sql
SELECT
  physical_topic,
  COUNT(*) AS raw_record_count
FROM api_center_raw.topic_records
WHERE physical_topic = '${physical_topic}'
GROUP BY physical_topic;
```

- [ ] **Step 4: Create reusable Athena query runner**

Create `api-center/scripts/data-pipeline/run-athena-query.ps1`:

```powershell
param(
  [Parameter(Mandatory=$true)][string]$QueryFile,
  [string]$Database = $env:ATHENA_DATABASE,
  [string]$Workgroup = $env:ATHENA_WORKGROUP,
  [string]$OutputLocation = $env:ATHENA_OUTPUT_LOCATION,
  [string]$Profile = $env:AWS_PROFILE,
  [hashtable]$Parameters = @{}
)

$ErrorActionPreference = "Stop"

if (-not $Database) { throw "ATHENA_DATABASE is required" }
if (-not $Workgroup) { throw "ATHENA_WORKGROUP is required" }
if (-not $OutputLocation) { throw "ATHENA_OUTPUT_LOCATION is required" }

$query = Get-Content -LiteralPath $QueryFile -Raw
foreach ($key in $Parameters.Keys) {
  $query = $query.Replace('${' + $key + '}', [string]$Parameters[$key])
}

$args = @(
  "athena", "start-query-execution",
  "--query-string", $query,
  "--query-execution-context", "Database=$Database",
  "--work-group", $Workgroup,
  "--result-configuration", "OutputLocation=$OutputLocation"
)

if ($Profile) {
  $args += @("--profile", $Profile)
}

& aws @args
```

- [ ] **Step 5: Run raw Athena validation**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-raw-topic.sql `
  -Database api_center_raw `
  -Workgroup $env:ATHENA_WORKGROUP `
  -OutputLocation $env:ATHENA_OUTPUT_LOCATION `
  -Profile apic `
  -Parameters @{ physical_topic = "test.tribe.codex-sdk-20260520041053.events" }
```

Expected:

```text
Athena query execution starts successfully.
Query result shows raw_record_count >= 1 after partitions/metadata are refreshed.
```

- [ ] **Step 6: Commit Phase 2**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline scripts/data-pipeline/run-athena-query.ps1
git commit -m "feat: add raw athena catalog foundation"
```

---

## Phase 3: Build Bronze Event Layer

**Purpose:** Normalize the APICenter event envelope while preserving raw payload fidelity.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/catalog/bronze-tribe-events.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-bronze-topic.sql`
- Modify: `api-center/docs/data-pipeline/raw-to-bronze-runbook.md`

- [ ] **Step 1: Create Bronze DDL**

Create `api-center/infra/aws-data-pipeline/catalog/bronze-tribe-events.sql`:

```sql
CREATE DATABASE IF NOT EXISTS bronze;

CREATE OR REPLACE VIEW bronze.tribe_events AS
SELECT
  physical_topic AS source_topic,
  CASE
    WHEN physical_topic LIKE 'test.%' THEN 'test'
    WHEN physical_topic LIKE 'prod.%' THEN 'prod'
    ELSE 'unknown'
  END AS environment,
  regexp_extract(physical_topic, '^(?:test|prod)\\.tribe\\.([a-z0-9._-]+)\\.events$', 1) AS tribe_id,
  json_extract_scalar(raw_line, '$.eventType') AS event_type,
  json_extract_scalar(raw_line, '$.sourceServiceId') AS source_service_id,
  json_extract_scalar(raw_line, '$.metadata.schemaVersion') AS schema_version,
  json_extract_scalar(raw_line, '$.payload.occurredAt') AS occurred_at,
  raw_line AS raw_record,
  current_timestamp AS ingested_at,
  CASE
    WHEN json_extract_scalar(raw_line, '$.eventType') IS NULL THEN 'invalid'
    WHEN regexp_extract(physical_topic, '^(?:test|prod)\\.tribe\\.([a-z0-9._-]+)\\.events$', 1) = '' THEN 'invalid'
    ELSE 'valid'
  END AS quality_status,
  CASE
    WHEN json_extract_scalar(raw_line, '$.eventType') IS NULL THEN 'missing eventType'
    WHEN regexp_extract(physical_topic, '^(?:test|prod)\\.tribe\\.([a-z0-9._-]+)\\.events$', 1) = '' THEN 'invalid tribe topic'
    ELSE NULL
  END AS quality_error
FROM api_center_raw.topic_records
WHERE physical_topic LIKE 'test.tribe.%.events'
   OR physical_topic LIKE 'prod.tribe.%.events';
```

- [ ] **Step 2: Create Bronze validation query**

Create `api-center/infra/aws-data-pipeline/queries/validate-bronze-topic.sql`:

```sql
SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  event_type,
  quality_status,
  COUNT(*) AS bronze_record_count,
  MAX(occurred_at) AS latest_occurred_at
FROM bronze.tribe_events
WHERE source_topic = '${physical_topic}'
GROUP BY 1, 2, 3, 4, 5, 6;
```

- [ ] **Step 3: Validate Bronze preserves source service attribution**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-bronze-topic.sql `
  -Database bronze `
  -Workgroup $env:ATHENA_WORKGROUP `
  -OutputLocation $env:ATHENA_OUTPUT_LOCATION `
  -Profile apic `
  -Parameters @{ physical_topic = "test.tribe.codex-sdk-20260520041053.events" }
```

Expected:

```text
source_topic = test.tribe.codex-sdk-20260520041053.events
environment = test
tribe_id = codex-sdk-20260520041053
source_service_id = codex-sdk-20260520041053-api
quality_status = valid
```

- [ ] **Step 4: Update raw-to-bronze runbook with concrete DDL path**

Add:

```markdown
## Implementation Artifacts

- Raw catalog DDL: `infra/aws-data-pipeline/catalog/raw-topic-tables.sql`
- Bronze DDL: `infra/aws-data-pipeline/catalog/bronze-tribe-events.sql`
- Raw validation query: `infra/aws-data-pipeline/queries/validate-raw-topic.sql`
- Bronze validation query: `infra/aws-data-pipeline/queries/validate-bronze-topic.sql`
```

- [ ] **Step 5: Commit Phase 3**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline/catalog/bronze-tribe-events.sql infra/aws-data-pipeline/queries/validate-bronze-topic.sql docs/data-pipeline/raw-to-bronze-runbook.md
git commit -m "feat: add bronze tribe event layer"
```

---

## Phase 3A: Add Shared-Service And APICenter Ops Bronze Lanes

**Purpose:** Include APICenter-owned analytics without opening the lake to raw internal infrastructure topics.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/catalog/bronze-shared-service-events.sql`
- Create: `api-center/infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql`
- Create: `api-center/docs/data-pipeline/apicenter-operational-analytics-contract.md`
- Modify: `api-center/docs/data-pipeline/raw-to-bronze-runbook.md`

- [ ] **Step 1: Create shared-service Bronze DDL**

Create `api-center/infra/aws-data-pipeline/catalog/bronze-shared-service-events.sql`:

```sql
CREATE DATABASE IF NOT EXISTS bronze;

CREATE OR REPLACE VIEW bronze.shared_service_events AS
SELECT
  physical_topic AS source_topic,
  CASE
    WHEN physical_topic LIKE 'test.%' THEN 'test'
    WHEN physical_topic LIKE 'prod.%' THEN 'prod'
    ELSE 'unknown'
  END AS environment,
  regexp_extract(physical_topic, '^(?:test|prod)\\.api-center\\.shared\\.([a-z0-9._-]+)\\.events$', 1) AS shared_service_id,
  json_extract_scalar(raw_line, '$.eventType') AS event_type,
  json_extract_scalar(raw_line, '$.metadata.schemaVersion') AS schema_version,
  json_extract_scalar(raw_line, '$.payload.provider') AS provider,
  json_extract_scalar(raw_line, '$.payload.status') AS provider_status,
  json_extract_scalar(raw_line, '$.payload.occurredAt') AS occurred_at,
  raw_line AS raw_record,
  current_timestamp AS ingested_at,
  CASE
    WHEN json_extract_scalar(raw_line, '$.eventType') IS NULL THEN 'invalid'
    WHEN regexp_extract(physical_topic, '^(?:test|prod)\\.api-center\\.shared\\.([a-z0-9._-]+)\\.events$', 1) = '' THEN 'invalid'
    ELSE 'valid'
  END AS quality_status,
  CASE
    WHEN json_extract_scalar(raw_line, '$.eventType') IS NULL THEN 'missing eventType'
    WHEN regexp_extract(physical_topic, '^(?:test|prod)\\.api-center\\.shared\\.([a-z0-9._-]+)\\.events$', 1) = '' THEN 'invalid shared-service export topic'
    ELSE NULL
  END AS quality_error
FROM api_center_raw.topic_records
WHERE physical_topic LIKE 'test.api-center.shared.%.events'
   OR physical_topic LIKE 'prod.api-center.shared.%.events';
```

- [ ] **Step 2: Create APICenter ops Bronze DDL**

Create `api-center/infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql`:

```sql
CREATE DATABASE IF NOT EXISTS bronze;

CREATE OR REPLACE VIEW bronze.apicenter_ops_events AS
SELECT
  physical_topic AS source_topic,
  CASE
    WHEN physical_topic LIKE 'test.%' THEN 'test'
    WHEN physical_topic LIKE 'prod.%' THEN 'prod'
    ELSE 'unknown'
  END AS environment,
  regexp_extract(physical_topic, '^(?:test|prod)\\.api-center\\.ops\\.([a-z0-9._-]+)\\.events$', 1) AS ops_stream,
  json_extract_scalar(raw_line, '$.eventType') AS event_type,
  json_extract_scalar(raw_line, '$.metadata.schemaVersion') AS schema_version,
  json_extract_scalar(raw_line, '$.payload.status') AS status,
  json_extract_scalar(raw_line, '$.payload.latencyMs') AS latency_ms,
  json_extract_scalar(raw_line, '$.payload.occurredAt') AS occurred_at,
  raw_line AS raw_record,
  current_timestamp AS ingested_at,
  CASE
    WHEN json_extract_scalar(raw_line, '$.eventType') IS NULL THEN 'invalid'
    WHEN regexp_extract(physical_topic, '^(?:test|prod)\\.api-center\\.ops\\.([a-z0-9._-]+)\\.events$', 1) = '' THEN 'invalid'
    ELSE 'valid'
  END AS quality_status,
  CASE
    WHEN json_extract_scalar(raw_line, '$.eventType') IS NULL THEN 'missing eventType'
    WHEN regexp_extract(physical_topic, '^(?:test|prod)\\.api-center\\.ops\\.([a-z0-9._-]+)\\.events$', 1) = '' THEN 'invalid APICenter ops export topic'
    ELSE NULL
  END AS quality_error
FROM api_center_raw.topic_records
WHERE physical_topic LIKE 'test.api-center.ops.%.events'
   OR physical_topic LIKE 'prod.api-center.ops.%.events';
```

- [ ] **Step 3: Create APICenter operational analytics contract**

Create `api-center/docs/data-pipeline/apicenter-operational-analytics-contract.md`:

```markdown
# APICenter Operational Analytics Contract

APICenter operational analytics is required for platform visibility, but raw
internal infrastructure topics are not automatically eligible for S3 export.

## Approved Ops Streams

| Stream | Topic pattern | Purpose |
| --- | --- | --- |
| Gateway traffic | `<env>.api-center.ops.gateway-traffic.events` | Request counts, status classes, latency, source/target service IDs. |
| Auth events | `<env>.api-center.ops.auth-events.events` | Token issuance, refresh, denied auth attempts, without secrets or token bodies. |
| Policy decisions | `<env>.api-center.ops.policy-decisions.events` | Scope/consume decisions, allow/deny, reason code, target service. |
| Registry lifecycle | `<env>.api-center.ops.registry-lifecycle.events` | Registration, deprecation, retirement, activation state changes. |
| Kafka publish health | `<env>.api-center.ops.kafka-publish.events` | Governed publish accepted/failed, topic, event type, reason code. |
| S3 export health | `<env>.api-center.ops.s3-export-health.events` | Topic sink inclusion, object observation, Bronze observation, connector health. |

## Forbidden By Default

Do not export these directly:

```text
api-center.tribe.request
api-center.tribe.response
api-center.shared.request
api-center.shared.response
api-center.audit.log
api-center.registry.service-registered
api-center.registry.service-deregistered
__*
```

If one becomes necessary, create a sanitized `api-center.ops.<stream>.events`
producer with explicit schema, redaction, retention, and approval.

## Required Redaction

Ops events must not include:

- request bodies
- response bodies
- bearer tokens
- refresh tokens
- tribe secrets
- provider API keys
- payment card details
- OTP values
- raw PII unless explicitly approved and classified

## Required Envelope Fields

```text
eventType
payload.occurredAt
payload.status
payload.reasonCode
payload.sourceServiceId
payload.targetServiceId
payload.tribeId
payload.latencyMs
metadata.schemaVersion
metadata.classification
metadata.correlationId
```
```

- [ ] **Step 4: Update raw-to-bronze runbook with three Bronze lanes**

Add:

```markdown
## Bronze Lanes

The raw root feeds three approved Bronze lanes:

| Bronze view | Topic pattern |
| --- | --- |
| `bronze.tribe_events` | `<env>.tribe.<ownerTribeId>.events` |
| `bronze.shared_service_events` | `<env>.api-center.shared.<serviceId>.events` |
| `bronze.apicenter_ops_events` | `<env>.api-center.ops.<stream>.events` |

Internal APICenter request/response, audit, registry, and system topics are not
included unless they are converted into sanitized approved ops export streams.
```

- [ ] **Step 5: Commit Phase 3A**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline/catalog/bronze-shared-service-events.sql infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql docs/data-pipeline/apicenter-operational-analytics-contract.md docs/data-pipeline/raw-to-bronze-runbook.md
git commit -m "feat: add apicenter ops bronze lane"
```

---

## Phase 4: Build Common Silver Layer

**Purpose:** Provide a cross-tribe normalized event layer without encoding tribe business semantics.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/catalog/common-silver-events.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-common-silver.sql`
- Modify: `api-center/docs/data-pipeline/silver-gold-ownership-runbook.md`

- [ ] **Step 1: Create Common Silver DDL**

Create `api-center/infra/aws-data-pipeline/catalog/common-silver-events.sql`:

```sql
CREATE DATABASE IF NOT EXISTS common_silver;

CREATE OR REPLACE VIEW common_silver.tribe_event_envelope AS
SELECT
  source_topic,
  environment,
  tribe_id,
  source_service_id,
  event_type,
  schema_version,
  occurred_at,
  ingested_at,
  quality_status,
  quality_error,
  raw_record
FROM bronze.tribe_events
WHERE quality_status = 'valid';
```

- [ ] **Step 2: Create Common Silver validation query**

Create `api-center/infra/aws-data-pipeline/queries/validate-common-silver.sql`:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  COUNT(*) AS event_count,
  MAX(occurred_at) AS latest_occurred_at
FROM common_silver.tribe_event_envelope
WHERE source_topic = '${physical_topic}'
GROUP BY 1, 2, 3, 4;
```

- [ ] **Step 3: Verify test data does not enter prod views**

Run:

```sql
SELECT COUNT(*) AS test_records_in_prod_view
FROM common_silver.tribe_event_envelope
WHERE environment = 'prod'
  AND source_topic LIKE 'test.%';
```

Expected:

```text
test_records_in_prod_view = 0
```

- [ ] **Step 4: Update Silver/Gold ownership runbook**

Add:

```markdown
## Common Silver Boundary

`common_silver.tribe_event_envelope` is platform-owned. It normalizes the shared event envelope and preserves tribe payload as raw data. It must not define tribe-specific business metrics such as revenue, completion rate, enrollment status, or delivery SLA unless those metrics are explicitly promoted into approved Gold definitions.
```

- [ ] **Step 5: Commit Phase 4**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline/catalog/common-silver-events.sql infra/aws-data-pipeline/queries/validate-common-silver.sql docs/data-pipeline/silver-gold-ownership-runbook.md
git commit -m "feat: add common silver event layer"
```

---

## Phase 5: Build First Gold Pipeline Health Metrics

**Purpose:** Create a platform-owned Gold data product before tribe-specific business metrics, so operators can see whether the data pipeline itself is healthy.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/catalog/gold-platform-health.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/pipeline-health-daily.sql`
- Create: `api-center/docs/data-pipeline/metric-dictionary.md`

- [ ] **Step 1: Create Gold platform health DDL**

Create `api-center/infra/aws-data-pipeline/catalog/gold-platform-health.sql`:

```sql
CREATE DATABASE IF NOT EXISTS gold_platform;

CREATE OR REPLACE VIEW gold_platform.pipeline_health_daily AS
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  date(substr(coalesce(occurred_at, cast(ingested_at AS varchar)), 1, 10)) AS event_day,
  COUNT(*) AS event_count,
  MAX(occurred_at) AS latest_occurred_at,
  MAX(ingested_at) AS latest_ingested_at
FROM common_silver.tribe_event_envelope
GROUP BY 1, 2, 3, 4, 5;
```

- [ ] **Step 2: Create pipeline health query**

Create `api-center/infra/aws-data-pipeline/queries/pipeline-health-daily.sql`:

```sql
SELECT
  environment,
  tribe_id,
  source_service_id,
  event_type,
  event_day,
  event_count,
  latest_occurred_at,
  latest_ingested_at
FROM gold_platform.pipeline_health_daily
WHERE environment = '${environment}'
ORDER BY event_day DESC, tribe_id, source_service_id, event_type;
```

- [ ] **Step 3: Create metric dictionary**

Create `api-center/docs/data-pipeline/metric-dictionary.md`:

```markdown
# Data Pipeline Metric Dictionary

Gold metrics require an owner, formula, source tables, filters, and approval.

| Metric | Owner | Formula | Source | Required filters | Approval state |
| --- | --- | --- | --- | --- | --- |
| `event_count` | Platform data-platform owner | `COUNT(*)` grouped by environment, tribe, source service, event type, and day | `common_silver.tribe_event_envelope` | Production dashboards use `environment = 'prod'` | Draft |
| `latest_occurred_at` | Platform data-platform owner | `MAX(occurred_at)` | `common_silver.tribe_event_envelope` | Production dashboards use `environment = 'prod'` | Draft |
| `latest_ingested_at` | Platform data-platform owner | `MAX(ingested_at)` | `common_silver.tribe_event_envelope` | Production dashboards use `environment = 'prod'` | Draft |
```

- [ ] **Step 4: Validate Gold excludes test in prod dashboard mode**

Run:

```sql
SELECT COUNT(*) AS test_records
FROM gold_platform.pipeline_health_daily
WHERE environment = 'prod'
  AND tribe_id LIKE 'codex-sdk-%';
```

Expected:

```text
test_records = 0
```

- [ ] **Step 5: Commit Phase 5**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline/catalog/gold-platform-health.sql infra/aws-data-pipeline/queries/pipeline-health-daily.sql docs/data-pipeline/metric-dictionary.md
git commit -m "feat: add gold pipeline health metrics"
```

---

## Phase 6: Add Tribe Silver/Gold Templates

**Purpose:** Let tribes build their own curated models without creating separate raw pipelines.

**Files:**
- Create: `api-center/infra/aws-data-pipeline/catalog/tribe-silver-template.sql`
- Create: `api-center/infra/aws-data-pipeline/catalog/tribe-gold-template.sql`
- Modify: `api-center/docs/data-pipeline/silver-gold-ownership-runbook.md`

- [ ] **Step 1: Create tribe Silver template**

Create `api-center/infra/aws-data-pipeline/catalog/tribe-silver-template.sql`:

```sql
-- Replace <tribe_id> and <domain_event_type> after data classification and semantic approval.
CREATE DATABASE IF NOT EXISTS silver_<tribe_id>;

CREATE OR REPLACE VIEW silver_<tribe_id>.<domain_event_type> AS
SELECT
  tribe_id,
  source_service_id,
  event_type,
  occurred_at,
  ingested_at,
  raw_record
FROM common_silver.tribe_event_envelope
WHERE environment = 'prod'
  AND tribe_id = '<tribe_id>'
  AND event_type = '<domain_event_type>';
```

- [ ] **Step 2: Create tribe Gold template**

Create `api-center/infra/aws-data-pipeline/catalog/tribe-gold-template.sql`:

```sql
-- Replace <tribe_id>, <metric_name>, and grouping logic after Production Metrics Approval.
CREATE DATABASE IF NOT EXISTS gold_<tribe_id>;

CREATE OR REPLACE VIEW gold_<tribe_id>.<metric_name> AS
SELECT
  date(substr(coalesce(occurred_at, cast(ingested_at AS varchar)), 1, 10)) AS metric_day,
  COUNT(*) AS event_count
FROM silver_<tribe_id>.<domain_event_type>
GROUP BY 1;
```

- [ ] **Step 3: Add approval requirement to runbook**

Add:

```markdown
## Tribe Template Promotion

The template files under `infra/aws-data-pipeline/catalog/` are not production objects by themselves. A tribe-specific Silver or Gold object becomes production-ready only after the event owner signs off on event semantics, the data steward approves classification and retention, and the metric dictionary records formula, filters, owner, and approved readers.
```

- [ ] **Step 4: Commit Phase 6**

Run:

```powershell
cd C:\Codes\apic\api-center
git add infra/aws-data-pipeline/catalog/tribe-silver-template.sql infra/aws-data-pipeline/catalog/tribe-gold-template.sql docs/data-pipeline/silver-gold-ownership-runbook.md
git commit -m "docs: add tribe silver gold templates"
```

---

## Phase 7: Integrate Topic-State Evidence

**Purpose:** Make management state reflect S3/Bronze/curated progress instead of stopping at topic/S3 sink inclusion.

**Files:**
- Modify: `apicenter-management/src/lib/service-onboarding.ts`
- Modify: `apicenter-management/src/lib/service-onboarding.test.ts`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.test.tsx`

- [ ] **Step 1: Extend topic-state evidence model**

Add fields if missing:

```ts
latestS3ObjectKey?: string;
latestS3ObjectAt?: string;
latestBronzeObservedAt?: string;
latestBronzeCount?: number;
latestCommonSilverObservedAt?: string;
latestGoldObservedAt?: string;
qualityErrorCount?: number;
```

- [ ] **Step 2: Add state derivation tests**

Add test cases:

```ts
expect(
  deriveTribeS3OnboardingState({
    classificationApproved: true,
    hasScope: true,
    topicExists: true,
    s3SinkIncludesTopic: true,
    latestAcceptedPublishAt: "2026-05-20T00:00:00.000Z",
    latestS3ObjectAt: "2026-05-20T00:05:00.000Z",
  }),
).toBe("Raw observed");

expect(
  deriveTribeS3OnboardingState({
    classificationApproved: true,
    hasScope: true,
    topicExists: true,
    s3SinkIncludesTopic: true,
    latestAcceptedPublishAt: "2026-05-20T00:00:00.000Z",
    latestS3ObjectAt: "2026-05-20T00:05:00.000Z",
    latestBronzeObservedAt: "2026-05-20T00:10:00.000Z",
    latestBronzeCount: 1,
  }),
).toBe("Bronze cataloged");
```

- [ ] **Step 3: Surface Bronze/Common Silver evidence in UI**

Show:

```text
Latest S3 object
Latest Bronze count
Latest Bronze observed at
Quality error count
Common Silver observed
Gold approval state
```

- [ ] **Step 4: Run management tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- service-onboarding.test.ts tribe-onboarding-flow.test.tsx
```

Expected:

```text
Tests pass and state labels match Raw observed / Bronze cataloged / Curated active.
```

- [ ] **Step 5: Commit Phase 7**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git add src/lib/service-onboarding.ts src/lib/service-onboarding.test.ts src/components/tribe-onboarding-flow.tsx src/components/tribe-onboarding-flow.test.tsx
git commit -m "feat: surface data pipeline evidence in onboarding state"
```

---

## Phase 8: Build First Visualization Surface

**Purpose:** Put the first useful data product in front of operators without giving BI users raw S3 access.

**Decision Gate:** Choose one first visualization surface:

| Option | Use When | Tradeoff |
| --- | --- | --- |
| Management console panel | Need operator visibility first | Fastest in current repo; not a full BI tool. |
| PowerBI over Athena/curated exports | Need business stakeholders | Requires BI workspace/access setup. |
| QuickSight over Athena | Want AWS-native dashboarding | Adds AWS BI cost/config. |
| Databricks SQL dashboard | Databricks is approved production platform | Do not use Free Edition as production. |

Recommended first slice:

```text
Management console pipeline-health panel backed by Gold query output or manually imported evidence.
```

**Files if management console is chosen:**
- Create: `apicenter-management/src/components/data-pipeline-health-panel.tsx`
- Create: `apicenter-management/src/components/data-pipeline-health-panel.test.tsx`
- Modify: `apicenter-management/src/app/tribes/[serviceId]/page.tsx` or the active tribe detail page component

- [ ] **Step 1: Define dashboard data shape**

Use:

```ts
type PipelineHealthRow = {
  environment: "test" | "prod";
  tribeId: string;
  sourceServiceId?: string;
  eventType: string;
  eventDay: string;
  eventCount: number;
  latestOccurredAt?: string;
  latestIngestedAt?: string;
};
```

- [ ] **Step 2: Add component tests**

Test these states:

```text
loading
no data
test-only warning
prod rows visible
stale latest_ingested_at warning
```

- [ ] **Step 3: Implement panel**

The panel must show:

```text
environment
tribe
source service
event type
daily count
latest event time
latest ingestion time
freshness status
```

- [ ] **Step 4: Commit Phase 8**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
git add src/components/data-pipeline-health-panel.tsx src/components/data-pipeline-health-panel.test.tsx
git commit -m "feat: add data pipeline health panel"
```

---

## Phase 9: Operations, Cost, And Access Controls

**Purpose:** Keep the pipeline affordable and governed before expanding to many tribes.

**Files:**
- Modify: `api-center/docs/data-pipeline/retention-access-cost-controls.md`
- Modify: `api-center/docs/production-costing.md`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`

- [ ] **Step 1: Add Athena workgroup guardrails**

Document:

```text
workgroup:
bytes_scanned_limit:
query_result_location:
query_result_retention_days:
owner:
alert_threshold:
```

- [ ] **Step 2: Add S3 lifecycle policy target**

Document:

```text
raw_test_retention_days: 30-90
raw_prod_retention_days: 180-365
bronze_retention_days: 365
curated_retention_days: metric-specific
```

- [ ] **Step 3: Add access control table**

Use:

```text
Raw S3: platform data operators only
Bronze: platform data operators and controlled jobs
Common Silver: approved tenant-filtered readers
Tribe Silver: owning tribe plus platform data operators
Gold: approved BI groups
```

- [ ] **Step 4: Commit Phase 9**

Run:

```powershell
cd C:\Codes\apic\api-center
git add docs/data-pipeline/retention-access-cost-controls.md docs/production-costing.md docs/data-pipeline/actual-pipeline-runbook.md
git commit -m "docs: add data pipeline guardrails"
```

---

## Phase 10: Pilot And Go-Live

**Purpose:** Prove one test topic end to end, then one production topic, before onboarding more tribes.

**Pilot sequence:**

1. Test topic: `test.tribe.<pilotTribe>.events`
2. Smoke event accepted by APICenter.
3. S3 object observed.
4. Raw Athena query returns count.
5. Bronze query returns valid row with `source_service_id`.
6. Common Silver query returns row.
7. Gold pipeline health query returns row.
8. Management evidence state advances to `Bronze cataloged`.
9. Production topic repeats the same checks.
10. Production dashboard reads only `environment = 'prod'`.

**Go-live checklist:**

- [ ] AWS profile/role can read raw bucket and run Athena.
- [ ] Raw S3 object exists for pilot test topic.
- [ ] Raw Athena query sees pilot test topic.
- [ ] Bronze query derives environment, tribe, source service, and event type.
- [ ] Common Silver excludes malformed records.
- [ ] Gold pipeline health excludes test from prod dashboard mode.
- [ ] Management state records S3 and Bronze evidence.
- [ ] Metric dictionary has owner and formula for every Gold field.
- [ ] Retention and access controls are documented.
- [ ] Late-provisioned tribe path is tested with a second topic or simulated topic-state record.

**Rollback:**

| Failure | Rollback |
| --- | --- |
| Athena table DDL wrong | Drop/recreate only catalog/view objects; raw S3 remains unchanged. |
| Bronze logic bad | Replace Bronze view; do not delete raw data. |
| Common Silver leaks test into prod | Disable dashboard refresh and repair `environment = 'prod'` filters. |
| Gold metric formula wrong | Mark metric unapproved in metric dictionary and remove from dashboard. |
| Costs spike | Pause broad queries, lower workgroup scan limits, and restrict BI refresh. |
| Topic emits PII unexpectedly | Move topic to `Needs remediation`; disable curated promotion; keep raw access platform-only. |

---

## Known Blockers And Risks

- AWS validation access may still need local credential setup before S3/Athena checks can run.
- The exact Confluent S3 object format must be confirmed from a real object before finalizing DDL.
- Athena partition strategy depends on actual S3 folder layout.
- Databricks production choice is not made; this plan does not require it for the first pipeline.
- BI surface is not chosen; management-console health panel is the recommended first operator slice.
- Test topics must never leak into prod Gold or BI outputs.
- Raw S3 access must stay platform-only.
- Late-provisioned topics must be discovered through metadata refresh/config, not hardcoded topic lists.

## Completion Criteria

- S3 object arrival is validated for at least one test tribe topic.
- Raw Glue/Athena catalog can query the physical topic.
- Bronze derives `environment`, `tribe_id`, `source_service_id`, `event_type`, and quality fields.
- Bronze has separate approved lanes for tribe events, shared-service exports, and APICenter operational analytics.
- Common Silver exposes only valid normalized envelope records.
- APICenter internal/control topics remain excluded unless converted to sanitized `api-center.ops.<stream>.events` exports.
- First Gold pipeline-health data product exists and filters test/prod correctly.
- Management state can record `Raw observed` and `Bronze cataloged` evidence.
- Runbook documents operator commands, evidence fields, rollback, cost controls, and access controls.
- A pilot topic reaches `Bronze cataloged` with evidence.
- Production dashboard or BI mode reads curated data only.
