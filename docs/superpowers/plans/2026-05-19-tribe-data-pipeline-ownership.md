# Tribe Data Pipeline Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep APICenter aligned on how tribes move from not being in S3 to using the shared analytics/data-visualization pipeline without fragmenting ownership across multiple unmanaged tribe pipelines.

**Architecture:** APICenter remains the governed control plane for tribe and shared-service events. The platform owns the common Confluent-to-S3, Glue/Athena, and Databricks foundation; tribes own their event semantics, business transformations, and domain dashboards. Tribes that are not in S3 yet are onboarded through a repeatable platform lane instead of building separate pipelines by default.

**Tech Stack:** APICenter SDK, NestJS API Center, Confluent Cloud Kafka, Confluent S3 Sink Connector, AWS S3, AWS Glue Data Catalog, Amazon Athena, Databricks Bronze/Silver/Gold layers, PowerBI or another BI surface.

---

## Alignment Decision

Do not make every tribe own a complete S3-to-visualization pipeline by default.

Use this operating model instead:

```text
Platform owns the highway.
Tribes own the cargo.
```

The platform owns the shared ingestion, storage, governance, and analytics infrastructure. Tribes own the domain event design, business meaning, and tribe-specific reporting logic.

This avoids:

- each tribe needing Confluent or AWS S3 credentials
- duplicate Glue crawlers, Athena databases, Databricks jobs, and BI datasets
- inconsistent retention, access control, redaction, and cost guardrails
- cross-tribe dashboards that cannot compare data because each tribe modeled it differently

## Required Boundary

All tribe-owned events that should land in S3 must flow through APICenter:

```text
tribe backend
  -> @implementsprint/sdk publishTribeEvent()
  -> APICenter /api/v1/kafka/publish
  -> APICenter auth, scope, topic, and tenant policy checks
  -> Confluent Cloud topic
  -> Confluent S3 Sink Connector
  -> s3://api-center-raw-data/topics/<physical-topic-name>/...
  -> Glue/Athena validation
  -> Databricks Bronze
  -> tribe/common Silver and Gold
  -> BI/dashboard/API
```

Tribes do not receive:

- Confluent producer credentials
- Confluent Cloud management credentials
- AWS S3 writer credentials
- direct write access to the raw lake

## Ownership Matrix

| Area | Owner | Notes |
| --- | --- | --- |
| APICenter registration, `consumes`, scopes, lifecycle gate | Platform | Required before SDK calls or governed publish are accepted. |
| Topic naming rules and tenant boundary | Platform | Base tenant topic is `tribe.<ownerTribeId>.events`; runtime may publish to prefixed physical topics such as `prod.tribe.<ownerTribeId>.events`. Microservices do not get separate topics by default. |
| Confluent topic creation | Platform | Can be automated through `apicenter-management`; manual Confluent UI is fallback only. |
| S3 Sink topic inclusion | Platform | Platform updates the managed connector topic list. |
| Raw S3 bucket and object layout | Platform | One governed raw lake unless compliance requires isolation. |
| Glue Data Catalog and crawlers | Platform | Shared catalog keeps raw and curated discovery consistent. |
| Athena validation queries | Platform | Used to prove raw counts, redaction, and per-tribe data arrival. |
| Databricks workspace and shared jobs | Platform | Platform owns infrastructure, schedules, cluster/job guardrails, and common ingestion. |
| Bronze tables | Platform | Bronze preserves raw event fidelity with ingestion metadata. |
| Common Silver standards | Platform | Common fields include `event_id`, `event_type`, `tribe_id`, `source_service_id`, `event_timestamp`, `source_topic`, `correlation_id`, and ingestion metadata. |
| Tribe domain event schema | Tribe | Tribe defines events such as `order.created`, `booking.completed`, or `student.enrolled`. |
| Tribe-specific Silver models | Tribe, with platform templates | Tribe validates business rules and data semantics. |
| Shared Gold metrics | Platform | Cross-tribe usage, reliability, export health, and shared-service analytics. |
| Tribe Gold metrics | Tribe, with platform review | Tribe-specific KPIs and business aggregates. |
| Shared data visualization workspace | Platform | Platform provides access, refresh, naming, and governance. |
| Tribe dashboard pages/KPIs | Tribe | Tribe owns definitions and signs off on correctness. |

## Tribe S3 Onboarding States

Track every owner tribe through these states. A tribe that is not in S3 starts
at `Not configured`.

The state boundary is the owner tribe topic, not an individual microservice. A
registered microservice such as `logistics-orders` with `ownerTribeId=logistics`
publishes to `tribe.logistics.events` and is attributed with
`sourceServiceId=logistics-orders`. Management may show the contributing
microservices under the tribe topic, but it must not create a separate S3
onboarding state or Confluent topic for each microservice by default.

| State | Meaning | Required Evidence To Exit |
| --- | --- | --- |
| `Not configured` | Tribe is registered or planned, but no governed event export is set up. | Tribe has a confirmed need to publish business events to S3 and a named tribe event owner. |
| `Data classification ready` | Tribe has described event types and data risk before platform enables export. | Event owner, data steward, event purpose, data classification, PII fields, redaction/tokenization method, allowed consumers, retention tier, and expected volume are recorded. |
| `Policy ready` | Tribe has APICenter registration, `external:kafka:write`, approved tenant topic name, access group, and quota. | Manifest or registry diff, token-scope confirmation, topic resolver output, access group, quota, and classification approval are recorded. |
| `Topic provisioned` | Confluent topic exists for the tribe. | Physical topic name, Confluent topic ID/name, environment, partition count, retention, and provisioning actor are recorded. |
| `Sink included` | Managed S3 Sink connector includes the tribe topic. | S3 Sink config snapshot contains the physical topic, connector state is healthy or restarting as expected, and connector ACL requirements are satisfied. |
| `Publishing` | Tribe backend calls `publishTribeEvent()` through the SDK. | SDK response returns `accepted: true`, APICenter audit/log entry exists, and latest accepted publish timestamp is recorded. |
| `Publishing but not flushed` | Events are accepted, but S3 output has not appeared within the normal connector flush window. | Connector lag, connector task state, topic message count, flush settings, and smoke-event volume are checked before declaring failure. |
| `Raw observed` | Confluent and S3 show delivered records. | Platform records Kafka message observation and exact S3 object path after connector flush. |
| `Bronze cataloged` | Raw records are available to Glue/Athena/Databricks Bronze. | Glue/Athena or Databricks Bronze validation query sees the expected `source_topic`, environment, event count, and latest event timestamp. |
| `Curated active` | Tribe or platform has Silver/Gold models and dashboard access. | Tribe signs off that curated metrics match domain expectations; approved readers, BI group, metric dictionary, and refresh schedule are recorded. |
| `Needs remediation` | The tribe/topic failed a required validation and can retry after fixes. | Blocking reason, owner, next action, retry window, and evidence link are recorded. |
| `Rejected` | The event export request is not approved. | Rejecting approver, reason, appeal path, and replacement recommendation are recorded. |
| `Blocked by exception` | The tribe requires a separate pipeline or nonstandard destination. | Approved exception request, expiry/review date, cost owner, and rejoin/rollback path are recorded. |

Every state transition must be auditable:

```text
service_id
owner_tribe_id
environment
previous_state
new_state
actor
approver
timestamp
evidence_link
blocking_reason
next_review_date
```

For tribe-owned microservices, the transition record is keyed by
`owner_tribe_id` and physical topic. `service_id` may be recorded as the
producer or management page context, but it must not create a separate topic
state when the producer is already under an owner tribe.

The management UI should show the current state, but the durable source of truth
must include state history so `Curated active` can be traced back to actual
platform and tribe approvals.

## Standard Onboarding Flow For Tribes Not In S3

Use this flow whenever a tribe asks to participate in the shared data visualization pipeline.

1. Confirm whether the tribe has business events worth exporting.
2. Complete data classification and retention review.
3. Confirm the owner tribe is registered in APICenter, and confirm any
   publishing microservice is registered with `ownerTribeId` pointing to that
   tribe.
4. Add or verify `external:kafka:write` for the tribe token scope.
5. Confirm the tenant topic:

```text
tribe.<ownerTribeId>.events
```

6. Resolve and provision the environment-specific physical topic:

```text
test.tribe.<ownerTribeId>.events
prod.tribe.<ownerTribeId>.events
```

7. Add the physical topic to the managed Confluent S3 Sink connector.
8. Give the tribe the SDK publishing contract, not provider credentials.
9. Tribe publishes a first smoke event through `publishTribeEvent()` with
   `sourceServiceId` set to the registered backend service ID when the producer
   is a microservice.
10. Platform validates APICenter logs, Confluent topic traffic, and S3 object creation.
11. Platform catalogs the raw topic into Bronze.
12. Tribe defines domain Silver/Gold models using platform templates.
13. Tribe and platform complete `Production Metrics Approval` before production reporting.

## Topic Resolver Contract

Use one topic resolver contract across SDK docs, APICenter, management tooling,
Confluent, S3, Glue/Athena, and Databricks.

Definitions:

| Term | Example | Owner | Notes |
| --- | --- | --- | --- |
| Owner tribe ID | `flow-ci` | Platform registry | Canonical lower-case tribe principal. For a microservice, this is `ownerTribeId`; for a legacy tribe principal, this is `serviceId`. |
| Source service ID | `flow-ci-api` | Platform registry | Registered backend service that produced the event. This is event attribution only and does not create a separate topic by default. |
| Logical tenant topic | `tribe.flow-ci.events` | Tribe publishes through SDK | Tribe code uses this base topic for all microservices owned by the tribe. |
| Environment prefix | `test` or `prod` | Platform runtime config | Comes from `KAFKA_TOPIC_PREFIX` or management environment config. |
| Physical topic | `prod.tribe.flow-ci.events` | Platform provisions in Confluent | APICenter producer and S3 Sink use this topic. |
| Raw S3 prefix | `s3://api-center-raw-data/topics/prod.tribe.flow-ci.events/` | Platform | Connector output path used for validation and discovery. |

Required decision:

```text
Tribe code publishes logical tenant topics.
APICenter applies the environment prefix when writing to Kafka.
Management provisions and includes the physical topic using the same resolver.
For tribe-owned microservices, the resolver uses `ownerTribeId ?? serviceId` as
the topic owner and records the actual producer as `sourceServiceId`.
Downstream data layers derive environment and tribe_id from source_topic.
```

Do not let one repo use an unprefixed topic while another repo provisions only
the prefixed topic. If management, APICenter, SDK docs, or Databricks disagree
on the resolver, late-provisioned topics will not work reliably.

Canonical tribe/service ID normalization:

```text
1. trim whitespace
2. lowercase
3. replace characters outside [a-z0-9._-] with "-"
4. reject empty IDs
5. reject leading/trailing "." or "-"
6. reject consecutive dots if the provider or crawler cannot handle them
```

Acceptance examples:

| Input | Canonical ID |
| --- | --- |
| `Flow CI` | `flow-ci` |
| `FLOW_CI` | `flow_ci` |
| `flow.ci` | `flow.ci` |
| `flow-ci` | `flow-ci` |

Topic resolver tests must prove:

- `flow-ci` resolves to `tribe.flow-ci.events` as the logical topic.
- `prod` resolves to `prod.tribe.flow-ci.events` as the physical topic.
- `test` resolves to `test.tribe.flow-ci.events` as the physical topic.
- `serviceId=flow-ci-api` with `ownerTribeId=flow-ci` resolves to
  `tribe.flow-ci.events`, not `tribe.flow-ci-api.events`.
- `prod.api-center.audit.log` is not eligible as a tribe S3 export topic.
- `prod.tribe.other.events` is rejected for tribe `flow-ci`.
- only `tribe.<ownerTribeId>.events` and approved `api-center.shared.<serviceId>.events` export topics are eligible for S3 Sink inclusion.

Legacy service topic migration:

```text
old topic: tribe.<serviceId>.events
new topic: tribe.<ownerTribeId>.events
event attribution: governance.sourceServiceId = <serviceId>
```

When an existing microservice already has a service-specific topic, do not
delete it during the migration. Provision the owner tribe topic, include it in
the S3 Sink, update SDK producers to the owner tribe topic, and preserve the old
topic until retention, replay, and dashboard cutover are complete.

## Future Systems And Not-Yet-Provisioned Scope

Do not add a system, tribe, topic, Silver schema, Gold schema, or dashboard as
active scope before it is actually provisioned or approved through the state
machine.

For systems that are not provisioned yet:

- do not create active topic names in the S3 Sink
- do not create production Silver/Gold table names
- do not label dashboards as planned production deliverables
- do not add named system examples to this plan unless they are already part of
  the approved onboarding inventory

It is fine to keep a future candidate in a backlog or discovery note, but this
plan treats it as `Not configured` until classification, ownership, policy, and
topic provisioning are approved.

The pipeline must still be designed to support future systems through generic
fields:

```text
source_system
environment
source_topic
tribe_id
source_service_id
event_type
```

`source_system` is the platform-level grouping, such as the application or
program family that owns the event stream. It should be recorded in the topic
state record and carried into Bronze, Common Silver, and Gold. A future system
gets its own Silver/Gold only after it reaches the relevant onboarding gates and
has real event semantics to model.

## Gated Evidence And RACI

For controlled onboarding, the simple owner column is not enough. Use this RACI
for approval gates:

| Gate | Responsible | Accountable | Consulted | Informed | Evidence |
| --- | --- | --- | --- | --- | --- |
| Data classification ready | Tribe event owner | Platform data steward | Security/privacy owner | BI owner | Event catalog entry, classification, PII list, retention tier |
| Policy ready | Platform operator | Platform API owner | Tribe tech lead | Tribe product owner | Manifest/registry diff, scopes, topic resolver output, quota |
| Topic provisioned | Platform operator | Platform data-platform owner | Confluent admin | Tribe tech lead | Confluent topic name/ID, partition/retention settings |
| Sink included | Platform operator | Platform data-platform owner | Security owner | Tribe tech lead | Connector config snapshot, connector health, ACL check |
| Raw observed | Platform data engineer | Platform data-platform owner | Tribe tech lead | BI owner | Kafka count, S3 path, connector flush evidence |
| Bronze cataloged | Platform data engineer | Platform data-platform owner | Tribe event owner | BI owner | Athena/Bronze query output, `source_topic`, event count |
| Production Metrics Approval | Tribe domain owner | Tribe product owner and platform BI owner | Platform data steward | Platform operator | Metric dictionary, validation query, dashboard sign-off |

Production reporting cannot use a tribe Gold metric until `Production Metrics
Approval` is complete.

## Machine-Readable Topic State Record

Each physical topic needs one durable state record so management, runbooks, and
data jobs do not infer status from memory.

Required fields:

```text
service_id
canonical_service_id
owner_tribe_id
canonical_tribe_id
source_service_ids
environment
source_system
logical_topic
physical_topic
connector_name
s3_prefix
glue_database
glue_table
bronze_table
current_state
classification_tier
retention_tier
data_owner
data_steward
approved_reader_groups
publish_quota
event_size_limit
latest_accepted_publish_at
latest_kafka_observed_at
latest_s3_object_at
latest_bronze_observed_at
latest_bronze_count
curated_signoff_at
exception_status
failure_reason
next_review_date
```

Field meaning for tribe-owned microservices:

- `owner_tribe_id` / `canonical_tribe_id` are the visibility, topic, and S3
  onboarding boundary.
- `service_id` / `canonical_service_id` identify a registered producer only
  when the record is being viewed from a service detail page. They must not be
  used to derive a separate tribe event topic when `owner_tribe_id` is present.
- `source_service_ids` lists the registered microservices known to publish into
  the owner tribe topic. Event-level records still carry the single producing
  `sourceServiceId` in governance metadata.

State derivation should be deterministic:

| Inputs | Derived State |
| --- | --- |
| no classification record | `Not configured` |
| classification approved, but no scope/topic approval | `Data classification ready` |
| scope and resolver output approved, but topic missing | `Policy ready` |
| topic exists, but connector excludes it | `Topic provisioned` |
| connector includes topic, but no accepted publish | `Sink included` |
| accepted publish exists, but no S3 object after normal flush window | `Publishing but not flushed` |
| S3 object exists, but no Bronze observation | `Raw observed` |
| Bronze sees records, but no curated sign-off | `Bronze cataloged` |
| curated sign-off and approved BI access exist | `Curated active` |
| any required check fails with retry path | `Needs remediation` |
| request is denied | `Rejected` |
| separate pipeline waiver is active | `Blocked by exception` |

## Late-Provisioned Topics

Some tribe topics will not exist when the shared analytics pipeline is first
deployed. That is expected. Missing future topics do not change the ownership
model and do not require each tribe to build its own full pipeline.

For microservice additions inside an already onboarded tribe, do not create a
new late-provisioned topic by default. Add the microservice as another producer
under the existing owner tribe topic and use `sourceServiceId` for visibility,
lineage, and dashboard filtering.

Treat every late topic as a new onboarding instance:

```text
Not configured
  -> Data classification ready
  -> Policy ready
  -> Topic provisioned
  -> Sink included
  -> Publishing
  -> Raw observed
  -> Bronze cataloged
  -> Curated active
```

The shared pipeline must be designed to accept new topics after go-live:

- Confluent topic provisioning must be repeatable per tribe and per environment.
- The managed S3 Sink connector topic list must be updateable without rebuilding
  the whole pipeline.
- Raw S3 validation must check the exact physical topic path, for example
  `s3://api-center-raw-data/topics/prod.tribe.<ownerTribeId>.events/...`.
- Glue/Athena/Databricks discovery must have a refresh path for newly added
  topic folders.
- Bronze ingestion must include the new `source_topic` without changing the
  event ownership boundary.
- Common Silver should accept the topic once the base event envelope is valid.
- Tribe-specific Silver/Gold starts only after the tribe documents event
  semantics and signs off on the first curated metrics.

Do not block the first version of the shared analytics pipeline waiting for all
tribes to have topics. Launch with the topics that exist, then onboard later
tribes through the same state machine.

Do not create a tribe-owned full pipeline just because the topic is late. A
separate full pipeline is still an exception case and must meet the exception
criteria below.

## No-Code-Change Requirement For Future Tribes

Late-provisioned and additional tribes should pass through the shared pipeline
without application or pipeline code changes after the shared pipeline is
implemented.

This does not mean no action is required. It means onboarding a new tribe should
be an operational/configuration action:

```text
register tribe
  -> grant scope
  -> provision topic
  -> include topic in S3 Sink
  -> publish smoke event
  -> refresh discovery/catalog
  -> verify Bronze/Common Silver
  -> build or enable tribe Silver/Gold
```

The shared pipeline only satisfies this requirement if these conditions remain
true:

- APICenter Kafka governance accepts tenant topics by pattern, not by a
  hardcoded list of tribe IDs.
- `apicenter-management` can create a new Confluent topic and update the S3
  Sink connector topic list for that topic.
- The S3 Sink writes all included topics under a predictable topic folder such
  as `topics/prod.tribe.<ownerTribeId>.events/`.
- Glue/Athena discovery is folder-based or crawler-based, so a new topic folder
  can be picked up by a crawler or metadata refresh.
- Bronze ingestion reads from the shared raw topic root or from a configurable
  topic registry, not from a fixed list compiled into code.
- Bronze records always carry `source_topic`, so downstream logic can identify
  the late tribe without a schema change.
- Bronze and Common Silver preserve `source_service_id`, so a new microservice
  under an existing tribe can be visible without a new Kafka topic or job
  rewrite.
- Common Silver parses the shared event envelope and keeps the tribe-specific
  payload as data, not as new columns that require code changes per tribe.
- Tribe-specific Silver/Gold is attached through templates, configuration, or
  separately owned tribe models; it is not required for the shared raw/Bronze
  pipeline to continue working.

If any of those conditions are broken, late topics will still be possible, but
they will require a code or job change. That is a pipeline design bug for the
shared platform model and should be fixed before relying on broad tribe
onboarding.

Use this interpretation for alignment:

```text
"Without changes" = no APICenter code changes, no Databricks job rewrite, no
new separate tribe pipeline.

"With onboarding actions" = topic provisioned, S3 Sink config updated, metadata
refresh run, validation performed, and tribe-specific curated models enabled
when needed.
```

## Idempotent S3 Sink Update Contract

Adding a late-provisioned topic to the S3 Sink is a verified operation, not just
an append to a comma-separated topic string.

Required operation:

1. Read the current connector config.
2. Parse and normalize the existing topic list.
3. Reject ineligible topics such as `api-center.tribe.request`,
   `api-center.tribe.response`, `api-center.audit.log`, and `__*` unless a
   separate platform export decision explicitly allows them.
4. Preserve all existing connector settings.
5. Add the physical topic exactly once.
6. Apply the connector update.
7. Re-read connector config and verify the physical topic is present.
8. Verify connector/task state is healthy or in an expected restart window.
9. Verify service-account ACLs allow the connector to read the new topic.
10. Record the config snapshot and actor in the topic state record.

Idempotency requirements:

- Provisioning an already-existing topic is a no-op success.
- Including an already-included topic is a no-op success.
- Existing connector topics are preserved.
- Topic ordering is stable after normalization.
- Failed connector updates must not mark the state as `Sink included`.
- Concurrent operator updates must be detected or retried after a fresh config read.

Failure states:

| Failure | State | Required Action |
| --- | --- | --- |
| Connector config update rejected | `Needs remediation` | Record response body and retry after config/permission fix. |
| Connector includes topic but task is failed | `Needs remediation` | Check connector task logs and restart/repair connector. |
| Topic has messages but no S3 objects within flush window | `Publishing but not flushed` or `Needs remediation` | Check flush settings, task lag, task state, and smoke-event volume. |
| Topic accidentally removed from sink | `Needs remediation` | Re-add topic and verify no historical S3 data is deleted. |

## Discovery And Generic Bronze Contract

Late topics work only if discovery and Bronze ingestion are generic.

Required raw path pattern:

```text
s3://api-center-raw-data/topics/<physical-topic-name>/...
```

Required discovery behavior:

- One crawler or metadata refresh target must cover `s3://api-center-raw-data/topics/`.
- New folders under `topics/` must be discoverable without source-code changes.
- Dotted physical topic names must map to stable Glue/Athena table names or a
  documented raw-path query pattern.
- Discovery must record the physical topic, environment, table/path, refresh
  time, and row/object count in the topic state record.
- Athena validation must be parameterized by `physical_topic` or `s3_prefix`,
  not only by fixed shared-service table names.

Required Bronze behavior:

```text
bronze.tribe_events reads s3://api-center-raw-data/topics/*/
```

The Bronze job must:

- derive `source_topic` from the S3 path
- derive `environment` from the topic prefix such as `test.` or `prod.`
- derive `tribe_id` from `tribe.<ownerTribeId>.events`
- derive or preserve `source_service_id` from APICenter governance metadata when
  present, so microservice visibility does not require per-service topics
- preserve the raw event as `raw_record`
- add `source_file`, `ingested_at`, `event_date`, and checkpoint metadata
- quarantine malformed records instead of failing the whole job
- keep test and prod records separable so test events cannot leak into production dashboards
- avoid per-tribe Databricks job rewrites

If the implementation uses a topic registry instead of scanning the raw root,
the registry must be configuration/data, not a compiled list in job code.

## Data Governance, Access, Retention, And Cost Guardrails

Late tribes cannot move to `Policy ready`, `Sink included`, or `Curated active`
until governance fields are recorded.

Data classification requirements:

```text
event_owner
data_steward
event_purpose
classification_tier
pii_fields
redaction_or_tokenization_method
allowed_consumers
retention_tier
expected_daily_events
max_event_size_bytes
publish_quota
```

Read-access boundaries:

| Layer | Default Access |
| --- | --- |
| Raw S3 | Platform data operators only |
| Bronze | Platform data operators and controlled data engineering jobs |
| Common Silver | Platform plus tenant-filtered readers when approved |
| Tribe Silver | Owning tribe plus platform data operators |
| Gold | Approved BI groups only |
| BI dashboards | Named groups with access review |

Retention defaults must be documented per environment and layer:

| Layer | Test Default | Prod Default | Notes |
| --- | --- | --- | --- |
| Kafka topic | short operational retention | short operational retention | S3 is the durable lake, not Kafka. |
| Raw S3 | shorter lifecycle unless testing requires replay | business/reporting retention tier | Do not delete on routine deprovisioning. |
| Bronze | follows raw retention unless policy says otherwise | follows raw retention unless policy says otherwise | Supports replay/audit. |
| Silver | reporting retention | reporting retention | Derived data can be rebuilt from raw/Bronze. |
| Gold | dashboard/reporting retention | dashboard/reporting retention | Must match KPI and compliance needs. |
| Athena query results | 7 to 30 days | 7 to 30 days | Keep separate from raw data. |

Cost guardrails:

- per-tribe publish quotas
- max event size
- default topic partition count
- connector flush settings and object-size expectations
- Athena workgroup bytes-scanned limits
- Databricks job cluster policies
- Databricks concurrency caps
- BI refresh limits
- alerts for connector lag, failed jobs, high query scan, and quota breaches

## Tribe Event Classification And Redaction Contract

The tribe event contract must be as strict as the shared-service export
contract.

| Data Type | Allowed In Payload? | Required Handling |
| --- | --- | --- |
| Stable business IDs | Yes | Prefer opaque IDs over raw PII. |
| Amounts, statuses, timestamps | Yes | Use typed scalar values. |
| Email address | Only if approved | Hash/tokenize before publish unless explicitly approved. |
| Phone number | Only if approved | Hash/tokenize before publish unless explicitly approved. |
| Customer name | Avoid by default | Use customer ID or token unless reporting requires it. |
| SMS/email body | No | Do not publish. |
| OTP code | No | Do not publish. |
| OAuth token/code | No | Do not publish. |
| API keys, secrets, passwords | No | Do not publish. |
| Provider secret keys or webhook secrets | No | Do not publish. |

If hashing or tokenization is used, the plan/runbook must say who owns the salt,
key, or tokenization service and whether the token is reversible.

If automated enforcement is not implemented yet, label redaction as
`documented/manual review` and require a platform data steward sign-off before
production export.

## Metric Dictionary And Production Approval

Every production Gold metric must have a dictionary entry:

```text
metric_name
business_definition
formula
source_tables
filters
environment_filter
refresh_cadence
accountable_owner
validation_query
dashboard_url
signoff_date
review_date
```

Cross-tribe metrics are accountable to the platform BI/data owner. Tribe-domain
metrics are accountable to the tribe product/domain owner. A dashboard can be
used for exploration before sign-off, but it must not be labeled production
reporting until `Production Metrics Approval` is complete.

## Standard Tribe Event Contract

Every tribe-owned event published for S3 export must use this minimum shape through the SDK:

```ts
await apiCenter.publishTribeEvent({
  sourceServiceId: "registered-backend-service-id",
  key: "stable-domain-id",
  eventType: "domain.event_name",
  payload: {
    domainId: "stable-domain-id",
    status: "business-status",
    occurredAt: "2026-05-19T00:00:00.000Z"
  }
});
```

Use one APICenter tribe principal per owner tribe. If the backend service is
registered as `logistics-orders` and its `ownerTribeId` is `logistics`, the SDK
uses `APICENTER_TRIBE_ID=logistics`, publishes to `tribe.logistics.events`, and
sends `sourceServiceId=logistics-orders` for attribution.

Rules:

- `eventType` must be stable and versioned by convention when behavior changes, for example `order.created.v2`.
- `key` should be a stable business identifier such as order ID, booking ID, customer ID, or enrollment ID.
- `payload` must be an object.
- `payload` must not include API keys, provider secrets, OTP codes, OAuth tokens, raw SMS bodies, raw email bodies, or unnecessary raw PII.
- If PII is needed for analytics, hash or tokenize it before publishing.
- Tribes must document the meaning of each event type before Gold reporting depends on it.

## Platform Shared Pipeline Layers

### Raw S3

Platform-owned landing zone:

```text
s3://api-center-raw-data/topics/<physical-topic-name>/...
```

Raw S3 is the durable replay source. Do not let BI tools read raw S3 directly for production dashboards.

### Bronze

Platform-owned ingestion layer.

Required columns:

```text
source_topic
source_system
environment
source_file
source_partition
ingested_at
event_date
raw_record
event_id_or_key
event_type
tribe_id
source_service_id
```

Bronze keeps raw fidelity and supports replay.

Bronze is shared across current and future tribes. A late-provisioned tribe does
not get a separate Bronze job. Its records enter the same generic Bronze path
once the physical topic is included in the S3 Sink and raw objects arrive.

### Common Silver

Platform-owned standardization layer.

Required columns:

```text
event_id
event_type
tribe_id
source_service_id
source_system
environment
source_topic
correlation_id
event_timestamp
event_date
ingested_at
payload
metadata
schema_version
```

Common Silver normalizes the basics but does not guess domain-specific business meaning.

Common Silver is also shared across all current and future tribes. A new tribe
must appear in Common Silver through `source_topic`, `environment`, and
`tribe_id`, without a schema or job rewrite. Microservice-level filtering comes
from `source_service_id`, not from separate Common Silver tables.

Column derivation rules:

| Column | Source |
| --- | --- |
| `event_id` | event `eventId` if present, otherwise deterministic hash of `source_topic`, key, event type, source file, and source offset/path metadata |
| `event_type` | SDK `eventType` |
| `tribe_id` | APICenter governance metadata or derived from `source_topic` |
| `source_service_id` | APICenter governance `sourceServiceId` when present; defaults to `tribe_id` only for legacy tribe-principal producers |
| `source_system` | topic state record when present; otherwise derived from registry ownership for the physical topic |
| `environment` | prefix in `source_topic`, such as `test` or `prod` |
| `source_topic` | S3 path topic folder |
| `correlation_id` | APICenter governance metadata when present |
| `event_timestamp` | payload `occurredAt` or APICenter publish timestamp; fall back to ingestion time only with a quality flag |
| `event_date` | date derived from `event_timestamp` |
| `ingested_at` | Bronze ingestion timestamp |
| `payload` | original tribe payload, preserved as semi-structured data |
| `metadata` | SDK metadata plus APICenter governance metadata |
| `schema_version` | APICenter governed schema version or tribe event version |

Common Silver must include a quality/error column for records with missing
optional fields so the pipeline can continue while bad records are remediated.

### Tribe Silver

Tribe-owned semantic layer, built using platform templates.

Examples:

```text
silver_orders.order_events
silver_bookings.booking_events
silver_students.enrollment_events
```

The tribe owns the rules that convert raw events into domain facts. Each tribe
can have its own Silver models after its event semantics are documented and
approved. These models are optional at first: a late tribe can be present in
Raw, Bronze, and Common Silver before its tribe-specific Silver tables are
ready.

### Gold

Shared ownership.

Platform-owned Gold examples:

```text
gold.api_center_export_health_daily
gold.tribe_event_volume_daily
gold.shared_service_reliability_daily
gold.tribe_shared_service_usage_daily
```

Tribe-owned Gold examples:

```text
gold_orders.order_fulfillment_daily
gold_bookings.completed_booking_daily
gold_students.enrollment_funnel_daily
```

## Per-Tribe Data Products

The shared pipeline does not prevent each tribe from getting its own curated
data products. It separates common ingestion from domain-specific reporting:

```text
Raw S3
  -> bronze.tribe_events
  -> silver.common_tribe_events
  -> silver_<tribe>.<domain_tables>
  -> gold_<tribe>.<business_metrics>
  -> <Tribe> dashboard / BI dataset
```

Platform-owned shared data products:

```text
bronze.tribe_events
silver.common_tribe_events
gold.tribe_event_volume_daily
gold.api_center_export_health_daily
gold.shared_service_reliability_daily
```

Tribe-owned curated data products:

```text
silver_<tribe>.<domain_events>
gold_<tribe>.<business_metrics>
<Tribe> dashboard pages
<Tribe> BI datasets/views
```

Late-provisioned tribes follow the same path. They do not need a separate
pipeline, but they do need their own curated models when they want tribe-specific
reporting.

Example:

```text
prod.tribe.servease.events
  -> bronze.tribe_events
  -> silver.common_tribe_events
  -> silver_servease.booking_events
  -> gold_servease.booking_daily
  -> Servease dashboard

prod.tribe.campusone.events
  -> bronze.tribe_events
  -> silver.common_tribe_events
  -> silver_campusone.enrollment_events
  -> gold_campusone.enrollment_daily
  -> CampusOne dashboard
```

Do not create `bronze_<tribe>` by default. Per-tribe ownership starts at
semantic Silver and Gold, not at raw ingestion.

## Databricks Free Edition Boundary

Databricks Free Edition may be used only for prototype mode:

```text
sample S3 data
  -> notebook or serverless experiment
  -> sample Bronze/Silver/Gold tables
  -> demo dashboard or validation query
```

Prototype mode can prove:

- generic Bronze can derive `source_topic`, `environment`, and `tribe_id`
- Common Silver can normalize the shared envelope
- a tribe-specific Silver/Gold model can be created from the common layer
- a late-provisioned topic can be processed by the generic pattern

Prototype mode must not be treated as the production shared tribe analytics
platform. Production reporting for multiple tribes requires a production-grade
transform and BI layer: paid Databricks, or an AWS-native alternative such as
Glue/Athena/QuickSight or PowerBI over Athena/curated tables.

If the organization stays on Free Edition during early work, the plan status is:

```text
pipeline design validated, not production ready
```

## Exception Model

A tribe may own a separate full pipeline only when one of these conditions is true:

- strict regulatory isolation requires a separate account, bucket, or workspace
- the tribe already has a mature data platform team and must integrate APICenter events into its own lakehouse
- a client or compliance boundary forbids shared platform storage
- volume, residency, or blast-radius requirements justify a dedicated sink target

Even in exception cases, APICenter remains the governed publish path unless formally waived:

```text
tribe backend -> SDK/APICenter governance -> approved topic/sink target
```

The exception changes the destination and operating agreement. It does not make direct unmanaged Kafka/S3 writes the default.

Exception requests require a waiver record:

```text
requesting_tribe
request_owner
business_reason
technical_reason
target_destination_architecture
whether_APICenter_remains_publish_path
security_review_owner
data_classification
access_model
retention_policy
cost_owner
incident_owner
audit_obligations
expiry_or_review_date
rollback_or_rejoin_path
approvers
approval_date
```

Exception approvals must expire or be reviewed on a defined date. If a waiver
allows anything other than APICenter-governed publishing, that waiver must
explicitly name the risk accepted and the control that replaces APICenter
governance.

## Rollback And Deprovision Behavior

Removing a topic from the S3 Sink stops future export. It must not delete
historical S3 objects, Glue metadata, Bronze records, Silver records, Gold
records, or dashboards unless a separate retention/deletion approval exists.

Default deprovision flow:

1. Mark the topic state record `inactive` or `Needs remediation`, depending on reason.
2. Remove the topic from the connector only when future export should stop.
3. Preserve raw S3 and Bronze data according to retention tier.
4. Disable or label downstream Gold refresh if metrics should no longer update.
5. Keep metric dictionary and sign-off records for audit.
6. Record actor, timestamp, reason, and approval evidence.

## Implementation Tasks

### Task 1: Record This Alignment Plan

**Files:**

- Create: `api-center/docs/superpowers/plans/2026-05-19-tribe-data-pipeline-ownership.md`

- [x] Write the ownership decision.
- [x] Define platform-owned and tribe-owned responsibilities.
- [x] Define onboarding states for tribes not yet in S3.
- [x] Define the exception model.

### Task 2: Link This Plan From Existing Data Pipeline Docs

**Files:**

- Modify: `api-center/docs/confluent-cloud-s3-sink-setup.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `apicenter-management/docs/superpowers/plans/2026-05-15-analytics-pipeline-glue-athena-databricks-powerbi.md`

- [x] Add a short "Ownership Alignment" section to the Confluent/S3 setup doc linking to this plan.
- [x] Add a consumer-facing note to the SDK runbook explaining that tribes publish events but do not operate Confluent/S3/Glue/Databricks.
- [x] Add this plan as the prerequisite ownership model for the analytics pipeline plan.
- [x] Run:

```powershell
rg -n "tribe-data-pipeline-ownership|Ownership Alignment|Platform owns the highway" api-center api-shared-services apicenter-management
```

Expected result:

```text
At least one match in each linked document.
```

### Task 3: Add Management Visibility For Onboarding States

**Files:**

- Modify: `apicenter-management/src/lib/service-onboarding.ts`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`
- Test: `apicenter-management/src/lib/service-onboarding.test.ts`
- Test: `apicenter-management/src/components/tribe-onboarding-flow.test.tsx`

- [x] Add the S3 onboarding states from this plan to the onboarding model.
- [x] Show the current state for each owner tribe topic in the onboarding flow,
  using `ownerTribeId ?? serviceId` as the topic/state boundary.
- [x] For microservices under a tribe, show the contributing `serviceId` values
  as producers under the owner tribe topic instead of creating separate topic
  states.
- [x] Add the machine-readable topic state record fields needed by management.
- [x] Ensure the state derivation table is implemented from explicit inputs:
  `classificationApproved`, `hasScope`, `topicExists`,
  `s3SinkIncludesTopic`, `lastAcceptedPublishAt`, `latestS3ObjectAt`,
  `latestBronzeObservedAt`, `curatedSignoffAt`, `failureReason`, and
  `exceptionStatus`.
- [x] Ensure the state distinguishes `Data classification ready`,
  `Topic provisioned`, `Sink included`, `Publishing but not flushed`,
  `Raw observed`, `Bronze cataloged`, `Needs remediation`, `Rejected`, and
  `Blocked by exception`.
- [x] Show classification tier, retention tier, data owner, approved readers,
  quota status, last access review, exception status, next review date, owner
  tribe ID, and known source service IDs.
- [x] Add tests for every state and for partial/failure cases such as topic
  exists but S3 Sink check failed.
- [x] Add tests that `serviceId=logistics-orders` with
  `ownerTribeId=logistics` displays `tribe.logistics.events` as the pipeline
  state and `logistics-orders` only as source-service attribution.
- [x] Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- service-onboarding.test.ts tribe-onboarding-flow.test.tsx
```

Expected result:

```text
All selected tests pass.
```

### Task 4: Add Tribe Event Schema Documentation

**Files:**

- Create: `api-center/docs/data-pipeline/tribe-event-contract.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] Document the required `kafkaPublish()` shape.
- [x] Document event naming, stable keys, payload rules, field-level
  classification, and redaction requirements.
- [x] Include two domain examples: one transactional event and one lifecycle/status event.
- [x] Add a schema-review checklist with schema owner, semantic owner,
  compatibility policy, versioning rule, PII classification, expected volume,
  retention class, sample payload, and breaking-change approver.
- [x] Add accepted and rejected payload examples.
- [x] Link the contract from the consumer runbook.
- [x] Run:

```powershell
rg -n "tribe-event-contract|domain.event_name|kafkaPublish" api-center api-shared-services
```

Expected result:

```text
The new contract and consumer runbook references are found.
```

### Task 5: Add Analytics Layer Runbooks

**Files:**

- Create: `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`
- Create: `api-center/docs/data-pipeline/raw-to-bronze-runbook.md`
- Create: `api-center/docs/data-pipeline/silver-gold-ownership-runbook.md`

- [x] Document how platform validates raw S3 arrival.
- [x] Document how platform promotes records to Bronze.
- [x] Document the common Silver columns.
- [x] Document how tribes request or own tribe-specific Silver/Gold models.
- [x] Document the per-tribe data product path from `silver.common_tribe_events`
  to `silver_<tribe>.*`, `gold_<tribe>.*`, and tribe dashboard datasets.
- [x] Document that late-provisioned tribes enter shared Bronze/Common Silver
  first, then get tribe-specific Silver/Gold after event semantics are approved.
- [x] Document the sign-off point before dashboard metrics are treated as production reporting.
- [x] Include exact smoke event JSON, exact S3 path template, dynamic Athena
  validation query shape, expected Bronze/Common Silver columns, failure triage
  table, metric dictionary template, and sign-off artifact template.
- [x] Document crawler/metadata refresh behavior for new topic folders.
- [x] Document test/prod filtering rules so test records cannot appear in
  production dashboards.
- [x] Document that Databricks Free Edition is prototype-only and not the
  production shared tribe analytics platform.
- [x] Run:

```powershell
rg -n "Bronze|Common Silver|Tribe Silver|Gold|sign-off" api-center/docs/data-pipeline
```

Expected result:

```text
The runbooks describe each layer and ownership boundary.
```

### Task 6: Enforce No-Code-Change Topic Onboarding

**Files:**

- Modify: `apicenter-management/src/lib/server/confluent-cloud.ts`
- Modify: `api-center/src/kafka-governance/kafka-governance.service.ts`
- Modify: `apicenter-management/src/lib/event-topics.ts`
- Modify: `api-center/docs/data-pipeline/raw-to-bronze-runbook.md`
- Modify: `api-center/docs/data-pipeline/silver-gold-ownership-runbook.md`
- Test: `api-center/src/kafka-governance/kafka-governance.service.spec.ts`
- Test: `apicenter-management/src/components/confluent-provisioning-card.test.tsx`
- Test: `apicenter-management/src/lib/event-topics.test.ts`

- [x] Implement or document one shared topic resolver contract: tribe code uses
  logical topics, APICenter applies environment prefix, and management
  provisions/includes physical topics using the same prefix.
- [x] Make the resolver use `ownerTribeId ?? serviceId` for tribe-owned event
  topics, while preserving `serviceId` as `sourceServiceId` for producer
  attribution.
- [x] Add APICenter governance tests for `prod.tribe.flow-ci.events`,
  `test.tribe.flow-ci.events`, blocked `prod.api-center.audit.log`, and
  cross-tenant `prod.tribe.other.events`.
- [x] Add APICenter/SDK tests that a microservice using tribe principal
  `logistics` can publish to `tribe.logistics.events` with
  `sourceServiceId=logistics-orders`, and cannot publish to
  `tribe.logistics-orders.events` unless that service is itself the owner
  tribe.
- [x] Add canonical tribe/service ID normalization tests for `Flow CI`,
  `FLOW_CI`, `flow.ci`, and `flow-ci`.
- [x] Verify topic provisioning and S3 Sink inclusion are driven by owner tribe
  ID and environment prefix, not by a hardcoded allowlist or the microservice
  service ID.
- [x] Add tests proving a new tribe service ID can produce the expected topic
  name and S3 Sink operation without changing source code.
- [x] Add migration tests for legacy service topics:
  `tribe.<serviceId>.events` is preserved, `tribe.<ownerTribeId>.events` is
  provisioned/included, and producers can be switched after validation.
- [x] Add idempotency tests for existing topic no-op, already-included topic
  no-op, preserving existing connector topics, stable topic ordering, and
  failed connector update not reporting success.
- [x] Add S3 Sink eligibility tests so only `tribe.<ownerTribeId>.events` and
  approved `api-center.shared.<serviceId>.events` can be included.
- [x] Document the metadata refresh path that picks up a new S3 topic folder.
- [x] Document the Bronze ingestion rule that reads from the shared raw root or
  a configurable registry rather than a fixed topic list.
- [x] Document that Common Silver accepts new tribes through `source_topic` and
  `tribe_id`, accepts microservice attribution through `source_service_id`, and
  keeps tribe-specific Silver/Gold opt-in.
- [x] Split verification into two lanes: mocked CI tests that always run and
  live Confluent/S3 smoke tests gated by required environment variables.
- [x] Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- kafka-governance.service.spec.ts

cd C:\Codes\apic\apicenter-management
npm test -- confluent-provisioning-card.test.tsx event-topics.test.ts
```

Expected result:

```text
The tests pass and prove a newly provisioned tribe topic can be managed without
source-code changes.
```

### Task 7: Add Governance, RACI, And Exception Artifacts

**Files:**

- Create: `api-center/docs/data-pipeline/tribe-data-governance-checklist.md`
- Create: `api-center/docs/data-pipeline/pipeline-exception-request-template.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`

- [x] Create the RACI table for classification, policy, topic, sink, raw,
  Bronze, and production metric gates.
- [x] Create the data classification checklist.
- [x] Create the exception request template with approvers, expiry, cost owner,
  retention, access model, incident owner, audit obligations, and rejoin path.
- [x] Update the consumer runbook go-live checklist with classification,
  retention, access, quota, and production metric approval checks.
- [x] Run:

```powershell
rg -n "Data classification ready|Production Metrics Approval|Exception Request|retention tier|approved_reader" api-center api-shared-services
```

Expected result:

```text
The governance checklist, exception template, and consumer runbook all expose
the required gates.
```

### Task 8: Add Retention, Access, And Cost Controls

**Files:**

- Create: `api-center/docs/data-pipeline/retention-access-cost-controls.md`
- Modify: `api-center/docs/production-costing.md`

- [x] Document retention defaults per environment and layer.
- [x] Document read-access boundaries for Raw, Bronze, Common Silver, Tribe
  Silver, Gold, and BI dashboards.
- [x] Document per-tribe publish quotas, max event size, topic partition
  defaults, Athena workgroup limits, Databricks cluster policies, concurrency
  caps, BI refresh limits, and alert thresholds.
- [x] Link these controls from the production costing doc.
- [x] Run:

```powershell
rg -n "Athena workgroup|Databricks job cluster|publish quota|max event size|Raw S3|BI refresh" api-center/docs
```

Expected result:

```text
Retention, read-access, and cost guardrails are documented with concrete
operator terms.
```

### Task 9: Add Topic State Persistence And Audit History

**Files:**

- Modify: `apicenter-management/src/lib/service-onboarding.ts`
- Modify: `apicenter-management/src/lib/service-onboarding.test.ts`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`
- Modify: `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`

- [x] Define the topic state record shape from this plan.
- [x] Persist `owner_tribe_id`, `canonical_tribe_id`, `source_service_ids`,
  logical topic, and physical topic so the topic state can be rendered per
  tribe while still showing microservice producers.
- [x] Add state transition history fields: actor, timestamp, previous state,
  new state, approver, evidence link, blocking reason, and next review date.
- [x] Ensure state transition history is keyed by owner tribe topic, not by
  every microservice service ID.
- [x] Add tests that state history is preserved when moving from
  `Sink included` to `Publishing`, `Raw observed`, `Bronze cataloged`, and
  `Curated active`.
- [x] Add tests that adding another microservice under an already-onboarded
  tribe updates source-service attribution without resetting the tribe topic's
  onboarding state.
- [x] Document where the state record lives until a persistent database table
  is implemented.
- [x] Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- service-onboarding.test.ts tribe-onboarding-flow.test.tsx topic-onboarding-state-store.test.ts
```

Expected result:

```text
The management onboarding model can explain why a tribe is in its current state
and who approved the transition.
```

## Current Source Of Truth

This file and the `docs/data-pipeline/` runbooks are the alignment source of
truth for S3-to-data-visualization ownership.

Future agents should preserve these decisions unless the user explicitly changes the operating model:

- shared platform pipeline by default
- self-service tribe S3 onboarding through APICenter and management tooling
- no direct Confluent or AWS credentials for ordinary tribes
- no raw S3, Bronze, Common Silver, Gold, or BI read access without named group approval
- platform-owned Raw/Bronze/common Silver
- tribe-owned domain event semantics and tribe-specific Silver/Gold
- one event topic and one S3 onboarding state per owner tribe by default, with
  microservice producers attributed by `sourceServiceId`
- every tribe can receive its own Silver/Gold data products after shared
  ingestion and semantic approval, including late-provisioned tribes
- Databricks Free Edition is allowed only for prototype validation, not as the
  dependable production BI/transform platform for multiple tribes
- one shared topic resolver contract for logical and physical topics
- legacy service-specific topics can be preserved during migration, but the
  target topic for tribe-owned microservices is `tribe.<ownerTribeId>.events`
- not-yet-provisioned systems stay out of active scope until they pass the
  onboarding state machine
- late-provisioned topics use the same onboarding state machine and join the
  shared pipeline after topic, sink, raw, and Bronze validation
- late-provisioned topics must not require APICenter code changes or a
  Databricks job rewrite when the shared pipeline is implemented correctly
- exception-based separate pipelines only for hard isolation or mature tribe-owned data platform needs

## Verification Checklist

- [x] Every owner tribe has one visible S3 onboarding state.
- [x] Microservices under the same owner tribe share the owner tribe topic and
  are visible through `source_service_id` / `sourceServiceId`.
- [x] Late-provisioned topics can be added without rebuilding the whole analytics pipeline.
- [x] Late-provisioned topics require operational onboarding actions, not code or job rewrites.
- [x] No ordinary tribe receives Confluent or AWS S3 writer credentials.
- [x] Every S3-exported tribe event is published through APICenter governance.
- [x] Platform can verify Confluent topic traffic and S3 object arrival.
- [x] Bronze includes source topic, source file, ingestion time, event date,
  event type, tribe ID, and source service ID when available.
- [x] Common Silver does not define tribe-specific business metrics.
- [x] Common Silver supports microservice filtering through `source_service_id`
  without per-service tables.
- [x] Tribe-specific Silver/Gold models have tribe sign-off before dashboard use.
- [x] The topic resolver contract is tested across APICenter and management.
- [x] S3 Sink topic inclusion is idempotent, preserves existing connector topics, and verifies connector state.
- [x] Glue/Athena discovery can pick up a newly added topic folder.
- [x] Bronze ingestion reads from raw root or a data-driven topic registry, not a compiled topic list.
- [x] Test records are filtered out of production Silver/Gold/BI outputs.
- [x] Every Gold metric has a metric dictionary entry and production approval.
- [x] Any separate tribe-owned full pipeline is documented as an approved exception waiver with expiry, cost owner, and rejoin path.
