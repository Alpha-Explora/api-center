# Control Tower CI/CD S3 Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Control Tower the multi-tribe CI/CD observability plane for frontend, backend, and mobile repositories, while publishing normalized pipeline events through `@implementsprint/sdk` into the APICenter Confluent-to-S3 data pipeline.

**Architecture:** GitHub Actions remains the execution source, Control Tower remains the operational UI and normalized Supabase store, and APICenter remains the governed event export path. Control Tower must not receive AWS S3 or Confluent writer credentials; it authenticates to APICenter as the `cicd` platform producer and publishes immutable pipeline telemetry through the SDK. S3, Bronze, Silver, Gold, and BI layers consume those events for cross-tribe analytics.

**Tech Stack:** Control Tower Next.js 16, Supabase Postgres, GitHub Actions webhooks/API, `@implementsprint/sdk` v1.2.1+, APICenter governed Kafka publish API, Confluent Cloud, Confluent S3 Sink, AWS S3, Glue/Athena or Databricks, PowerBI or Control Tower dashboards.

---

## North Star Question

Can every tribe see the real-time delivery health of every frontend, backend,
and mobile repository it owns, and prove the evidence path from GitHub Actions
to Control Tower to APICenter/S3 analytics?

This is stronger than "did CI pass?" because it forces the platform to track:

- current live pipeline status without checking GitHub manually
- which tribe owns the repository
- which repo type ran (`frontend`, `backend`, `mobile`)
- which gates ran and which were skipped
- whether failures are code, infrastructure, security, test flake, provider, or policy failures
- whether deployment and promotion were actually reached
- whether the pipeline facts landed in the raw S3 lake for later analytics

Supporting product questions:

- What is running, blocked, failed, promoted, or deployed right now?
- Who owns the repository, workflow, gate, and recovery action?
- What failed, which gate failed, and which failure category explains it?
- What evidence proves the status inside Control Tower?
- Did the event publish through APICenter under the `cicd` principal and `control-tower` source service?
- Did the event land in S3 and appear in Bronze/Silver/Gold analytics?
- Can each user see the right pipeline data for their tribe without seeing data they do not own?

## Operating Decision

Use this model first:

```text
GitHub Actions
  -> Control Tower webhook/backfill ingestion
  -> Control Tower Supabase operational tables
  -> @implementsprint/sdk from Control Tower
  -> APICenter governed publish to logical tribe.cicd.events
  -> physical prod.tribe.cicd.events
  -> Confluent S3 Sink
  -> s3://api-center-raw-data/topics/prod.tribe.cicd.events/
  -> Bronze/Silver/Gold CI/CD analytics
  -> Control Tower / BI dashboards
```

Use this APICenter identity model:

```text
cicd
  = authenticated APICenter tribe/principal
  = owns the tribe secret
  = owns the tenant topic tribe.cicd.events

control-tower
  = registered service owned by cicd
  = sourceServiceId for event attribution
  = does not receive a separate APICENTER_TRIBE_SECRET by default

affectedTribeId
  = payload dimension for analytics and dashboard filtering
  = never drives APICenter auth or topic routing in the first rollout
```

Control Tower runtime uses:

```text
APICENTER_TRIBE_ID=cicd
APICENTER_SERVICE_ID=control-tower
APICENTER_TRIBE_SECRET=<secret issued for the cicd principal>
```

The affected application tribe is still captured in every event as `affectedTribeId` or `repoTribeId`. That gives per-tribe analytics and dashboard filtering without breaking the current tenant topic guard, which only lets a client publish inside its authenticated tribe boundary.

Do not use one tribe's secret to publish events for another tribe. If later we need physical per-tribe CI/CD topics such as `prod.tribe.<tribeId>.events`, add a platform-approved delegated publisher in APICenter instead of distributing per-tribe secrets to Control Tower.

Control Tower code must use `publishTribeEvent()` and the logical topic
`tribe.cicd.events`. Do not hard-code `test.tribe.cicd.events` or
`prod.tribe.cicd.events` into SDK publish payloads. Environment-prefixed
physical topics are APICenter/Confluent/S3 verification concerns.

Control Tower is the operational source of truth for live pipeline status.
APICenter, Kafka, S3, Bronze, Silver, and Gold are export and analytics layers.
Do not use S3 as the live status database.

## Current Repo Anchors

| Area | Current anchor | Meaning |
| --- | --- | --- |
| Control Tower app | `control-tower/README.md` | Already documents GitHub OAuth, tribe-scoped access, workflow ingestion, repository-to-tribe mapping, and webhook/backfill endpoints. |
| Current pipeline store | `control-tower/supabase/schema.sql` | Currently uses one Supabase database with tables in `public`; target hardening is domain schemas inside the same DB, not separate databases per microservice. |
| Webhook ingestion | `control-tower/src/app/api/webhooks/github/workflow-run/route.ts` | Ingests GitHub `workflow_run`, stores raw payload, upserts normalized run/deployment, writes audit events, evaluates alerts. |
| Backfill ingestion | `control-tower/src/app/api/ingestion/github/workflow-runs/sync/route.ts` | Replays workflow runs and jobs from GitHub API for configured repos. |
| Tribe resolver | `control-tower/src/lib/control-tower/governance.ts` | Resolves repo ownership by env mapping, `repo_tribe_map`, and naming fallback such as `tribename-fe`, `tribename-be`, `tribename-mobile`. |
| SDK producer | `api-shared-services/src/TribeClient.ts` | Exposes `publishTribeEvent()` and `kafkaPublish()` through `/api/v1/kafka/publish`; SDK version is currently `1.2.1`. |
| Event contract | `api-center/docs/data-pipeline/tribe-event-contract.md` | Requires owner tribe topic, `sourceServiceId`, `eventType`, stable key, approved payload, and metadata. |
| S3 onboarding | `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md` | Defines topic inclusion, smoke events, S3 validation, Athena validation, and failure triage. |
| Raw/Bronze path | `api-center/docs/data-pipeline/raw-to-bronze-runbook.md` | Defines raw S3 path and required Bronze columns. |
| Confluent/S3 target | `api-center/docs/confluent-cloud-s3-sink-setup.md` | Documents the active Confluent cluster, S3 sink, test/prod topic prefixes, and existing prod tribe topics. |

## Current Capability And Readiness

Verified on 2026-05-20 from `C:\Codes\apic\control-tower`:

```text
npm test
7 test files passed
30 tests passed

npm run build
Next.js production build passed
```

Current Control Tower code can compile and has the backend shape for live
pipeline status tracking:

```text
GitHub workflow_run event
  -> /api/webhooks/github/workflow-run
  -> github_webhook_events raw payload row
  -> workflow_runs normalized status row
  -> deployments operational status row
  -> /api/workflow-runs and dashboard reads

GitHub workflow run backfill
  -> /api/ingestion/github/workflow-runs/sync
  -> workflow_runs normalized status rows
  -> workflow_jobs job/gate rows
  -> /api/workflow-jobs and dashboard reads
```

That is code readiness, not live readiness. Live tracking is proven only after
the deployed Control Tower has the server-side environment, target Supabase
schema, GitHub webhook, and at least one real workflow event verified end to
end.

Minimum runtime requirements for live status tracking:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
GITHUB_WEBHOOK_SECRET
INGESTION_TOKEN
GITHUB_TOKEN
TRIBE_REPO_MAP_JSON or repo_tribe_map rows for pilot repositories
```

Definition of "Control Tower status tracking works":

```text
one pilot repo workflow run completes
raw delivery exists in github_webhook_events
run exists in workflow_runs with correct status and tribe
deployment row reflects the same status
job rows exist in workflow_jobs after webhook support or sync backfill
/api/workflow-runs returns the pilot run under the right tribe scope
/api/workflow-jobs returns the pilot jobs under the right tribe scope
dashboard shows the same status without direct GitHub lookup
```

## Database Schema Boundary Decision

Use one Control Tower Supabase/Postgres database, but split tables into
domain-owned schemas as the system hardens. This gives clearer service
boundaries without breaking Control Tower's need to query across every tribe,
repository, and repo type.

Target schema layout:

```text
control_tower_identity
  user_tribe_membership

control_tower_pipeline
  workflow_runs
  workflow_jobs
  deployments
  github_webhook_events
  repo_tribe_map
  pipeline_repositories

control_tower_governance
  policy_rules
  audit_events

control_tower_alerting
  alert_rules
  alert_channels
  notifications

control_tower_export
  cicd_event_outbox
  pipeline_export_attempts
```

Do not create one schema per frontend/backend/mobile repo or per tiny
microservice. Keep microservice identity as data dimensions such as
`service_id`, `system_id`, `repo_type`, and `pipeline_kind`. That keeps
dashboard queries, RLS, metrics, alerts, and APICenter export practical.

Migration rule:

```text
public tables stay compatible first
domain schemas are created with the same RLS/security posture
data is moved or copied into domain schemas
public compatibility views preserve existing Supabase queries
application modules switch to schema-qualified access one domain at a time
compatibility views are removed only after tests and dashboard reads pass
```

Supabase client access should move from implicit `public` table names:

```ts
supabase.from("workflow_runs")
```

to schema-qualified domain access:

```ts
supabase.schema("control_tower_pipeline").from("workflow_runs")
```

## Data We Actually Track

Track pipeline data at four levels. Do not rely on only one summary row per deployment.

| Level | Example events | Storage now | Needed additions |
| --- | --- | --- | --- |
| Run | `cicd.workflow_run.requested`, `cicd.workflow_run.completed` | `workflow_runs`, `deployments`, `github_webhook_events` | Add `repo_type`, `system_id`, `service_id`, `pipeline_kind`, `pipeline_version`, `failure_category`, and a publish outbox before SDK export. |
| Job/gate | `cicd.workflow_job.completed`, `cicd.pipeline_gate.failed` | `workflow_jobs` from backfill sync | Add workflow job webhook or cursor-based scheduled backfill; normalize known gate names across FE/BE/mobile. |
| Promotion | `cicd.promotion.requested`, `cicd.promotion.approved`, `cicd.promotion.deployed` | `deployments`, `audit_events`, policy rules | Add first-class promotion lifecycle records before treating promotion metrics as reliable. |
| Analytics export | `cicd.telemetry.exported`, S3 object observed, Bronze observed | APICenter/S3/Bronze docs exist; Control Tower does not yet publish | Add idempotent `control_tower_export.pipeline_export_attempts` / `control_tower_export.cicd_event_outbox`, replay controls, and evidence checks for APICenter accepted, S3 observed, and Bronze observed. |

Required dimensions on every normalized event:

```text
eventId
eventType
schemaName
schemaVersion
sourceSystem=github-actions
sourceServiceId=control-tower
repository
repoType=frontend|backend|mobile|platform|unknown
affectedTribeId
workflowName
pipelineKind
pipelineVersion
runId
runAttempt
jobId
gateName
branch
environment=test|uat|main
commitSha
pullRequestNumber
actor
status=queued|running|success|failed|cancelled
githubStatus
githubConclusion
gateOutcome=success|failed|cancelled|skipped|unknown
failureCategory
startedAt
completedAt
durationSeconds
runUrl
artifactUrls
policyViolations
occurredAt
```

## CI/CD Event Contract

Initial SDK shape from Control Tower:

```ts
await apiCenter.publishTribeEvent({
  sourceServiceId: "control-tower",
  key: `github:${repository}:${runId}:${runAttempt}`,
  eventType: "cicd.workflow_run.completed",
  payload: {
    eventId,
    sourceSystem: "github-actions",
    repository,
    repoType,
    affectedTribeId,
    workflowName,
    pipelineKind,
    pipelineVersion,
    runId,
    runAttempt,
    branch,
    environment,
    commitSha,
    actor,
    status,
    githubStatus,
    githubConclusion,
    failureCategory,
    startedAt,
    completedAt,
    durationSeconds,
    runUrl,
    occurredAt
  },
  metadata: {
    schemaName: "cicd.workflow_run.completed",
    schemaVersion: "1",
    classification: "internal",
    controlTowerTable: "workflow_runs"
  }
});
```

Event types to start with:

| Event type | Trigger |
| --- | --- |
| `cicd.workflow_run.requested` | GitHub run enters queued/requested state. |
| `cicd.workflow_run.in_progress` | GitHub run starts. |
| `cicd.workflow_run.completed` | GitHub run completes with success, failure, cancelled, or skipped conclusion. |
| `cicd.workflow_job.completed` | A job/gate completes. Start from sync, then add webhook support if needed. |
| `cicd.pipeline_gate.failed` | A known gate fails: lint, test, build, security, sonar, e2e, deploy, promotion. |
| `cicd.policy_violation.recorded` | Control Tower policy blocks or flags a deployment/promotion. |
| `cicd.telemetry_export.failed` | SDK publish fails after retries or dead-letter fallback. |

Do not publish secrets, GitHub tokens, package tokens, raw logs, raw `.env`, signing keys, mobile keystore content, or provider credentials.

Event payload limits are part of the first publishing slice, not late
hardening. CI/CD events should target a practical 32-64 KB max serialized
payload size, cap `artifactUrls` and `policyViolations`, and reject raw logs or
large provider response bodies before creating an outbox row.

## Kafka Envelope And Bronze Contract

The APICenter governed Kafka value contains this JSON envelope:

```text
eventType
payload
metadata
governance.sourceTribeId
governance.sourceServiceId
governance.correlationId
governance.schemaVersion
_meta.timestamp
_meta.source
_meta.correlationId
```

The Kafka message key is outside the JSON value. The S3/Bronze layer derives
these additional ingestion columns:

```text
Kafka message key
source_topic
source_file
ingested_at
environment
raw_record
source_partition
```

Bronze must not guess where CI/CD fields live. Use this extraction map:

| Bronze column | Source |
| --- | --- |
| `source_topic` | Raw S3 topic folder / Kafka topic. |
| `source_system` | `payload.sourceSystem`; default `github-actions` only for `cicd.*` events. |
| `event_id_or_key` | `payload.eventId`; fallback to Kafka message key. |
| `schema_name` | `metadata.schemaName`; default rejected if missing after Phase 1.5. |
| `schema_version` | `metadata.schemaVersion`; default rejected if missing after Phase 1.5. |
| `governance_schema_version` | `governance.schemaVersion`. |
| `source_service_id` | `governance.sourceServiceId`; expected `control-tower`. |
| `publisher_tribe_id` | `governance.sourceTribeId`; expected `cicd`. |
| `tribe_id` | `publisher_tribe_id` for raw lineage; do not use as affected tribe. |
| `affected_tribe_id` | `payload.affectedTribeId`. |
| `repository` | `payload.repository`. |
| `repo_type` | `payload.repoType`. |
| `pipeline_kind` | `payload.pipelineKind`. |
| `run_id` | `payload.runId`. |
| `run_attempt` | `payload.runAttempt`. |
| `job_id` | `payload.jobId`. |
| `gate_name` | `payload.gateName`. |
| `gate_outcome` | `payload.gateOutcome`. |
| `status` | `payload.status`, using Control Tower's current enum. |
| `github_status` | `payload.githubStatus`. |
| `github_conclusion` | `payload.githubConclusion`, including `skipped` when GitHub reports it. |
| `event_date` | Date parsed from `payload.occurredAt`; otherwise ingestion date with a quality flag. |
| `occurred_at` | `payload.occurredAt`. |
| `raw_record` | Original JSON value from Kafka/S3. |
| `quality_status` | `valid`, `warning`, or `invalid` based on schema and timestamp checks. |
| `quality_error` | Rejection or warning detail when required fields are missing or malformed. |

Production Gold metrics must filter:

```sql
environment = 'prod'
```

and slice business visibility by `affected_tribe_id` plus repository mapping,
not by `publisher_tribe_id`. The publisher remains `cicd/control-tower` for
all first-rollout CI/CD telemetry.

Gold metrics cannot depend on these events until the schema review records:

```text
schema_owner
semantic_owner
compatibility_policy
enum_definitions
pii_classification_for_actor_repository_urls
retention_tier
event_size_limit
breaking_change_approver
dashboard_metric_dependencies
```

## Pipeline Taxonomy

Normalize all reusable workflows to this gate taxonomy so dashboards compare tribes fairly.

| Repo type | Required gates | Optional gates |
| --- | --- | --- |
| Frontend | install, lint, typecheck, unit test, build, artifact/preview, deploy, promotion | e2e, visual regression, bundle budget, accessibility, lighthouse |
| Backend | install, lint, typecheck, unit test, integration test, contract check, build, container build, security scan, deploy, smoke, promotion | migration dry-run, k6, sonar, SBOM, dependency review |
| Mobile | install, lint, typecheck, unit test, Android build, iOS build, E2E/smoke, artifact signing, distribution, promotion | Detox, Maestro, store upload, device-farm run |
| Platform workflow | lint, schema validation, workflow dry-run, fixture validation, release reference validation | downstream consumer fixture run |

Each reusable workflow must expose or infer:

```text
repo_type
tribe_id
system_id
service_id
pipeline_kind
pipeline_version
environment
run_deploy
run_promotion
dry_run
```

Use a checked-in manifest or an equivalent Control Tower table as the durable
source for these values. The preferred manifest path for tribe repos is:

```text
.apicenter/pipeline.json
```

Minimum shape:

```json
{
  "tribeId": "flow-ci",
  "repoType": "backend",
  "systemId": "flow-ci",
  "serviceId": "flow-ci-api",
  "pipelineKind": "backend-nest",
  "pipelineVersion": "2026-05",
  "environmentBranches": {
    "test": ["test", "develop"],
    "uat": ["uat"],
    "main": ["main"]
  }
}
```

Reusable workflows must fail validation when required metadata is missing.
Control Tower can keep a table override for legacy repos, but production
metrics should not rely on name fallback alone.

## Phased Delivery

### Phase 0: Alignment, Live Status Readiness, And Registration

- [ ] Confirm the north star question above as the product framing for Control Tower.
- [ ] Apply `control-tower/supabase/schema.sql` to the target Supabase database or confirm the target database already has `workflow_runs`, `workflow_jobs`, `deployments`, `github_webhook_events`, `repo_tribe_map`, and `audit_events`.
- [ ] Configure deployed Control Tower server-side environment with `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_WEBHOOK_SECRET`, `INGESTION_TOKEN`, and `GITHUB_TOKEN`.
- [ ] Configure repository-to-tribe mapping for one backend pilot repo using `repo_tribe_map` or `TRIBE_REPO_MAP_JSON`.
- [ ] Configure a GitHub webhook for the pilot repo or org to call `/api/webhooks/github/workflow-run` for `workflow_run` events using the same `GITHUB_WEBHOOK_SECRET`.
- [ ] Run one pilot workflow and verify `github_webhook_events` stores the raw delivery.
- [ ] Verify the same pilot run is upserted into `workflow_runs` with the expected `repository`, `run_id`, `branch`, `environment`, `tribe`, `status`, `commit_sha`, `started_at`, and `completed_at`.
- [ ] Verify `deployments` reflects the same pilot status for Control Tower's operational dashboard.
- [ ] Run `/api/ingestion/github/workflow-runs/sync` for the pilot repo and verify `workflow_jobs` contains job/gate rows for the same `run_id`.
- [ ] Verify `/api/workflow-runs?repository=<pilot-repo>` and `/api/workflow-jobs?repository=<pilot-repo>&runId=<run-id>` return the expected data under the correct tribe access scope.
- [ ] Treat Control Tower live status tracking as proven only after the pilot repo can be traced from GitHub workflow run to Supabase rows to Control Tower API/dashboard without manually checking GitHub.
- [ ] Register or verify the root APICenter tribe principal `serviceId=cicd`, `ownerTribeId=cicd`, `serviceType=tribe`.
- [ ] Provision or verify Secret Manager secret `api-center-tribe-secret-cicd`; this secret backs `APICENTER_TRIBE_ID=cicd`.
- [ ] Register Control Tower in APICenter as `serviceId=control-tower`, `ownerTribeId=cicd`, `serviceType=tribe`.
- [ ] Ensure the `cicd` principal receives `external:kafka:write` through the concrete current mechanism: include `kafka` in effective `consumes` or explicitly grant Kafka scopes through the approved registry path.
- [ ] Confirm `POST /api/v1/auth/token` for `tribeId=cicd` returns scopes containing `external:kafka:write`.
- [ ] Confirm a governed publish smoke through the logical topic `tribe.cicd.events` succeeds before checking physical topics.
- [ ] Provision or verify physical topics `test.tribe.cicd.events` and `prod.tribe.cicd.events`.
- [ ] Include both physical topics in the managed S3 sink connector.
- [ ] Add `control-tower` to the S3 onboarding state ladder and record evidence links.
- [ ] Confirm Control Tower runtime has only APICenter credentials, not Confluent or AWS writer credentials.
- [ ] Record exact S3 sink connector name, connector service account, topic prefix ACLs, DLQ ACLs, connector state, and task state.
- [ ] Confirm Bronze filters exclude `test.tribe.cicd.events` from production Gold outputs.

APICenter manifest for the root `cicd` principal:

```json
{
  "serviceId": "cicd",
  "ownerTribeId": "cicd",
  "name": "CI/CD Platform Tribe",
  "serviceType": "tribe",
  "baseUrl": "https://control-tower.itsandbox.site",
  "healthCheck": "/api/health",
  "requiredScopes": ["cicd:read", "cicd:write"],
  "exposes": ["/api/health"],
  "consumes": ["kafka"],
  "version": "1.0.0",
  "description": "APICenter principal for CI/CD telemetry publishing.",
  "tags": ["cicd", "control-tower", "telemetry"],
  "ownerTeam": "CI/CD Platform",
  "contact": "cicd-platform@example.com",
  "serviceTier": "critical",
  "costCenter": "platform-cicd"
}
```

APICenter manifest for the Control Tower producer service:

```json
{
  "serviceId": "control-tower",
  "ownerTribeId": "cicd",
  "name": "Control Tower",
  "serviceType": "tribe",
  "baseUrl": "https://control-tower.itsandbox.site",
  "healthCheck": "/api/health",
  "requiredScopes": ["control-tower:read", "control-tower:write"],
  "exposes": ["/api/health", "/api/workflow-runs", "/api/workflow-jobs"],
  "consumes": ["kafka"],
  "version": "1.0.0",
  "description": "CI/CD observability producer that publishes governed pipeline telemetry through APICenter.",
  "tags": ["cicd", "control-tower", "telemetry"],
  "ownerTeam": "CI/CD Platform",
  "contact": "cicd-platform@example.com",
  "serviceTier": "critical",
  "costCenter": "platform-cicd"
}
```

Management integration:

- Run the management onboarding flow once in the test management environment
  with `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=test`.
- Run the same flow once in the live management environment with
  `NEXT_PUBLIC_KAFKA_TOPIC_PREFIX=prod`.
- Use the `control-tower` service detail page/onboarding section to provision
  the owner tribe topic and add it to the S3 sink.
- Current management evidence can prove topic existence and S3 sink inclusion.
  ACLs, DLQ ACLs, connector task state, S3 object keys, and Bronze counts need
  manual evidence links or new management read APIs until those features exist.
- Do not rely on `.local-state/topic-onboarding-states.json` as the durable
  production audit source; move topic onboarding state to a shared durable
  store before production signoff.

Exit evidence:

```text
control-tower registration approved
cicd token can authenticate
cicd token includes external:kafka:write
APICenter governance catalog works for tribe cicd
logical topic publish to tribe.cicd.events returns accepted=true
test/prod cicd topics exist
S3 sink includes cicd topics
S3 sink task state is RUNNING
DLQ and prefix ACLs are verified
Bronze prod filters exclude test topics
```

### Phase 0.5: Control Tower Domain Schemas

This phase can run after the live-status pilot starts, but before expanding to
many repositories. It is an internal database hardening step, not a reason to
delay the first webhook-to-dashboard proof.

- [ ] Introduce a migration folder if Control Tower still only has `control-tower/supabase/schema.sql`:

```text
control-tower/supabase/migrations/
  202605200001_create_control_tower_domain_schemas.sql
  202605200002_move_control_tower_tables_to_domain_schemas.sql
```

- [ ] Create the target schemas:

```sql
create schema if not exists control_tower_identity;
create schema if not exists control_tower_pipeline;
create schema if not exists control_tower_governance;
create schema if not exists control_tower_alerting;
create schema if not exists control_tower_export;
```

- [ ] Move or recreate identity tables under `control_tower_identity`:

```text
user_tribe_membership
```

- [ ] Move or recreate pipeline tables under `control_tower_pipeline`:

```text
workflow_runs
workflow_jobs
deployments
github_webhook_events
repo_tribe_map
pipeline_repositories
```

- [ ] Move or recreate governance tables under `control_tower_governance`:

```text
policy_rules
audit_events
```

- [ ] Move or recreate alerting tables under `control_tower_alerting`:

```text
alert_rules
alert_channels
notifications
```

- [ ] Create export tables under `control_tower_export`:

```text
cicd_event_outbox
pipeline_export_attempts
```

- [ ] Recreate indexes, updated-at triggers, functions, foreign keys, and RLS policies in the new schemas; do not rely on copied tables without validating policies.
- [ ] In Supabase API settings, expose only the domain schemas needed by server-side routes, and keep public browser access constrained by existing RLS and authenticated API routes.
- [ ] Add temporary compatibility views in `public` for existing code paths while modules migrate:

```sql
create or replace view public.workflow_runs
with (security_invoker = true)
as select * from control_tower_pipeline.workflow_runs;

create or replace view public.workflow_jobs
with (security_invoker = true)
as select * from control_tower_pipeline.workflow_jobs;
```

- [ ] Update Control Tower data access one domain at a time:

```ts
supabase.schema("control_tower_pipeline").from("workflow_runs")
supabase.schema("control_tower_pipeline").from("workflow_jobs")
supabase.schema("control_tower_pipeline").from("deployments")
supabase.schema("control_tower_governance").from("audit_events")
supabase.schema("control_tower_alerting").from("notifications")
supabase.schema("control_tower_export").from("cicd_event_outbox")
```

- [ ] Keep `service_id`, `system_id`, `repo_type`, and `pipeline_kind` as columns, not schema names.
- [ ] Backport the final schema layout into `control-tower/supabase/schema.sql` so fresh local setup matches migrated environments.

Exit evidence:

```text
schema migration applies cleanly in a disposable Supabase/Postgres database
existing Control Tower tests pass against compatibility views
workflow run API reads from control_tower_pipeline
workflow job API reads from control_tower_pipeline
deployment API reads from control_tower_pipeline
audit API reads from control_tower_governance
notification API reads from control_tower_alerting
outbox worker reads from control_tower_export
public compatibility views are documented with removal criteria
```

### Phase 1: Control Tower Ingestion Baseline

- [ ] Inventory all frontend, backend, and mobile repositories that belong in the multi-tribe pipeline.
- [ ] Fill `repo_tribe_map` for every repository instead of relying on naming fallback.
- [ ] Add `repo_type` and `system_id` mapping source. Prefer a controlled manifest or table over parsing repo names forever.
- [ ] Verify GitHub `workflow_run` webhooks are configured on every repository or at the organization level.
- [ ] Verify `POST /api/ingestion/github/workflow-runs/sync` can backfill each repository with bounded repo/day batches, rate-limit handling, and reconciliation counts.
- [ ] Decide whether job/gate truth comes from a `workflow_job` webhook, scheduled cursor-based backfill, or both.
- [ ] Sanitize or minimize `github_webhook_events.payload`; classify actor, repository, URL, and commit fields; set retention; keep raw payload access platform-admin only.
- [ ] Define failure categories: `code`, `test_flake`, `dependency`, `security`, `policy`, `provider`, `infra`, `manual_cancel`, `unknown`.
- [ ] Split token responsibilities: GitHub Actions read token or GitHub App for backfill, GitHub Packages read token for SDK install, `INGESTION_TOKEN` for sync endpoint protection, and APICenter tribe secret for runtime publish.
- [ ] Define pilot cost budgets: max repos per sync, max days per batch, expected event count, S3 lifecycle default, Bronze partitioning, and alert threshold for export volume.
- [ ] Add dashboard filters for tribe, repo type, environment, workflow, and failure category only after the backing columns and query surfaces exist.

Exit evidence:

```text
100% repository-to-tribe mapping for pilot repos
frontend/backend/mobile pilot repos visible in workflow_runs
workflow_jobs populated for pilot repos
deployment rows correlate by repository + run_id + run_attempt
raw GitHub payload retention and access rules approved
job/gate ingestion source chosen with reconciliation counts
```

### Phase 1.5: Contract, Schema, Security, And Outbox Gate

- [ ] Create `pipeline_repositories` or extend `repo_tribe_map` with:

```text
repository
tribe
repo_type
system_id
service_id
pipeline_kind
pipeline_version
source_manifest
is_active
```

- [ ] Extend `workflow_runs` and `workflow_jobs` or add views with:

```text
repo_type
system_id
service_id
pipeline_kind
pipeline_version
failure_category
gate_name
gate_category
gate_outcome
```

- [ ] Add first-class promotion storage before promotion metrics:

```text
pipeline_promotions
promotion_id
repository
tribe
environment
run_id
run_attempt
state=requested|pr_created|approved|merged|deploy_started|deploy_succeeded|deploy_failed|reverted|cancelled
actor
evidence_url
created_at
updated_at
```

- [ ] Add an idempotent export outbox:

```text
control_tower_export.cicd_event_outbox
event_key
event_type
source_table
source_id
payload_hash
payload
status=pending|publishing|accepted|retrying|dead_lettered|cancelled
attempt_count
next_retry_at
accepted_at
dead_lettered_at
last_error_code
last_error_message
apicenter_response
replay_owner
created_at
updated_at
```

- [ ] Add unique keys so webhook retries and sync backfills cannot export duplicate events.
- [ ] Add RLS/read policies or API-scope tests for every new table/view before exposing dashboard routes.
- [ ] Add Zod schemas and mapper tests for webhook payloads, GitHub API sync payloads, CI/CD event payloads, repo types, failure categories, and gate taxonomy.
- [ ] Add payload redaction fixture tests and serialized byte-size tests before SDK publishing.
- [ ] Add audit events for repo mapping changes, outbox enqueue, SDK accepted/failed, replay, APICenter credential rotation, and reconciliation gaps.
- [ ] Add APICenter CI/CD event contract/catalog documentation for `cicd.workflow_run.*`, `cicd.workflow_job.completed`, and `cicd.pipeline_gate.failed` before live publishing.
- [ ] Add APICenter hardening task: validate `sourceServiceId` against services owned by the authenticated tribe, or explicitly record the Phase 1 risk that `sourceServiceId` is trusted producer input until enforcement lands.
- [ ] Add APICenter-side audit and metrics requirements for governed publish accepted, rejected, and Kafka-send-failed outcomes with `sourceTribeId`, `sourceServiceId`, topic, event type, and correlation ID.

Exit evidence:

```text
pipeline metadata schema exists
outbox unique event keys prevent duplicate exports
RLS/API access tests prove tribe-scoped reads
mapper fixture tests pass for workflow_run and workflow job data
payload redaction and byte-size tests pass
APICenter CI/CD event contract reviewed
APICenter sourceServiceId enforcement decision recorded
```

### Phase 2: SDK Publishing From Control Tower

- [ ] Confirm Control Tower CI/runtime uses Node 24, matching the SDK engine range.
- [ ] Add GitHub Packages install configuration for `@implementsprint/sdk@1.2.1` or newer in `control-tower`; keep package-read auth separate from APICenter runtime auth.
- [ ] Add server-only APICenter env vars:

```text
APICENTER_URL
APICENTER_TRIBE_ID=cicd
APICENTER_SERVICE_ID=control-tower
APICENTER_TRIBE_SECRET
```

- [ ] Add a server-only SDK client wrapper.
- [ ] Fail startup/config validation when `APICENTER_SERVICE_ID` is missing or not equal to `control-tower`.
- [ ] Add a pipeline event mapper from normalized Control Tower records to the CI/CD event contract.
- [ ] In the GitHub webhook path, persist and enqueue only; do not call APICenter before returning to GitHub.
- [ ] Add a cron/worker/server action that drains `control_tower_export.cicd_event_outbox`, calls `publishTribeEvent()`, records retries with backoff, and dead-letters poison messages.
- [ ] Make the outbox own durable retry behavior: retry 429 using retry-after, retry network and 5xx failures, and dead-letter 4xx validation, auth, and topic-policy failures unless operator action changes the cause.
- [ ] Publish run completion events from outbox rows after `workflow_runs` and `deployments` upsert successfully.
- [ ] Publish job completion events from outbox rows after job backfill or job webhook ingestion.
- [ ] Add admin-only replay for dead-lettered sanitized records with deterministic duplicate-safe behavior.
- [ ] Add tests that prove SDK publish payloads do not contain secrets or raw logs.
- [ ] Add SDK wrapper tests proving `publishTribeEvent()` uses logical topic `tribe.cicd.events`, `sourceServiceId=control-tower`, and no per-affected-tribe secret.

Exit evidence:

```text
Control Tower receives GitHub workflow_run
Control Tower writes Supabase normalized row
Control Tower enqueues one deterministic outbox row
worker publishes SDK event from outbox
APICenter returns accepted=true
APICenter audit/metrics show governed publish accepted
bounded live smoke creates or observes S3 object under prod.tribe.cicd.events
Bronze query sees publisher_tribe_id=cicd and source_service_id=control-tower
```

### Phase 3: Reusable Workflow Contract For All Repo Types

- [ ] Standardize frontend caller metadata and gate names.
- [ ] Standardize backend caller metadata and gate names.
- [ ] Standardize mobile caller metadata and gate names.
- [ ] Publish a contract document for required caller inputs and emitted telemetry dimensions.
- [ ] Add a validation step in each reusable workflow that fails when required metadata is missing.
- [ ] Add a gate normalization registry that maps workflow/job names to `gate_name`, `gate_category`, and required/optional status for FE/BE/mobile.
- [ ] Add fixture validation for representative frontend, backend, and mobile workflow payloads before dashboard comparison.
- [ ] Ensure dry-run, deploy, and promotion flags are recorded consistently.
- [ ] Ensure workflow names are stable enough for Control Tower analytics.

Exit evidence:

```text
frontend pilot emits all required dimensions
backend pilot emits all required dimensions
mobile pilot emits all required dimensions
Control Tower classifies all pilot gates without manual cleanup
gate normalization fixtures pass for FE/BE/mobile
```

### Phase 4: Analytics Data Model

- [ ] Keep existing Control Tower operational tables for UI speed:

```text
workflow_runs
workflow_jobs
deployments
repo_tribe_map
policy_rules
audit_events
alert_rules
notifications
```

- [ ] Add or model curated analytics tables/views:

```text
pipeline_repositories
pipeline_runs
pipeline_jobs
pipeline_gate_results
pipeline_promotions
pipeline_failure_facts
pipeline_export_attempts
pipeline_daily_slo
```

- [ ] In Bronze, derive:

```text
source_topic=prod.tribe.cicd.events
source_system=github-actions
environment
affected_tribe_id
repo_type
repository
workflow_name
run_id
run_attempt
job_id
gate_name
event_type
status
duration_seconds
occurred_at
```

- [ ] In Silver, build one table per concern:

```text
silver_cicd.pipeline_runs
silver_cicd.pipeline_gates
silver_cicd.deployments
silver_cicd.failure_categories
silver_cicd.repository_ownership
```

- [ ] In Gold, build dashboard-ready metrics:

```text
gold_cicd.tribe_delivery_health_daily
gold_cicd.repo_type_reliability_daily
gold_cicd.failure_hotspots_daily
gold_cicd.promotion_lead_time_daily
```

Exit evidence:

```text
Control Tower and BI agree on run counts by tribe
S3/Bronze counts reconcile with Control Tower Supabase counts
test events do not leak into prod Gold metrics
```

### Phase 5: Metrics, Policies, And Alerts

- [ ] Track DORA-style metrics by tribe and repo type: deployment frequency, lead time, change failure rate, and MTTR.
- [ ] Track pipeline-specific metrics: success rate, gate duration, queue time, rerun rate, flake rate, promotion lag, and skipped-gate rate.
- [ ] Track platform reliability metrics: webhook latency, backfill lag, SDK publish success rate, S3 arrival lag, Bronze freshness, and export dead-letter count.
- [ ] Add policies for blocked environments, missing summaries on failed runs, missing metadata, and unsafe promotion.
- [ ] Add alert rules for low success rate, repeated gate failure, stale S3 export, and missing workflow ingestion.
- [ ] Add alert instance deduplication, cooldown windows, minimum sample sizes, severity thresholds, and suppression windows for backfills or maintenance.

Exit evidence:

```text
tribe dashboard answers the north star question
platform dashboard shows ingestion/export health
alerts fire for real failures and stay quiet for healthy runs
```

### Phase 6: Rollout By Tribe And Repo Family

- [ ] Pilot with one frontend repository.
- [ ] Pilot with one backend repository.
- [ ] Pilot with one mobile repository.
- [ ] Backfill at least 30 to 90 days for pilot repos.
- [ ] Reconcile GitHub API counts, Control Tower rows, SDK accepted events, S3 raw objects, and Bronze rows.
- [ ] Onboard the next tribe only after the previous tribe has clean mapping, clean gate classification, and S3 evidence.
- [ ] Keep future or non-provisioned systems out of active scope until they have a registered owner, repo map, and APICenter topic/export path.

Exit evidence:

```text
pilot tribe has FE/BE/mobile coverage
all pilot pipeline events appear in Control Tower and S3
tribe lead can explain blocked changes from the dashboard
platform can prove S3 export health from evidence links
```

### Phase 7: Hardening And Cost Control

- [ ] Add daily reconciliation between GitHub Actions API, Control Tower Supabase, APICenter accepted events, S3 objects, and Bronze tables.
- [ ] Add dead-letter replay for SDK publish failures.
- [ ] Add export cost reporting by topic, tribe, and repo type.
- [ ] Review retention and lifecycle policy after pilot data volume is known.
- [ ] Implement management read APIs or operator input flows for connector task state, ACL/DLQ evidence, S3 object observation, and Bronze observation if those are still manual after the pilot.
- [ ] Design APICenter delegated publishing only if physical per-affected-tribe CI/CD topics become mandatory; this is outside the first rollout.

Exit evidence:

```text
daily reconciliation report has no unexplained gaps
dead-letter replay has an owner and runbook
cost dashboard separates ingestion, storage, transform, and BI costs
```

## Acceptance Criteria

- Control Tower can answer the north star question per tribe, repo type, environment, and time window.
- Frontend, backend, and mobile pipelines use the same telemetry dimensions.
- Every repository is explicitly mapped to a tribe and repo type.
- Control Tower writes operational rows before it publishes analytics events.
- Control Tower enqueues idempotent outbox records before a worker publishes analytics events.
- SDK publish failures do not break GitHub webhook ingestion.
- Control Tower has no AWS S3 writer credentials and no Confluent writer credentials.
- APICenter accepts Control Tower pipeline events through the governed SDK path.
- `cicd` exists as the authenticated APICenter principal, and `control-tower` exists as the owned producer service.
- Control Tower publishes logical topic `tribe.cicd.events`; APICenter/Confluent verification proves the physical `prod.tribe.cicd.events` output.
- S3 raw objects appear under the expected `prod.tribe.cicd.events` topic prefix.
- Bronze/Silver/Gold analytics can reconcile counts back to Control Tower.
- Per-tribe dashboard visibility is enforced through Control Tower access rules and analytics filters.
- New Control Tower pipeline tables have RLS policies or API tests proving tribe-scoped reads.
- CI/CD event payloads pass byte-size and redaction fixture tests.
- Downstream analytics uses `affected_tribe_id` for business slicing while preserving `publisher_tribe_id=cicd` for lineage.

## Open Design Questions

1. Should `repo_type` live only in Control Tower, or should every repo carry a checked-in `.apicenter/pipeline.json` manifest? Preferred default: manifest plus Control Tower override table.
2. Should workflow job data come from GitHub `workflow_job` webhooks, scheduled backfill, or both?
3. Do we need first-class promotion records now, or can deployment rows plus audit events cover the first rollout?
4. Is `prod.tribe.cicd.events` enough for raw CI/CD telemetry after the pilot? Physical per-affected-tribe topics are deferred until APICenter has delegated publishing and audit policy.
5. Which BI surface is authoritative for Gold metrics: Control Tower, PowerBI, Databricks SQL, or another dashboard layer?

## First Implementation Slice

Start small and prove the path end to end:

- [ ] Apply or verify the Control Tower Supabase schema in the target environment.
- [ ] Configure the deployed Control Tower server env required for Supabase admin access, GitHub webhook verification, ingestion sync, and GitHub API reads.
- [ ] Configure one backend pilot repo webhook for `workflow_run` events.
- [ ] Run one pilot workflow and verify `github_webhook_events`, `workflow_runs`, `deployments`, and `/api/workflow-runs` all show the same status.
- [ ] Run the workflow sync endpoint and verify `workflow_jobs` plus `/api/workflow-jobs` show job/gate status for the same run.
- [ ] Create Control Tower domain schemas and temporary `public` compatibility views before adding new pipeline/export tables.
- [ ] Register or verify root APICenter principal `cicd` and Secret Manager secret `api-center-tribe-secret-cicd`.
- [ ] Register `control-tower` as a service owned by `cicd`.
- [ ] Verify `cicd` token includes `external:kafka:write`.
- [ ] Provision/include `test.tribe.cicd.events` and `prod.tribe.cicd.events`.
- [ ] Add `pipeline_repositories` / metadata mapping for one backend pilot repo.
- [ ] Add `control_tower_export.cicd_event_outbox` with idempotent unique event keys.
- [ ] Add SDK install/runtime config to Control Tower with separate package-read and APICenter runtime auth.
- [ ] Enqueue only `cicd.workflow_run.completed` for one backend pilot repo.
- [ ] Publish from the worker/cron outbox drain.
- [ ] Verify Control Tower row, outbox accepted state, APICenter accepted response, S3 object/key, and Bronze count.
- [ ] Add one frontend pilot and one mobile pilot only after the backend pilot is clean.
