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

Do not mark a topic `Raw observed` until at least one object appears under the
exact physical topic prefix.

## Initial Test Evidence, 2026-05-20

```text
owner_tribe_id: codex-sdk-20260520041053
source_service_ids: codex-sdk-20260520041053-api
environment: test
physical_topic: test.tribe.codex-sdk-20260520041053.events
s3_prefix: s3://api-center-raw-data/topics/test.tribe.codex-sdk-20260520041053.events/
latest_s3_object_key: topics/test.tribe.codex-sdk-20260520041053.events/year=2026/month=05/day=20/hour=09/test.tribe.codex-sdk-20260520041053.events+0+0000000001.json
latest_s3_object_at: 2026-05-20T09:41:51+00:00
object_count: 2
validator_command: .\scripts\data-pipeline\validate-s3-prefix.ps1 -Bucket api-center-raw-data -PhysicalTopic test.tribe.codex-sdk-20260520041053.events -Profile apic
operator: codex
checked_at: 2026-05-20T09:42:00Z
```

Notes:

- `api-center-test-s3-sink` did not initially include the temporary SDK smoke topic.
- The connector config was updated to include `test.tribe.codex-sdk-20260520041053.events`.
- Connector status after update: connector `RUNNING`, task `0:RUNNING`.
- The connector uses `flush.size=1000` and `time.interval=HOURLY`; a 1000-record flush run was produced to the test topic.
- The sampled S3 object is line-delimited JSON string values. Bronze parsing must unwrap the JSON string before extracting event fields.

## Operating Guardrails

Before a topic is promoted from validation to scheduled dashboard or BI use,
record these controls:

```text
workgroup:
bytes_scanned_limit:
query_result_location:
  platform validation: s3://api-center-athena-results/athena-results/platform/validation/<environment>/
  platform materialization: s3://api-center-athena-results/athena-results/platform/materialization/<environment>/
  management: s3://api-center-athena-results/athena-results/management/<environment>/
  tribe: s3://api-center-athena-results/athena-results/tribe/<tribe_id>/<environment>/
query_result_retention_days:
raw_test_retention_days:
raw_prod_retention_days:
bronze_retention_days:
curated_retention_days:
raw_s3_readers:
bronze_readers:
common_silver_readers:
tribe_silver_readers:
gold_readers:
owner:
alert_threshold:
```

Required defaults:

| Control            | Default                                      |
| ------------------ | -------------------------------------------- |
| Raw S3             | Platform data operators only.                |
| Bronze             | Platform data operators and controlled jobs. |
| Common Silver      | Approved tenant-filtered readers only.       |
| Tribe Silver       | Owning tribe plus platform data operators.   |
| Gold               | Approved BI groups.                          |
| Test raw retention | `30-90` days.                                |
| Prod raw retention | `180-365` days.                              |
| Bronze retention   | `365` days.                                  |
| Curated retention  | Metric-specific.                             |

Do not connect a production dashboard directly to Raw S3. Production dashboards
must read approved Gold or Tribe Silver outputs with an `environment = 'prod'`
filter.

If an operator passes `-OutputLocation`, that explicit path wins. Use explicit
paths only for break-glass diagnostics or migration testing. Normal validation
uses `-ResultPurpose` and `-Environment`.

## APICenter Pipeline Health API

APICenter exposes curated pipeline health at:

```text
GET /api/v1/data-pipeline/health?environment=test
GET /api/v1/data-pipeline/health?environment=prod
```

The endpoint is admin-protected through the same `X-Platform-Secret` or
`platform:admin` JWT path used by other operator endpoints.

Runtime modes:

```text
PIPELINE_HEALTH_SOURCE=fixture
PIPELINE_HEALTH_SOURCE=athena
```

Use `fixture` for local development and tests:

```text
PIPELINE_HEALTH_FIXTURE_FILE=<path-to-json-with-rows-array>
```

Use `athena` for live curated Gold reads:

```text
PIPELINE_HEALTH_SOURCE=athena
AWS_REGION=ap-southeast-2
PIPELINE_HEALTH_ATHENA_DATABASE=gold_platform
PIPELINE_HEALTH_ATHENA_WORKGROUP=api-center-platform-validation-test
PIPELINE_HEALTH_QUERY_LIMIT=100
```

If the date variables are omitted, APICenter uses the current UTC date. The
Athena query must stay bounded by `year`, `month`, and `day` because the Gold
view reads projected partitions underneath.

Do not set `PIPELINE_HEALTH_YEAR`, `PIPELINE_HEALTH_MONTH`, or
`PIPELINE_HEALTH_DAY` in deployed GKE by default. Use route query parameters
`year`, `month`, and `day` for one-off review of a populated historical
partition, for example `2026-05-20`.

In GKE, do not set `AWS_PROFILE`. API Center uses the AWS SDK default
credential provider chain after `api-center-prod` is loaded from GCP Secret
Manager into `process.env`. The Secret Manager payload must include either
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, or the approved AWS runtime
credential mechanism for the deployment. If temporary credentials are used,
include `AWS_SESSION_TOKEN`.

Management can read through APICenter by setting:

```text
PIPELINE_HEALTH_PROVIDER=api-center
API_CENTER_BASE_URL=<api-center-base-url>
API_CENTER_PLATFORM_ADMIN_SECRET=<server-only-secret>
```

The local file fallback remains:

```text
PIPELINE_HEALTH_PROVIDER=local-file
PIPELINE_HEALTH_EVIDENCE_FILE=<path-to-json-with-rows-array>
```

## Test-Only Pilot Completion, 2026-05-20

```text
physical_topic: test.tribe.codex-sdk-20260520041053.events
environment: test
s3_object_count: 2
latest_s3_object_key: topics/test.tribe.codex-sdk-20260520041053.events/year=2026/month=05/day=20/hour=09/test.tribe.codex-sdk-20260520041053.events+0+0000000001.json
latest_s3_object_at: 2026-05-20T09:41:51+00:00
raw_query_id: 1de4b99e-b1c2-4439-aae0-6ac797e50d16
raw_record_count: 1000
bronze_query_id: 4e6d6724-2b76-4b7a-8da1-c7f04c7a2ae2
bronze_valid_count: 1000
bronze_event_type: codex.pipeline.flush
bronze_latest_occurred_at: 2026-05-20T09:41:45.721Z
common_silver_query_id: a8f2a5fc-49f1-4ab0-875d-d817cbd2017f
common_silver_count: 1000
gold_query_id: de046be3-ee6f-4e9d-b5ac-aa7773b8be3a
gold_event_count: 1000
gold_latest_ingested_at: 2026-05-20 11:10:16.469 UTC
prod_leak_guard_query_id: a9463449-137f-435d-b51e-c0c24cc490b0
prod_leak_guard_count: 0
operator: codex
checked_at: 2026-05-20T11:13:00Z
```

The original observed pilot remains test-only. Phase 8 now has a repo-local
approval record for the logistics production pilot:

```text
approval_record: docs/data-pipeline/production-pilot-approval-logistics.json
approved_prod_physical_topic: prod.tribe.logistics.events
owner_tribe_id: logistics
source_service_ids: logistics-orders
metric_dictionary_rows_approved: order_created_daily
athena_workgroup: api-center-platform-validation-prod
bytes_scanned_limit: 1073741824
```

This approval allows the local Athena projection files to include
`prod.tribe.logistics.events`. It does not by itself prove the live Confluent
topic, S3 Sink include, AWS catalog apply, prod smoke publish, or prod query
validation.

Current Phase 8 live status:

```text
confluent_topic: prod.tribe.logistics.events exists
confluent_connector: api-center-prod-s3-sink includes prod.tribe.logistics.events
projection_status: synced to all live prod connector topics
projection_topic_count: 63
prod_catalog_status: applied through api-center-platform-validation-prod
prod_smoke_status: accepted through APICenter with approved schema
prod_raw_status: observed in S3
prod_gold_status: validated in gold_platform.pipeline_health_daily
prod_leak_guard_status: leaked_environment_count=0
```

Use the operator helper to prove or repair a prod topic/S3 Sink include without
printing Confluent secrets:

```powershell
.\scripts\data-pipeline\ensure-confluent-topic-and-sink.ps1 `
  -EnvFile ..\apicenter-management\.env.live `
  -TopicName prod.tribe.logistics.events `
  -DryRun

.\scripts\data-pipeline\ensure-confluent-topic-and-sink.ps1 `
  -EnvFile ..\apicenter-management\.env.live `
  -TopicName prod.tribe.logistics.events
```

The prod smoke helper is Node-based because PowerShell/.NET TLS was unreliable
against the public endpoint on this workstation. It rotates the logistics
smoke secret only when explicitly requested, keeps the plaintext only in
process memory, and retries token issuance after rotation to allow API pod
secret-cache refresh.

```powershell
node .\scripts\data-pipeline\run-prod-logistics-smoke.js `
  --dry-run `
  --rotate-smoke-secret `
  --count 1000

node .\scripts\data-pipeline\run-prod-logistics-smoke.js `
  --rotate-smoke-secret `
  --count 1000
```

Latest successful prod pilot evidence:

```text
schema_registry_file: config/event-schema-registry.json
schema_registry_version: apicenter-event-schemas-2026-05-21
approved_schema: prod.logistics.order.created@1.0.0
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-schema-fix-d1eb7e6-202605211822
batch_smoke_id: prod-logistics-smoke-20260520183710
batch_publish_count: 1000
schema_validation_status: approved
s3_object: topics/prod.tribe.logistics.events/year=2026/month=05/day=20/hour=18/prod.tribe.logistics.events+0+0000000000.json
raw_query_id: 40da3dfc-0674-4c65-aac0-f54fb378b613
raw_record_count: 1000
quality_query_id: a560149c-5e15-4164-bc83-e3e426ce2697
quality_errors: 0
common_silver_query_id: 42f0c628-f1e0-493b-bccd-ef8c455cc203
common_silver_count: 1000
gold_query_id: 93965804-1563-490b-b421-8f898230e849
gold_event_count: 1000
leak_guard_query_id: 1bf40983-7643-4e79-b569-a3077bb4d8bb
leaked_environment_count: 0
```

The prod leak guard must stay bounded by `year`, `month`, and `day`. An
unbounded guard query was cancelled during validation because the projected
partition view can run longer than necessary even when it scans no data.

## Platform Governance Dashboard Status

Phase 9 governance surfaces are installed, and the deployed runtime reads live
Athena rows through the AWS SDK.

Implemented platform Gold views:

```text
gold_platform.event_quality_daily
gold_platform.gateway_decision_daily
gold_platform.shared_service_usage_daily
gold_platform.athena_query_cost_daily
```

Implemented APICenter routes:

```text
GET /api/v1/data-pipeline/quality?environment=test|prod&year=yyyy&month=mm&day=dd
GET /api/v1/data-pipeline/shared-service-usage?environment=test|prod&year=yyyy&month=mm&day=dd
GET /api/v1/data-pipeline/gateway-decisions?environment=test|prod&year=yyyy&month=mm&day=dd
GET /api/v1/data-pipeline/cost?environment=test|prod&year=yyyy&month=mm&day=dd
```

`year`, `month`, and `day` are optional as a set. When omitted, API Center
uses the current UTC date. Operators can provide all three query parameters to
review a populated historical partition such as the `2026-05-20` test/prod
pilot evidence.

Implemented management surfaces:

```text
/data-pipeline
service detail -> Observability -> Data pipeline health/governance/cost panels
/api/local/data-pipeline/quality
/api/local/data-pipeline/shared-service-usage
/api/local/data-pipeline/gateway-decisions
/api/local/data-pipeline/cost
```

Athena SDK runtime deployment evidence:

```text
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-cancel-d1eb7e6-20260521152340
cloud_build_id: 6df72593-0dbb-4e94-9fc7-ac54fcb739bb
rollout_status: deployment/api-center successfully rolled out
pod_status: 3/3 api-center pods Running
route_smoke_status: health, quality, shared-service-usage, gateway-decisions, and cost returned HTTP 200 with success=true and meta.source=athena-proxy for environment=test
route_smoke_counts: health=0, quality=0, shared-service-usage=1, gateway-decisions=0, cost=0
runtime_policy: arn:aws:iam::688717565427:policy/ApiCenterAthenaRuntimePolicy version v4
runtime_principal: api-center-athena-reader-gke
direct_runtime_athena_query_id: f0c85ef9-0729-4bad-aab7-de3b05fbf6a4
direct_runtime_athena_query_state: SUCCEEDED
review_fixes: best-effort StopQueryExecution on local timeout; runtime IAM no longer grants s3:DeleteObject on result evidence
```

Athena telemetry deployment evidence:

```text
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-telemetry-d1eb7e6-20260521154332
cloud_build_id: 75df885c-e04f-4459-acf6-df1421915516
rollout_status: deployment/api-center successfully rolled out
route_smoke_status: health, quality, shared-service-usage, gateway-decisions, and cost returned HTTP 200 with success=true and meta.source=athena-proxy for environment=test
route_smoke_counts: health=0, quality=0, shared-service-usage=1, gateway-decisions=0, cost=0
test_telemetry_topic: test.api-center.pipeline.athena-query-execution created and included in api-center-test-s3-sink
prod_telemetry_topic: prod.api-center.pipeline.athena-query-execution created and included in api-center-prod-s3-sink
projection_topic_count: 65
projection_check: ok; raw-topic-tables.sql enum matches topic-projection-values.txt
test_catalog_apply_status: succeeded after telemetry projection update
cost_validation_status: pending S3 Sink flush into raw telemetry prefix
```

Latest blocker-fix deployment evidence:

```text
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-partition-override-d1eb7e6-20260521203007
cloud_build_id: 7b812838-d455-452e-872f-261499a52555
rollout_status: deployment/api-center successfully rolled out
route_smoke_status: health, quality, shared-service-usage, gateway-decisions, and cost returned HTTP 200 with success=true and meta.source=athena-proxy for environment=test and environment=prod with year=2026&month=05&day=20
test_route_smoke_counts: health=1, quality=1, shared-service-usage=14, gateway-decisions=0, cost=0
prod_route_smoke_counts: health=1, quality=1, shared-service-usage=0, gateway-decisions=0, cost=0
partition_override: data-pipeline routes accept year/month/day query parameters and still default to current UTC when omitted
cost_validation_query_id: 410bcea0-a1e2-4682-8a47-f880aff6d3b8
cost_validation_status: SUCCEEDED
cost_validation_rows: 5 measured rows for 2026-05-21
feedback_action_smoke: POST 201 reviewed 5206456c-fa75-4730-b625-c843a07ad216; GET 200 count=2 found=true; correlationId=corr_phase9_reviewfix_smoke
feedback_postgres_smoke: api_center_ops.pipeline_feedback_actions rows=1 for 5206456c-fa75-4730-b625-c843a07ad216, environment=test, status=reviewed, correlationId=corr_phase9_reviewfix_smoke
feedback_contract_doc: docs/data-pipeline/pipeline-feedback-action-contract.md
prod_leak_guard_query_id: 37dcfed2-432f-415f-8b52-ac32c34fc7d8
prod_leak_guard_result: leaked_environment_count=0, checked_record_count=1000 for prod.tribe.logistics.events on 2026-05-20 hour=18
management_validation: focused tests passed 26/26; npx tsc --noEmit passed; npm run build passed with no Turbopack tracing warning after local-file provider code was moved behind dev/test dynamic imports
management_prod_route_smoke: local management routes returned prod Athena-backed 2026-05-20 rows for health=1, quality=1, shared-service-usage=0, gateway-decisions=0, cost=0
management_prod_feedback_smoke: local management route POST created prod reviewed record aef1a203-5b39-411f-9aff-fe76a4c92456 and GET found it for targetId=order.created
```

Latest materialization evidence:

```text
curated_bucket: api-center-curated-data
materialization_test_workgroup: api-center-materialization-test
materialization_prod_workgroup: api-center-materialization-prod
materialization_workgroup_output: s3://api-center-athena-results/athena-results/platform/materialization/<environment>/
materialization_workgroup_guardrail: bytes_scanned_cutoff=1073741824; EnforceWorkGroupConfiguration=false only for CTAS external_location support
athena_results_layout_check: scanned=473, unclassified_count=0 after adding platform/materialization prefixes
athena_results_lifecycle: platform materialization result prefix expires after 7 days
materialized_database: materialized_platform
test_materialized_table: materialized_platform.gold_platform_pipeline_health_daily_test_20260520
test_materialized_s3_path: s3://api-center-curated-data/gold/platform/pipeline_health_daily/environment=test/year=2026/month=05/day=20/
test_materialization_query_ids: database create ab3139d5-4cbe-4321-b013-aee814f4e6b6; CTAS 455be652-9283-476b-81f1-b4fe94c9afb1
test_materialized_row_count_query_id: 638a8a33-deb5-40cf-8cc8-003814fae9e1
test_materialized_row_count: 1
test_source_row_count_query_id: 8de5fede-5c43-4453-adcd-f01faf573d20
test_source_row_count: 1
curated_output_check: one Parquet object exists under the approved curated gold path
review_fix_replace_guard: materialize-silver-gold.ps1 rejects -Replace without -ConfirmReplaceCleanup
review_fix_tribe_scope: common_silver.tribe_event_envelope supports -TribeId and writes tribe_id=<tribe_id>/environment=<env>/...
review_fix_validator_policy: live APICenterDataPipelineValidator policy now grants Glue DDL only on materialized_platform; source catalogs remain read-only
```

Latest decision-intelligence evidence:

```text
catalog_view: gold_platform.decision_signals_daily
catalog_apply_query_id: acda4303-686e-4a80-ae99-156c89353581
test_decision_signal_query_id: cbde08d3-0488-4aeb-a50e-0e280bcb058e
test_decision_signal_rows: 3 medium shared_service_error_spike rows for 2026-05-20
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-signals-fix-d1eb7e6-20260521235419
cloud_build_id: 8aefc271-4a38-4eb8-9681-84465ccb8954
rollout_status: deployment/api-center successfully rolled out
route_smoke_status: decision-signals returned HTTP 200 with success=true and meta.source=athena-proxy for environment=test and environment=prod with year=2026&month=05&day=20
test_route_smoke_counts: decision-signals=3
prod_route_smoke_counts: decision-signals=0
readiness_status: ok
management_validation: npx tsc --noEmit passed; npm run build passed and includes /api/local/data-pipeline/decision-signals
api_validation: decision-signals focused tests passed; typecheck passed; build passed
review_fix_database_migration: supabase/migrations/20260521235900_extend_pipeline_feedback_for_decision_signals.sql applied; rollback insert smoke accepted decision.false_positive.marked on targetType=signal
review_fix_deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix-d1eb7e6-20260522001734
review_fix_cloud_build_id: 9884dad4-96d9-4cd1-b669-43a780daf797
review_fix_route_smoke_status: readiness ok; decision-signals stayed meta.source=athena-proxy with test count=3; feedback action POST/GET succeeded for decision.false_positive.marked on targetType=signal with status=closed
review_fix_management_validation: focused schema/governance panel tests passed 11/11; npx tsc --noEmit passed; npm run build passed
review_fix_api_validation: pipeline-feedback focused tests passed 8/8; typecheck passed; build passed
review_fix2_database_migration: supabase/migrations/20260522003000_constrain_false_positive_feedback_target.sql applied; rollback smoke accepted target_type=signal and rejected target_type=event for decision.false_positive.marked
review_fix2_deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix2-d1eb7e6-20260522003353
review_fix2_cloud_build_id: 9a6b5a94-ac35-4efc-aff3-d2a0a7a3cc84
review_fix2_route_smoke_status: readiness ok; decision-signals stayed meta.source=athena-proxy with test count=3; valid false-positive signal feedback created/listed with status=closed; invalid false-positive event feedback rejected with HTTP 400
review_fix2_api_validation: pipeline-feedback focused tests passed 9/9
```

Latest test-lane deployment evidence:

```text
test_namespace: api-center-test
test_deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-decision-reviewfix2-d1eb7e6-20260522003353
test_rollout_status: deployment/api-center successfully rolled out
test_configmap_update: PIPELINE_HEALTH_SOURCE=athena, PIPELINE_GOVERNANCE_SOURCE=athena, Athena database=gold_platform, AWS_REGION=ap-southeast-2
test_runtime_aws_principal: api-center-athena-reader-gke-test with ApiCenterAthenaRuntimePolicy
test_secret_update: api-center-test version 8 contains the dedicated test AWS runtime key; prod AWS keys were not copied into the test secret
test_feedback_db_migrations: feedback action table and signal false-positive constraints applied to the api-center-test DATABASE_URL
test_backend_smoke: readiness ok; decision-signals success=true source=athena-proxy count=3; valid false-positive signal feedback status=closed; invalid false-positive event feedback rejected with HTTP 400
management_test_deployment: Vercel deployment dpl_3jxXVxMYDd3BxjetZbAbAtrrA5na at https://apicenter-management-test-4kym37e24-ele-3-ap-i-center.vercel.app aliased to https://api-center-management-test.itsandbox.site
management_test_env_fix: MANAGEMENT_PUBLIC_BASE_URL=https://api-center-management-test.itsandbox.site; PIPELINE_HEALTH_PROVIDER=api-center; PIPELINE_GOVERNANCE_PROVIDER=api-center
management_test_smoke: deployed config is test/descope with missingEnvCount=0; /api/local/data-pipeline/health returned count=1 source=athena-proxy; /api/local/data-pipeline/decision-signals returned count=3 source=athena-proxy
```

Resolved blocker status for the live dashboard:

```text
api_center_gke_athena_runtime: fixed_with_evidence
  completed: AWS SDK Athena runner replaces the old AWS CLI shell-out path for
    health and governance reads.
  completed: deployed API Center reads Athena with AWS SDK credentials loaded
    from GCP Secret Manager api-center-prod.
  evidence: test route smoke returned meta.source=athena-proxy for all five
    pipeline dashboard routes. Dated partition smoke for 2026-05-20 returned
    health=1 and quality=1 for both test and prod.

athena_query_cost_telemetry: fixed_with_evidence
  completed: APICenter emits Athena query telemetry for live dashboard reads.
  completed: gold_platform.athena_query_cost_daily returned 5 measured rows
    for environment=test on 2026-05-21.
  evidence: validate-athena-query-cost query
    410bcea0-a1e2-4682-8a47-f880aff6d3b8 succeeded.

athena_query_cost_telemetry_code: fixed_with_evidence
  completed: API Center now emits best-effort Athena query telemetry after
    successful live Athena health/governance reads.
  completed: telemetry publishes to exact physical topics
    test.api-center.pipeline.athena-query-execution and
    prod.api-center.pipeline.athena-query-execution, so the deployed
    KAFKA_TOPIC_PREFIX cannot accidentally create prod.test.* topics.
  completed: telemetry payload includes environment, database, workgroup,
    result_purpose, query_execution_id, bytes_scanned, output location, and
    completed_at.
  validation_query: infra/aws-data-pipeline/queries/validate-athena-query-cost.sql
  completed: deployed telemetry image and triggered test dashboard Athena
    queries.
  completed: created test/prod telemetry Kafka topics and added them to their
    matching S3 Sink connector topic includes.
  completed: added both telemetry topics to Athena projection values and
    reapplied the test catalog.
  completed: Confluent S3 Sink flushed telemetry and
    gold_platform.athena_query_cost_daily returned measured rows.

feedback_action_contracts: fixed_with_evidence
  completed: feedback action DTO, service, controller, management proxy,
    management client, and row-level management controls exist.
  completed: live API smoke created and listed a test feedback action.
  completed: feedback actions persist to Postgres when DATABASE_ENABLED=true
    and fail closed if the Prisma client is unavailable.
  evidence: migrations 20260521172000_add_pipeline_feedback_actions and
    20260521180500_add_pipeline_feedback_correlation_id created
    api_center_ops.pipeline_feedback_actions with correlation_id.
  evidence: POST /api/v1/data-pipeline/feedback-actions returned 201 reviewed;
    GET returned the created record; direct Postgres smoke found the same
    record ID with rows=1 and correlationId=corr_phase9_reviewfix_smoke.
```

## Production Pilot Gate

Do not run production validation until these fields are complete:

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

After approval, repeat the same S3, Raw, Bronze, Common Silver, Gold, and prod
leak-guard checks from the test pilot with `environment = 'prod'`.

Machine-check the approval record before any prod topic is added to projection
values or Confluent S3 Sink includes:

```powershell
.\scripts\data-pipeline\check-production-pilot-approval.ps1 `
  -ApprovalFile .\docs\data-pipeline\production-pilot-approval-logistics.json
```

To update local Athena projection files from the approved record:

```powershell
.\scripts\data-pipeline\promote-production-pilot-projection.ps1 `
  -ApprovalFile .\docs\data-pipeline\production-pilot-approval-logistics.json
```

Use `docs/data-pipeline/production-pilot-approval-template.json` as a starting
point only. The temporary SDK smoke tribe `codex-sdk-20260520041053` must not be
promoted to prod unless the approval record explicitly sets
`temporary_sdk_prod_approval` to `true`.
