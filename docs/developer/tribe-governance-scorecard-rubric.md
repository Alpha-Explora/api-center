# Tribe Governance Scorecard Rubric

This rubric gives the governing tribe a consistent way to score every tribe's
APICenter adoption, delivery hygiene, governance compliance, and responsible use
of shared platform resources.

The scorecard is not meant to punish teams for temporary migration gaps. It is a
governance signal used to identify risk, prioritize support, approve production
access, and make cross-tribe operating standards visible.

## Scoring Model

Each tribe receives one score per category and one combined governance score.

| Score | Rating | Meaning |
| ----- | ------ | ------- |
| 5 | Leading | Tribe exceeds the platform standard and can be used as an example for others. |
| 4 | Healthy | Tribe meets the standard with only minor follow-up items. |
| 3 | Watch | Tribe is usable but has gaps that need an owner and target date. |
| 2 | At risk | Tribe has repeated gaps or weak evidence; production expansion should be limited. |
| 1 | Blocked | Tribe fails required controls or cannot provide evidence. |
| 0 | Not onboarded | Tribe has no usable evidence for the category. |

Recommended category weights:

| Category | Weight |
| -------- | -----: |
| CI/CD delivery readiness | 20% |
| APICenter governance compliance | 25% |
| Shared resource usage discipline | 15% |
| Data and event governance | 15% |
| Operational reliability | 15% |
| Collaboration and stewardship | 10% |

Combined score:

```text
combined_score =
  (cicd_score * 0.20) +
  (governance_score * 0.25) +
  (resource_score * 0.15) +
  (data_event_score * 0.15) +
  (reliability_score * 0.15) +
  (collaboration_score * 0.10)
```

## Score Bands

| Combined score | Status | Governance action |
| -------------- | ------ | ----------------- |
| 4.50 - 5.00 | Green / leading | Eligible for faster approvals and pilot programs. |
| 3.75 - 4.49 | Green / healthy | Normal production access and standard review cadence. |
| 3.00 - 3.74 | Yellow / watch | Keep access, but require a remediation plan for weak categories. |
| 2.00 - 2.99 | Orange / at risk | Limit new production expansion until critical gaps are closed. |
| 0.00 - 1.99 | Red / blocked | Block production promotion or new shared-service access until fixed. |

Any category scored `1` should trigger a remediation ticket even if the combined
score remains above `3.00`.

## Category 1: CI/CD Delivery Readiness

This category measures whether a tribe can reliably build, test, scan, deploy,
and promote services through the approved pipeline.

| Factor | Evidence | Score guidance |
| ------ | -------- | -------------- |
| Pipeline adoption | GitHub Actions, Control Tower, deployment records | `5`: all active repos publish normalized pipeline telemetry and use approved workflows; `3`: core repos use CI/CD but telemetry or repo coverage is partial; `1`: manual deployments or missing pipeline evidence. |
| Successful pipeline rate | Workflow run conclusions, deploy status, gate outcomes | `5`: high success rate with failures resolved quickly; `3`: recurring failed gates with visible owners; `1`: failures ignored or bypassed. |
| Required gates | Lint, test, build, security, deployment smoke | `5`: required gates are enforced for every promotion; `3`: gates exist but exceptions are manual; `1`: gates are missing or routinely skipped. |
| Promotion discipline | Test-to-prod promotion history, approval records | `5`: promotions follow approved environment flow with auditable approvals; `3`: occasional manual intervention with documented reason; `1`: direct unapproved production changes. |
| Timeliness | SLA for pipeline fixes and promotion requests | `5`: fixes and approvals happen within agreed windows; `3`: delays are visible but manageable; `1`: stale failures block consumers or shared services. |

Suggested CI/CD scoring:

```text
cicd_score = average(
  pipeline_adoption,
  pipeline_success_rate,
  required_gates,
  promotion_discipline,
  timeliness
)
```

## Category 2: APICenter Governance Compliance

This category measures whether the tribe follows APICenter control-plane rules
for registration, auth, scopes, quotas, lifecycle, and runtime access.

| Factor | Evidence | Score guidance |
| ------ | -------- | -------------- |
| Service registration | `/api/v1/registry/register`, `/api/v1/tribes`, `/api/v1/shared` | `5`: all services self-register with accurate manifests; `3`: registration works but metadata is incomplete; `1`: services depend on stale bootstrap entries. |
| Scope hygiene | Manifest `requiredScopes`, `exposes`, `consumes`, token scopes | `5`: least-privilege scopes match actual usage; `3`: scopes are broad but reviewed; `1`: over-broad or undocumented scopes. |
| Access approval | Approval ticket, owner, steward, allowed consumers | `5`: every shared-service or tribe-to-tribe dependency has approval evidence; `3`: approvals exist but are scattered; `1`: runtime usage has no approval trail. |
| Quota compliance | Observe/enforce quota policies, 429 behavior, usage review | `5`: quota policy is right-sized and reviewed; `3`: observe mode exists but needs tuning; `1`: usage exceeds policy or retries aggressively. |
| Lifecycle compliance | Health checks, service tier, readiness, deprecation state | `5`: lifecycle metadata is current and health behavior is reliable; `3`: some stale lifecycle metadata; `1`: production traffic routes to ungoverned or unhealthy services. |

Suggested governance scoring:

```text
governance_score = average(
  service_registration,
  scope_hygiene,
  access_approval,
  quota_compliance,
  lifecycle_compliance
)
```

## Category 3: Shared Resource Usage Discipline

This category measures whether the tribe uses shared services, provider-backed
resources, API quotas, and platform capacity responsibly.

| Factor | Evidence | Score guidance |
| ------ | -------- | -------------- |
| Declared vs actual usage | Management shared-service usage matrix | `5`: declared dependencies match runtime usage; `3`: some declared-but-unused or undeclared-but-used services; `1`: material undeclared usage. |
| Quota behavior | API Center quota decisions, retry metadata, SDK errors | `5`: traffic stays within approved policy and backs off correctly; `3`: occasional quota hits with follow-up; `1`: repeated quota exhaustion or retry storms. |
| Cost awareness | Provider usage, high-cost shared services, plan tier | `5`: tribe can explain cost-driving usage and requested tier; `3`: usage is visible but not actively managed; `1`: high-cost usage has no owner. |
| Resource cleanup | Unused service access, stale routes, old secrets | `5`: stale access and resources are removed during review; `3`: cleanup backlog exists; `1`: stale resources remain after repeated reminders. |
| Capacity planning | Expected daily events, max event size, publish quota | `5`: forecasts are provided before growth; `3`: estimates exist but lag real usage; `1`: unexpected spikes create platform risk. |

Suggested resource scoring:

```text
resource_score = average(
  declared_vs_actual_usage,
  quota_behavior,
  cost_awareness,
  resource_cleanup,
  capacity_planning
)
```

## Category 4: Data And Event Governance

This category measures whether the tribe publishes governed events and produces
trustworthy downstream data products.

| Factor | Evidence | Score guidance |
| ------ | -------- | -------------- |
| Event contract quality | Event schema, schema version, payload fixtures | `5`: contracts are versioned, tested, and backward compatible; `3`: contracts exist but need fixture coverage; `1`: events are unversioned or inconsistent. |
| Data classification | Classification tier, PII fields, retention tier, approved readers | `5`: classification is complete before production; `3`: classification exists but review date or owner is stale; `1`: sensitive fields are not classified. |
| Kafka governance | Logical topic, physical topic resolver, publish approval | `5`: publish path is approved and observed in the governance catalog; `3`: publish works but evidence is partial; `1`: direct or unmanaged publish path. |
| Raw-to-Gold observability | S3 raw observation, Bronze query, Silver/Gold validation | `5`: pipeline evidence exists at every layer; `3`: raw/Bronze exists but curated validation is pending; `1`: published data cannot be traced. |
| Metric approval | Metric dictionary, bounded validation query, BI sign-off | `5`: production metrics have steward and BI approval; `3`: metrics are usable but still provisional; `1`: metrics are labeled production without approval. |

Suggested data/event scoring:

```text
data_event_score = average(
  event_contract_quality,
  data_classification,
  kafka_governance,
  raw_to_gold_observability,
  metric_approval
)
```

## Category 5: Operational Reliability

This category measures whether the tribe operates services in a way that protects
consumers, shared services, and APICenter runtime health.

| Factor | Evidence | Score guidance |
| ------ | -------- | -------------- |
| Health and readiness | Health endpoint, readiness checks, service tier | `5`: health checks are accurate and service tier is current; `3`: health exists but misses dependencies; `1`: health is missing or misleading. |
| Error rate and latency | Gateway traffic, shared-service usage, provider usage | `5`: error and latency trends are within agreed thresholds; `3`: issues are known with active owners; `1`: repeated incidents without mitigation. |
| Incident response | Incident tickets, post-incident actions, owner response | `5`: incidents have clear owners, timelines, and follow-through; `3`: actions exist but are late; `1`: no usable incident record. |
| Secret and token hygiene | Secret Manager record, rotation timestamp, token scope | `5`: secrets are hashed/stored correctly and rotated on schedule; `3`: rotation is late but tracked; `1`: plaintext or unmanaged secrets are found. |
| Compatibility | SDK version, contract compatibility, deprecation handling | `5`: tribe upgrades before breaking changes; `3`: upgrades lag but are planned; `1`: old client behavior creates runtime risk. |

Suggested reliability scoring:

```text
reliability_score = average(
  health_readiness,
  error_latency,
  incident_response,
  secret_token_hygiene,
  compatibility
)
```

## Category 6: Collaboration And Stewardship

This category measures whether the tribe works well with the governing tribe,
platform operators, BI owners, security, and other consuming tribes.

| Factor | Evidence | Score guidance |
| ------ | -------- | -------------- |
| Ownership clarity | Owner team, contact, steward, escalation path | `5`: every service/data product has current owners; `3`: owners exist but escalation is unclear; `1`: no reliable owner. |
| Review participation | Governance review notes, approval comments, standup actions | `5`: tribe attends reviews and closes actions; `3`: participation is inconsistent; `1`: repeated no-response. |
| Consumer communication | Deprecation notices, change logs, migration notes | `5`: consumers receive timely, actionable updates; `3`: updates exist but are reactive; `1`: breaking changes arrive without notice. |
| Documentation quality | Handoff docs, runbooks, API contracts, examples | `5`: docs are current and usable by another tribe; `3`: docs exist but need maintenance; `1`: consumers rely on ad hoc support. |
| Support load | Repeated questions, unresolved handoff blockers | `5`: tribe reduces support load through good docs and ownership; `3`: some recurring support patterns; `1`: same blockers recur without correction. |

Suggested collaboration scoring:

```text
collaboration_score = average(
  ownership_clarity,
  review_participation,
  consumer_communication,
  documentation_quality,
  support_load
)
```

## Required Evidence Snapshot

Create one evidence snapshot per tribe per review period.

```text
review_period:
tribe_id:
reviewed_by:
review_date:

cicd:
  repos_reviewed:
  pipeline_success_rate:
  failed_required_gates:
  promotion_exceptions:
  evidence_links:

governance:
  registered_services:
  stale_bootstrap_entries:
  approved_dependencies:
  quota_policy_ids:
  lifecycle_gaps:
  evidence_links:

resource_usage:
  declared_unused_services:
  undeclared_runtime_usage:
  quota_exceeded_count:
  provider_cost_flags:
  cleanup_actions:
  evidence_links:

data_events:
  approved_event_contracts:
  classification_records:
  observed_raw_topics:
  validated_silver_gold_outputs:
  production_metric_approvals:
  evidence_links:

operations:
  health_check_gaps:
  incident_count:
  open_incident_actions:
  secret_rotation_gaps:
  sdk_version_gaps:
  evidence_links:

collaboration:
  owner_gaps:
  open_review_actions:
  consumer_notice_gaps:
  doc_gaps:
  recurring_support_items:
  evidence_links:
```

## Review Cadence

| Review type | Cadence | Purpose |
| ----------- | ------- | ------- |
| New tribe onboarding | Before first shared-service or Kafka production access | Confirm baseline eligibility. |
| Production promotion review | Before production promotion or material quota increase | Confirm CI/CD, governance, and operational readiness. |
| Monthly operating review | Monthly | Compare tribes, track trends, and close remediation actions. |
| Quarterly governance review | Quarterly | Revalidate access, owners, data classification, retention, and stale resources. |
| Incident-triggered review | After severity 1/2 incidents or repeated quota breaches | Decide whether access limits, remediation, or architecture changes are needed. |

## Remediation Rules

Use the following default actions unless the platform governance council approves
an exception.

| Condition | Default action |
| --------- | -------------- |
| Any category score is `1` | Open remediation ticket with owner and target date. |
| CI/CD score below `3` | Block new production promotion until pipeline gates are reliable. |
| Governance score below `3` | Freeze new access grants until registration, scopes, and approvals are corrected. |
| Resource score below `3` | Keep quotas in observe or reduce enforcement limits until usage is explained. |
| Data/event score below `3` | Do not label downstream data products as production metrics. |
| Reliability score below `3` | Require incident/action review before expanding traffic. |
| Collaboration score below `3` | Require named owner, escalation path, and documentation cleanup. |

## Example Tribe Scorecard

```text
tribe_id: admissions
review_period: 2026-06

cicd_score: 4
governance_score: 3
resource_score: 4
data_event_score: 3
reliability_score: 4
collaboration_score: 4

combined_score:
  (4 * 0.20) +
  (3 * 0.25) +
  (4 * 0.15) +
  (3 * 0.15) +
  (4 * 0.15) +
  (4 * 0.10)
  = 3.60

status: Yellow / watch
required_actions:
  - Complete missing access approval evidence for one shared-service dependency.
  - Add metric dictionary approval before labeling Gold output as production.
```

## Governance Interpretation

The governing tribe should treat the scorecard as an operating system for
platform trust:

- CI/CD score answers: can this tribe deliver changes safely and on time?
- Governance score answers: is this tribe correctly registered, authorized, and
  controlled through APICenter?
- Resource score answers: is this tribe using shared services, quotas, and
  provider-backed capacity responsibly?
- Data/event score answers: can other teams trust this tribe's events and
  metrics?
- Reliability score answers: will this tribe protect consumers during normal
  operations and incidents?
- Collaboration score answers: can other tribes work with this tribe without
  repeated manual escalation?

Use category scores to drive targeted remediation. Use the combined score only
for portfolio-level reporting across tribes.
