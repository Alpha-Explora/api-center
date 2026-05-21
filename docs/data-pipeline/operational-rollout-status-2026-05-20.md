# APICenter Data Pipeline Operational Rollout Status, 2026-05-20

## Scope

Environment: `test`

This records the operational validation after the cleanup implementation plan
was completed. It intentionally does not mark production ready.

## Completed Locally

- Dedicated Athena results defaults now resolve to
  `s3://api-center-athena-results/athena-results/...`.
- `provision-athena-results-controls.ps1 -DryRun` emits the expected test
  bucket, lifecycle, and workgroup plan.
- `apply-athena-catalog.ps1 -DryRun` now resolves catalog output to
  `api-center-athena-results`, not the raw bucket.
- Active data-pipeline runbooks no longer use
  `s3://api-center-raw-data/athena-results/` as the managed result location.
- Lifecycle policy parses and uses:
  - platform validation: 7 days
  - management: 14 days
  - tribe results: 30 days
  - legacy unclassified: 14 days

## Live AWS Validation

Profiles:

```text
codex-apic-base -> arn:aws:iam::688717565427:user/codex-apic-cli
apic -> arn:aws:sts::688717565427:assumed-role/APICenterDataPipelineValidator/...
```

Read-only S3 raw topic validation succeeded:

```text
bucket: api-center-raw-data
physical_topic: test.tribe.codex-sdk-20260520041053.events
object_count_returned: 2
latest_key: topics/test.tribe.codex-sdk-20260520041053.events/year=2026/month=05/day=20/hour=09/test.tribe.codex-sdk-20260520041053.events+0+0000000001.json
latest_object_at: 2026-05-20T09:41:51+00:00
```

## Blockers

Resolved during the second rollout pass:

```text
api-center-athena-results bucket created
api-center-platform-validation workgroup created
api-center-management workgroup created
api-center-tribe-codex-sdk-20260520041053 workgroup created
catalog DDL apply completed through api-center-platform-validation
```

Permission cleanup completed:

```text
validator_policy_reapplied_at: 2026-05-20T15:24:09Z
operator_profile: apic-admi
operator_identity: arn:aws:iam::688717565427:user/apic-admin
runtime_policy_name: APICenterDataPipelineValidatorRuntime
runtime_policy_source: infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json
```

The runtime policy was updated to include exact and wildcard result-bucket list
prefixes:

```text
s3:prefix:
  - athena-results
  - athena-results/
  - athena-results/*
```

Result layout validation now succeeds through the validator profile:

```text
command: .\scripts\data-pipeline\validate-athena-results-layout.ps1 -Bucket api-center-athena-results -Profile apic
status: succeeded
scanned: 19
unclassified_count: 0
```

The temporary provisioning policy was removed from
`APICenterDataPipelineValidator`:

```text
temporary_policy_removed_at: 2026-05-20T15:24:09Z
temporary_policy_name: APICenterAthenaResultsProvisionerTemporary
```

The expected negative provisioning check now fails for the validator profile:

```text
command: .\scripts\data-pipeline\provision-athena-results-controls.ps1 -Environment test -TribeId codex-sdk-20260520041053 -Profile apic -Apply
status: denied as expected
denied_action: s3:CreateBucket
denied_resource: arn:aws:s3:::api-center-athena-results
```

Current validator inline policies after cleanup:

```text
APICenterDataPipelineValidationAccess
APICenterDataPipelineValidatorRuntime
```

`APICenterDataPipelineValidationAccess` is an older catalog/validation policy
that still exists for catalog apply compatibility. Tightening or replacing it is
part of the environment-specific workgroup and access hardening work.

## Provisioning Evidence

```text
provision_apply:
  bucket: api-center-athena-results
  workgroups:
    - api-center-platform-validation
    - api-center-management
    - api-center-tribe-codex-sdk-20260520041053
  output_prefixes:
    - s3://api-center-athena-results/athena-results/platform/validation/test/
    - s3://api-center-athena-results/athena-results/management/test/
    - s3://api-center-athena-results/athena-results/tribe/codex-sdk-20260520041053/test/
  bytes_scanned_cutoff_bytes: 1073741824
```

## Environment-Specific Workgroup Evidence

Phase 1 created the test-specific Athena workgroups and left prod workgroups
planned but unapplied until production approval.

```text
workgroup_split_applied_at: 2026-05-20T15:30:13Z
operator_profile: apic-admi
operator_identity: arn:aws:iam::688717565427:user/apic-admin
environment: test
created_or_verified_workgroups:
  - api-center-platform-validation-test
  - api-center-management-test
  - api-center-tribe-codex-sdk-20260520041053-test
bytes_scanned_cutoff_bytes: 1073741824
```

The validator profile can read the new test workgroups:

```text
api-center-platform-validation-test:
  output_location: s3://api-center-athena-results/athena-results/platform/validation/test/
api-center-management-test:
  output_location: s3://api-center-athena-results/athena-results/management/test/
api-center-tribe-codex-sdk-20260520041053-test:
  output_location: s3://api-center-athena-results/athena-results/tribe/codex-sdk-20260520041053/test/
```

A bounded raw validation query succeeded through the new platform validation
test workgroup:

```text
query_execution_id: ffacd7cb-e1ca-4f75-a550-7db07db6c417
workgroup: api-center-platform-validation-test
output_location: s3://api-center-athena-results/athena-results/platform/validation/test/ffacd7cb-e1ca-4f75-a550-7db07db6c417.csv
physical_topic: test.tribe.codex-sdk-20260520041053.events
year: 2026
month: 05
day: 20
hour: 09
raw_record_count: 1000
```

## Live Pipeline Health Provider Evidence

Phase 2 added the APICenter curated health endpoint and management
`api-center` provider path.

```text
endpoint: GET /api/v1/data-pipeline/health?environment=test
api_center_source_modes:
  - PIPELINE_HEALTH_SOURCE=fixture
  - PIPELINE_HEALTH_SOURCE=athena
management_provider_modes:
  - PIPELINE_HEALTH_PROVIDER=local-file
  - PIPELINE_HEALTH_PROVIDER=api-center
```

A live APICenter service check read Gold health through Athena with bounded
test partitions:

```text
command: npx ts-node -e <PipelineHealthService athena check>
status: succeeded
workgroup: api-center-platform-validation-test
environment: test
year: 2026
month: 05
day: 20
tribe_id: codex-sdk-20260520041053
source_service_id: codex-sdk-20260520041053-api
event_type: codex.pipeline.flush
event_count: 1000
athena_result_location: s3://api-center-athena-results/athena-results/platform/validation/test/e7690f0c-c2f4-46c5-b22b-49659ebd1ece.csv
checked_at: 2026-05-20T15:41:33Z
```

Verification:

```text
api-center: npm test -- src/data-pipeline/pipeline-health.service.spec.ts --runInBand
api-center: npm run typecheck
apicenter-management: npm test -- src/lib/server/pipeline-health-provider.test.ts src/app/api/local/data-pipeline/health/route.test.ts
apicenter-management: npx tsc --noEmit
```

## APICenter Ops Bronze Alignment Evidence

Phase 3 aligned `bronze.apicenter_ops_events` with the current projected
APICenter control-plane topic names.

Current supported examples:

```text
test.api-center.audit.log
test.api-center.auth.token-issued
test.api-center.gateway.request
test.api-center.registry.service-registered
test.api-center.tribe.request
```

Operational telemetry rows without an `eventType` now use `ops_stream` as the
event type. The view also reads status, latency, and occurrence time from the
actual APICenter telemetry fields such as `statusCode`, `durationMs`,
`_meta.timestamp`, and `timestamp`.

Latest catalog apply through the test platform validation workgroup succeeded:

```text
workgroup: api-center-platform-validation-test
latest_catalog_query_ids:
  - b8737207-5eff-4555-a7b2-f8ce9f517c19
  - b0456251-a4dd-43c9-9125-f52177ac63f3
  - 2072f6b2-c605-42fb-861e-1eec58131c17
  - 263a0bc6-291f-4952-b1bc-5613319298f9
  - da1b4764-097f-4630-a2d1-003f3fe8f31e
  - 60927183-c28f-4d25-85f8-29ba743f770a
  - 88344070-943a-4569-b4af-9d593f152433
  - 8e913146-76b5-4364-b7b6-fb5fae0b149c
  - 9ef9a32f-7bfd-4856-b713-9a4e5a912d28
  - 8eb22c91-fbc1-4284-ac29-29cfee00f673
  - 7354d4e6-ec2b-4166-aee9-2a6ede8c7098
  - d1102cd0-3b00-4801-adc8-c9da373d776e
  - d051048e-cae8-4c0f-9440-69eaef62e32d
```

Bounded ops validation:

```text
query_execution_id: d1cd8b13-fdbe-47da-91da-febc5cc24194
environment: test
year: 2026
month: 05
day: 20
rows:
  - source_topic: test.api-center.audit.log
    ops_stream: audit.log
    event_type: audit.log
    quality_status: valid
    event_count: 260
  - source_topic: test.api-center.auth.token-issued
    ops_stream: auth.token-issued
    event_type: auth.token-issued
    quality_status: valid
    event_count: 90
```

## Shared-Service Silver And Gold Evidence

Phase 4 updated `bronze.shared_service_events` for the current sanitized
shared-service export payload shape and added:

```text
common_silver.shared_service_event_envelope
gold_platform.shared_service_usage_daily
gold_platform.shared_service_provider_health_daily
```

The test catalog apply succeeded through the environment-specific platform
validation workgroup:

```text
workgroup: api-center-platform-validation-test
phase_4_catalog_query_ids:
  - 859d1a43-abbb-424a-a8d4-80e0d15a413e
  - be16f147-336b-435d-8759-557d67525e45
  - 913ae40c-91bf-493f-8379-8e1a0838690b
  - 919d49a0-1421-4442-92be-f423b0b4c4dc
  - a70ed2cd-7930-42e9-950a-9a8b9da3e8f3
  - f600de44-382d-42c4-bd81-c3107f7e6fcb
  - 1a539a00-42c4-4145-8cec-61d4eed6e7af
  - d57d047a-e793-4143-a8dd-e5400a5d6748
  - 6bff31d7-3681-4396-bfd2-a2d41df34b3c
  - 227f0820-7eb1-4c01-8f9a-cd20a01a9be2
  - 5c6c557e-6ed9-4959-889f-262f692be189
  - 444a2668-4f43-4fb4-bb8a-fcf35a3d69e4
  - e044f8a9-b144-4256-91bf-d90c65cfccb9
  - a25d30e3-d50b-4bd2-84a7-fdba77f4a0ca
  - 393b6f91-08a6-47cd-93c5-b55ffe01c416
  - c38afd49-44bc-49be-a16a-d10990e1064c
  - 3e372ba1-81b3-449d-b8c9-12515cda1ed9
```

Bounded shared-service validation used the existing test shared-service event
day because those records landed on 2026-05-16:

```text
command: .\scripts\data-pipeline\run-athena-query.ps1 -QueryFile .\infra\aws-data-pipeline\queries\validate-shared-service-usage.sql -Database api_center_raw -Workgroup api-center-platform-validation-test -Profile apic -Environment test -ResultPurpose platform-validation -Parameters @{ environment = "test"; year = "2026"; month = "05"; day = "16" } -Wait
usage_query_execution_id: e9f125de-1311-4e16-a65b-1aa9e8c6b0f7
provider_health_query_execution_id: 8126a6de-ea04-4735-a620-69d7d331f11a
```

Usage rows showed tribe-attributed shared-service consumption:

```text
email: smoke-tribe=1, smurf-village=2
gauth: smoke-tribe=1
geo: smoke-tribe=1
otp: smoke-tribe=1
payment: smoke-tribe=21
sms: smoke-tribe=1
```

Provider-health rows showed all six shared services at `success_rate = 1.0`
for the bounded test window.

## Topic Projection Drift Automation Evidence

Phase 5 added an offline and optional-live projection drift gate:

```text
script: scripts/data-pipeline/check-topic-projection-drift.ps1
ci_script: npm run check:data-pipeline-projection
core_helper: scripts/data-pipeline/resolve-athena-topic-projection.js --check
```

The gate validates:

```text
topic-projection-values.txt is sorted and unique
expected physical topics exist in projection values
raw-topic-tables.sql projection enum matches generated values
onboarding-state physical_topic entries exist in projection values when a state file is present
Confluent connector or Kafka REST topics exist in projection values when credentials are present
```

Offline CI validation passed:

```text
command: npm run check:data-pipeline-projection
status: succeeded
topic_count: 31
errors: 0
```

Expected-topic validation passed for an existing test topic:

```text
command: .\scripts\data-pipeline\check-topic-projection-drift.ps1 -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt -ExpectedTopic test.tribe.logistics.events -SkipConfluent
status: succeeded
topic_count: 31
```

Negative validation fails clearly for a missing expected topic:

```text
command: .\scripts\data-pipeline\check-topic-projection-drift.ps1 -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt -ExpectedTopic test.tribe.not-yet-onboarded.events -SkipConfluent
status: failed as expected
error: Expected topic is missing from projection values: test.tribe.not-yet-onboarded.events
```

## Event Schema Governance Evidence

Phase 6 added APICenter event schema governance at the governed Kafka publish
boundary.

Implemented local surfaces:

```text
service: src/data-pipeline/event-schema-registry.service.ts
controller: GET /api/v1/data-pipeline/event-schemas?environment=test&tribeId=<tribe_id>
catalog: infra/aws-data-pipeline/catalog/event-schema-registry.sql
publish boundary: src/kafka-governance/kafka-governance.service.ts
publish dto: src/kafka-governance/dto/kafka-publish-message.dto.ts
```

Runtime configuration:

```text
EVENT_SCHEMA_REGISTRY_FILE=<path-to-json-registry>
EVENT_SCHEMA_REGISTRY_VERSION=<human-readable-version>
EVENT_SCHEMA_TEST_DISCOVERY_ENABLED=true|false
```

Publish behavior:

```text
test known approved schema: accepted as approved
test unknown schema: accepted as test_discovery only when discovery policy allows it
prod unknown schema: rejected before Kafka publish
prod pending/draft/deprecated/rejected schema: rejected before Kafka publish
```

Governance evidence now written into accepted Kafka events:

```text
governance.eventSchemaVersion
governance.schemaValidationStatus
governance.schemaRegistryVersion
governance.schemaValidationError
```

Bronze/Common Silver evidence fields:

```text
schema_version
schema_validation_status
schema_registry_version
schema_validation_error
```

Local verification completed during implementation:

```text
api-center: npm test -- src/data-pipeline/event-schema-registry.service.spec.ts --runInBand
api-center: npm test -- src/data-pipeline/event-schema-registry.controller.spec.ts --runInBand
api-center: npm test -- src/kafka-governance/kafka-governance.service.spec.ts --runInBand
api-center: npm test -- src/data-pipeline/event-schema-registry.service.spec.ts src/data-pipeline/event-schema-registry.controller.spec.ts src/kafka-governance/kafka-governance.service.spec.ts --runInBand
api-center: npm run typecheck
api-center: npx eslint <Phase 6 touched TypeScript files>
api-center: .\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment test -Workgroup api-center-platform-validation-test -DryRun
```

Live Athena catalog apply for `event-schema-registry.sql` is not yet recorded in
this status file. Apply it through the test platform validation workgroup before
using Athena as the registry evidence source.

## Tribe Silver/Gold Factory Evidence

Phase 7 added the repeatable Tribe Silver/Gold dry-run factory.

Implemented local surfaces:

```text
operator_wrapper: scripts/data-pipeline/generate-tribe-curated-sql.ps1
generator_helper: scripts/data-pipeline/generate-tribe-curated-sql.js
silver_template: infra/aws-data-pipeline/catalog/tribe-silver-template.sql
gold_template: infra/aws-data-pipeline/catalog/tribe-gold-template.sql
runbook: docs/data-pipeline/tribe-curated-data-product-runbook.md
governance_checklist: docs/data-pipeline/tribe-data-governance-checklist.md
metric_dictionary: docs/data-pipeline/metric-dictionary.md
```

Pilot test dry-run:

```text
command: .\scripts\data-pipeline\generate-tribe-curated-sql.ps1 -TribeId codex-sdk-20260520041053 -Environment test -EventType codex.pipeline.flush -MetricName pipeline_flush_daily -Owner api-center-platform -Steward api-center-data-steward -ApprovedReaderGroup api-center-platform-validation-readers -Year 2026 -Month 05 -Day 20 -DryRun
status: succeeded
silver_view: silver_codex_sdk_20260520041053.codex_pipeline_flush
gold_view: gold_codex_sdk_20260520041053.pipeline_flush_daily
source_common_silver_view: common_silver.tribe_event_envelope
```

The generated validation SQL filters:

```text
environment = 'test'
tribe_id = 'codex-sdk-20260520041053'
event_type = 'codex.pipeline.flush'
year = '2026'
month = '05'
day = '20'
```

Live Athena apply is not part of this slice. Generated SQL must be reviewed and
applied through the approved Athena workflow after schema, steward, metric, and
reader-group approvals are recorded.

## Production Pilot Gate Preflight

Phase 8 has a repo-local logistics production pilot approval record. Confluent
topic/S3 Sink promotion and prod Athena catalog refresh are complete. The
remaining live blocker is the APICenter prod smoke publish boundary.

Added preflight surfaces:

```text
approval_template: docs/data-pipeline/production-pilot-approval-template.json
approval_record: docs/data-pipeline/production-pilot-approval-logistics.json
checker: scripts/data-pipeline/check-production-pilot-approval.js
operator_wrapper: scripts/data-pipeline/check-production-pilot-approval.ps1
projection_promoter: scripts/data-pipeline/promote-production-pilot-projection.ps1
test: src/data-pipeline/check-production-pilot-approval.spec.ts
test: src/data-pipeline/promote-production-pilot-projection.spec.ts
```

The preflight validates the required Phase 8 approval fields:

```text
approved_prod_physical_topic
owner_tribe_id
source_service_ids
data_owner
data_steward
approved_reader_groups
metric_dictionary_rows_approved
raw_prod_retention_days
athena_workgroup
bytes_scanned_limit
operator
approval_timestamp
```

It also blocks the temporary SDK smoke tribe from being used as the prod pilot
unless the approval record explicitly sets:

```text
temporary_sdk_prod_approval: true
```

Local projection promotion:

```text
approved_topic: prod.tribe.logistics.events
topics_file: infra/aws-data-pipeline/topic-projection-values.txt
raw_topic_tables_sql: infra/aws-data-pipeline/catalog/raw-topic-tables.sql
status: prod logistics topic added to local Athena projection files
```

Live Confluent prod topic/S3 Sink promotion:

```text
operator_script: scripts/data-pipeline/ensure-confluent-topic-and-sink.ps1
env_file: ../apicenter-management/.env.live
topic: prod.tribe.logistics.events
connector: api-center-prod-s3-sink
dry_run_before_apply:
  topic_exists: false
  s3_sink_includes_topic: false
  connector_topic_count: 31
apply_status:
  topic_exists: true
  topic_created: true
  s3_sink_includes_topic: true
  s3_sink_updated: true
  connector_topic_count: 32
```

Live projection drift reconciliation found that the prod S3 Sink already
managed 31 additional prod topics that were not in the Athena projection. The
projection and raw topic DDL now include all live prod connector topics.

```text
command: .\scripts\data-pipeline\check-topic-projection-drift.ps1 -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt -ExpectedTopic prod.tribe.logistics.events -EnvFile ..\apicenter-management\.env.live
status: passed
topic_count: 63
errors: []
warnings: []
```

Template negative preflight:

```text
command: .\scripts\data-pipeline\check-production-pilot-approval.ps1 -ApprovalFile .\docs\data-pipeline\production-pilot-approval-template.json
status: failed as expected
reason: unresolved template placeholders
```

Approved logistics preflight:

```text
command: .\scripts\data-pipeline\check-production-pilot-approval.ps1 -ApprovalFile .\docs\data-pipeline\production-pilot-approval-logistics.json
status: passed
errors: []
warnings: []
```

Projection promotion:

```text
command: .\scripts\data-pipeline\promote-production-pilot-projection.ps1 -ApprovalFile .\docs\data-pipeline\production-pilot-approval-logistics.json
status: passed
approved_topic: prod.tribe.logistics.events
topic_count: 32
note: original approval-only promotion count before live connector reconciliation
```

Prod Athena result controls:

```text
command: .\scripts\data-pipeline\provision-athena-results-controls.ps1 -Environment prod -TribeId logistics -Profile apic-admi -Apply
status: passed
created_workgroups:
  - api-center-platform-validation-prod
  - api-center-management-prod
  - api-center-tribe-logistics-prod
result_bucket: api-center-athena-results
region: ap-southeast-2
```

Validator policy fix:

```text
policy_file: infra/aws-data-pipeline/policies/data-pipeline-validator-role-policy.json
role: APICenterDataPipelineValidator
policy_name: APICenterDataPipelineValidatorPolicy
reason: event-schema-registry.sql creates the governance Glue database before cataloging approved schemas
fix: allowed validation DDL for api_center_raw and governance Glue databases/tables
note: AWS CLI cached assume-role credentials were cleared so the apic profile picked up the updated policy
```

Prod catalog apply:

```text
command: .\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment prod -Workgroup api-center-platform-validation-prod -Profile apic -Wait
status: refreshed after live connector projection sync
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

Prod schema-governed smoke and validation:

```text
operator_script: scripts/data-pipeline/run-prod-logistics-smoke.js
confluent_inspector: scripts/data-pipeline/inspect-confluent-s3-sink.js
tribe_secret_name: api-center-tribe-secret-logistics
schema_registry_file: config/event-schema-registry.json
schema_registry_version: apicenter-event-schemas-2026-05-21
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-schema-fix-d1eb7e6-202605211822
cloud_build_ids:
  failed_startup_image: a9bcfd37-b1a4-4b15-9213-65f274353c47
  corrected_image: b7908e85-1f2d-48ee-bd61-a909e42c9626
root_cause_fixed: deployed stale API rejected schemaVersion; first replacement image exposed PipelineHealthService DI issue; corrected image rolled out successfully
single_smoke_id: prod-logistics-smoke-20260520183309
single_publish_status: accepted=true, schema_validation_status=approved
s3_sink_flush_size: 1000
batch_smoke_id: prod-logistics-smoke-20260520183710
batch_publish_count: 1000
batch_publish_status: accepted=true, schema_validation_status=approved
secret_cache_note: token retry was required after rotation while API pods refreshed cached tribe secret hashes
```

Prod S3 and Athena validation:

```text
s3_validation_command: .\scripts\data-pipeline\validate-s3-prefix.ps1 -Bucket api-center-raw-data -PhysicalTopic prod.tribe.logistics.events -Profile apic
s3_object_count_returned: 1
latest_s3_object_key: topics/prod.tribe.logistics.events/year=2026/month=05/day=20/hour=18/prod.tribe.logistics.events+0+0000000000.json
latest_s3_object_at: 2026-05-20T18:41:05+00:00

raw_query_id: 40da3dfc-0674-4c65-aac0-f54fb378b613
raw_record_count: 1000

quality_query_id: a560149c-5e15-4164-bc83-e3e426ce2697
invalid_quality_count: 0
missing_tribe_id_count: 0
missing_source_service_id_count: 0
unexpected_environment_count: 0
checked_record_count: 1000

common_silver_query_id: 42f0c628-f1e0-493b-bccd-ef8c455cc203
common_silver_environment: prod
common_silver_tribe_id: logistics
common_silver_source_service_id: logistics-orders
common_silver_event_type: order.created
common_silver_event_count: 1000

gold_query_id: 93965804-1563-490b-b421-8f898230e849
gold_environment: prod
gold_tribe_id: logistics
gold_source_service_id: logistics-orders
gold_event_type: order.created
gold_event_day: 2026-05-20
gold_event_count: 1000
gold_latest_ingested_at: 2026-05-20 18:42:02.167 UTC

leak_guard_query_id: 1bf40983-7643-4e79-b569-a3077bb4d8bb
leaked_environment_count: 0
leak_guard_checked_record_count: 1000
```

## Athena Catalog Apply Evidence

All catalog DDL statements completed with `SUCCEEDED` and wrote to
`s3://api-center-athena-results/athena-results/platform/validation/test/`.

```text
0969b9a5-436b-4083-9f79-9d8e1170930f
09bf3cd8-270e-4156-b96b-35da81efd0ae
7cff5964-8d8d-4b02-9941-944ed5f6bbd5
464c69c9-79a9-4442-b33b-450ccc1e5b50
a0d85e9d-baf0-48e4-bfaf-9b2015c3d684
dd4adfbc-ad1b-4b14-84f6-edcf9973e42f
ee72e6ff-c536-4868-bca6-13fd30cb3866
8d22fe28-1eaa-4c80-a0c2-6bd263ea7326
dadccbbb-d63c-44ba-a853-5d4f37606f5d
4c579beb-e686-4c6f-b7b9-b0b5db5902c8
5b45feb6-4f0a-438d-9321-53e5172af814
26bdf582-8342-4738-8c39-f2b7f35562fc
da7be87e-9776-4b10-bb8c-3f408cd44706
```

## Bounded Validation Evidence

Raw topic validation:

```text
query_execution_id: 50b5595b-1d53-4872-bc2e-700a54169c19
physical_topic: test.tribe.codex-sdk-20260520041053.events
year: 2026
month: 05
day: 20
hour: 09
raw_record_count: 1000
```

Quality threshold validation:

```text
query_execution_id: 40f73aca-a584-4922-ba34-4641b56b271a
invalid_quality_count: 0
missing_tribe_id_count: 0
missing_source_service_id_count: 0
unexpected_environment_count: 0
checked_record_count: 1000
```

Gold pipeline-health validation:

```text
query_execution_id: cd109872-3578-4e58-a226-280b04ff9bb1
environment: test
tribe_id: codex-sdk-20260520041053
source_service_id: codex-sdk-20260520041053-api
event_type: codex.pipeline.flush
event_day: 2026-05-20
event_count: 1000
latest_occurred_at: 2026-05-20T09:41:45.721Z
latest_ingested_at: 2026-05-20 14:27:36.973 UTC
```
