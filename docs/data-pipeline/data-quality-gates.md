# APICenter Data Quality Gates

This checklist defines the gates a tribe event must pass before it is trusted
for BI, Gold metrics, or platform decision feedback. It applies to both `test`
and `prod`.

## Gate Order

| Gate | Layer | Owner | Required evidence |
| --- | --- | --- | --- |
| 1 | Topic ownership | APICenter/platform | Owner tribe, environment, and physical topic approval |
| 2 | Event schema | APICenter/platform plus owner tribe | Approved `event_type`, `schema_version`, compatibility status |
| 3 | Publish contract | Tribe service | SDK publish includes `sourceServiceId`, correlation id, event metadata |
| 4 | Gateway decision | APICenter/platform | Allowed/denied decision event with caller and target identity |
| 5 | Raw landing | APICenter/platform | S3 object exists under the expected physical topic prefix |
| 6 | Bronze parse | APICenter/platform | Athena query returns parsed rows, no environment leakage |
| 7 | Common Silver | APICenter/platform | Normalized fields for lineage, cost, decision, and landing status |
| 8 | Tribe Silver | Owner tribe with platform guardrails | Tribe-specific data product SQL passes dry-run and approval |
| 9 | Gold | Platform or approved tribe owner | Metric definition, freshness, and reconciliation evidence |
| 10 | BI handoff | Platform plus BI owner | Scoped access, refresh cadence, scan budget, report owner |

## Required Checks

### Topic Ownership

- Physical topic format is `<environment>.tribe.<ownerTribeId>.events`.
- Environment is either `test` or `prod`.
- Microservice identity stays in payload or metadata, not in the topic name.
- Topic is present in `infra/aws-data-pipeline/topic-projection-values.txt`.
- Topic projection SQL includes the same physical topic list.

Run:

```powershell
npm run check:data-pipeline-projection
```

### Event Schema

- `event_type` is registered for the owner tribe and environment.
- `schema_version` is present.
- Backward compatibility is approved before prod rollout.
- Required lineage fields are present:
  `request_id`, `correlation_id`, `source_service_id`, `owner_tribe_id`,
  `environment`, and `occurred_at`.

### Publish Contract

- SDK publish succeeds without bypassing APICenter governance.
- Event metadata has `sourceServiceId`.
- Payload environment matches the physical topic prefix.
- Test data uses `test.*` topics and prod data uses `prod.*` topics.

### Gateway Decision

- Gateway emits a decision signal for allowed and denied calls.
- Decision includes caller, target, route, policy result, timestamp, and
  correlation id.
- Denied calls are traceable even when no downstream event is emitted.

### Raw Landing

- Raw S3 prefix follows:
  `s3://api-center-raw-data/topics/<physical_topic>/year=<yyyy>/month=<mm>/day=<dd>/`.
- Raw object count is greater than zero for the validation window.
- No prod object appears under a test topic and no test object appears under a
  prod topic.

### Bronze Parse

- Athena query over Raw succeeds.
- Required columns are not null for the validation window.
- Rows with parse errors are counted and triaged.
- Duplicate event ids are counted.
- Late events are counted and bounded.

### Common Silver

- Normalized fields are populated for the north-star question:
  caller, target, decision, cost, landing location, source service, owner tribe,
  and event type.
- Common Silver contains shared platform facts only.
- Tribe-specific fields remain in Tribe Silver unless approved for platform
  metrics.

### Tribe Silver

- Generated SQL is reviewed before applying.
- Source comes from approved Common Silver or approved Bronze inputs.
- Dataset owner and steward are recorded.
- Dataset does not expose another tribe's private events.

### Gold

- Metric definition exists in `metric-dictionary.md` or a linked approval.
- Freshness target is documented.
- Count reconciliation is recorded from Raw/Bronze/Silver to Gold.
- BI refresh cadence and scan budget are approved.

## Test And Prod Evidence

Keep evidence separate by environment:

| Evidence | Test | Prod |
| --- | --- | --- |
| Topic approval | Required before connector update | Required before connector update |
| Schema approval | Required before test publish | Required before prod publish |
| Raw landing | Required before Bronze validation | Required before Gold/BI |
| Bronze parse | Required before Common Silver | Required before Common Silver |
| BI handoff | Allowed for buildout | Allowed only after access approval |

## Failure Handling

| Failure | Action |
| --- | --- |
| Topic missing from projection | Add topic, rerun projection drift check, update Athena SQL |
| Sink missing topic | Update managed Confluent S3 Sink connector and record evidence |
| Raw object missing | Verify publish path, connector status, and S3 prefix |
| Parse error spike | Quarantine affected event type and fix schema/publisher |
| Environment leakage | Block BI handoff and investigate publisher/topic routing |
| Common Silver mismatch | Hold Gold promotion and reconcile Raw/Bronze counts |
| Scan cost exceeds budget | Narrow partitions, materialize Gold, or lower refresh cadence |

## Promotion Criteria

A dataset can move from validation to recurring BI only when:

- all gates through the required dataset layer pass;
- evidence is captured for the target environment;
- access is scoped to the owner tribe or approved platform audience;
- the report owner accepts the refresh cadence and scan budget;
- the platform can trace the report back to physical topic, schema version,
  source service, and S3 landing location.

## Automation Backlog

1. Add a scheduled data-quality job that writes gate results to Gold.
2. Add a management UI panel for topic onboarding state records.
3. Block BI handoff when freshness or environment-isolation checks fail.
4. Add duplicate-event and late-event thresholds per event type.
5. Add automatic report inventory checks for stale or unowned BI assets.
