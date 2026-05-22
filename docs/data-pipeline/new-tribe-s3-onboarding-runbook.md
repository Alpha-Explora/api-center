# New Tribe S3 Onboarding Runbook

Use this runbook when an owner tribe needs business events exported through the
shared APICenter data pipeline.

The default path is:

```text
tribe backend
  -> @implementsprint/sdk publishTribeEvent()
  -> APICenter governance
  -> prod.tribe.<ownerTribeId>.events
  -> Confluent S3 Sink
  -> s3://api-center-raw-data/topics/prod.tribe.<ownerTribeId>.events/
  -> Glue/Athena/Databricks Bronze
```

Microservices do not get separate topics by default. They use the owner tribe
topic and set `sourceServiceId`.

## Required Inputs

```text
owner_tribe_id:
source_service_ids:
environment:
source_system:
event_owner:
data_steward:
classification_tier:
retention_tier:
approved_reader_groups:
publish_quota:
event_size_limit:
logical_topic: tribe.<ownerTribeId>.events
physical_topic: <environment>.tribe.<ownerTribeId>.events
connector_name:
s3_prefix:
```

## Onboarding Flow

1. Confirm the tribe event owner and data steward.
2. Complete the data classification checklist.
3. Confirm the tribe principal and any microservice registry entries.
4. Confirm token scope includes `external:kafka:write`.
5. Resolve the logical topic `tribe.<ownerTribeId>.events`.
6. Provision the physical topic, for example
   `prod.tribe.<ownerTribeId>.events`.
7. Add the physical topic to
   `infra/aws-data-pipeline/topic-projection-values.txt` and regenerate the
   Athena projection enum.
8. Run the projection drift gate before catalog apply.
9. Add the physical topic to the managed S3 Sink connector.
10. Publish a smoke event through the SDK.
11. Validate APICenter accepted the event.
12. Validate Confluent topic traffic.
13. Validate S3 object arrival after connector flush.
14. Refresh Glue/Athena or Databricks discovery.
15. Validate Bronze and Common Silver.
16. Start tribe-specific Silver/Gold only after event semantics are approved.

## Projection Drift Gate

Run this after adding a physical topic to
`infra/aws-data-pipeline/topic-projection-values.txt` and before applying the
Athena catalog:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\check-topic-projection-drift.ps1 `
  -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt `
  -ExpectedTopic <environment>.tribe.<ownerTribeId>.events
```

The gate fails if:

- the expected physical topic is missing
- `topic-projection-values.txt` is not sorted and unique
- the generated projection enum does not match
  `infra/aws-data-pipeline/catalog/raw-topic-tables.sql`
- a topic onboarding state file contains a `physical_topic` that is missing
  from the projection values
- live Confluent or S3 Sink topics are available and include managed topics not
  present in the projection values

For CI and offline validation without provider credentials:

```powershell
npm run check:data-pipeline-projection
```

For live connector comparison, provide the local test/prod env file. The script
uses Confluent connector config when `CONFLUENT_CLOUD_API_KEY`,
`CONFLUENT_CLOUD_API_SECRET`, `CONFLUENT_ENVIRONMENT_ID`,
`CONFLUENT_KAFKA_CLUSTER_ID`, and `CONFLUENT_S3_CONNECTOR_NAME` are present.
It can also use Kafka REST topic listing when `CONFLUENT_KAFKA_REST_ENDPOINT`,
`CONFLUENT_KAFKA_API_KEY`, and `CONFLUENT_KAFKA_API_SECRET` are present.

```powershell
.\scripts\data-pipeline\check-topic-projection-drift.ps1 `
  -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt `
  -ExpectedTopic test.tribe.logistics.events `
  -EnvFile ..\apicenter-management\.env.test
```

## Smoke Event

```json
{
  "sourceServiceId": "logistics-orders",
  "key": "smoke-logistics-orders-20260519",
  "eventType": "pipeline.smoke_test",
  "payload": {
    "smokeId": "smoke-logistics-orders-20260519",
    "ownerTribeId": "logistics",
    "sourceServiceId": "logistics-orders",
    "purpose": "s3-onboarding",
    "occurredAt": "2026-05-19T00:00:00.000Z"
  },
  "metadata": {
    "schemaVersion": "1",
    "classification": "internal"
  }
}
```

Expected SDK result:

```json
{
  "accepted": true,
  "topic": "tribe.logistics.events",
  "eventType": "pipeline.smoke_test"
}
```

## S3 Validation

Path template:

```text
s3://api-center-raw-data/topics/<environment>.tribe.<ownerTribeId>.events/...
```

Use the validator before cataloging:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\validate-s3-prefix.ps1 `
  -Bucket api-center-raw-data `
  -PhysicalTopic <environment>.tribe.<ownerTribeId>.events `
  -Profile apic
```

Record this evidence:

```text
physical_topic:
kafka_observed_at:
kafka_message_count:
s3_prefix:
latest_s3_object_at:
latest_s3_object_key:
connector_name:
connector_state:
connector_task_state:
actor:
evidence_link:
validator_command:
validator_output_link:
```

## Athena Validation

Parameterize by physical topic or S3 prefix:

```sql
SELECT
  '$physical_topic' AS physical_topic,
  COUNT(*) AS record_count,
  MAX(from_iso8601_timestamp(json_extract_scalar(raw_record, '$.payload.occurredAt'))) AS latest_event_timestamp
FROM api_center_raw.tribe_events_raw
WHERE source_topic = '$physical_topic';
```

If raw files are not yet normalized into a shared raw table, validate the exact
folder first:

```sql
SELECT COUNT(*)
FROM api_center_raw."prod_tribe_logistics_events";
```

If an operator passes `-OutputLocation`, that explicit path wins. Use explicit
paths only for break-glass diagnostics or migration testing. Normal validation
uses `-ResultPurpose` and `-Environment`.

Use governed Athena result prefixes during onboarding validation:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-raw-topic.sql `
  -Database api_center_raw `
  -Workgroup primary `
  -Profile apic `
  -Environment <environment> `
  -ResultPurpose platform-validation `
  -Parameters @{ physical_topic = "<environment>.tribe.<ownerTribeId>.events" } `
  -Wait
```

## Failure Triage

| Symptom | Likely cause | Required action |
| --- | --- | --- |
| SDK returns forbidden | Missing scope or wrong topic | Check token scopes and owner tribe topic. |
| Topic missing | Provisioning not complete | Create or verify physical topic. |
| Sink excludes topic | Connector config not updated | Re-run idempotent S3 Sink inclusion. |
| Connector fails after topic update | Connector service account missing prefix or DLQ ACLs | Grant prefix read/describe and DLQ create/write/describe, then restart connector. |
| Events accepted but no S3 object | Flush window, low volume, connector lag | Check connector tasks, lag, and flush settings. |
| S3 object exists but no Bronze | Discovery or ingestion lag | Refresh crawler/catalog or Bronze job registry. |
| Test data appears in prod | Environment filter broken | Stop dashboard refresh and repair filters. |

## Verification Lanes

Use two verification lanes so CI stays reliable while live provider checks
remain available to operators.

### Mocked CI Lane

Run on every pull request and local change:

```powershell
cd C:\Codes\apic\api-center
npm test -- kafka-governance.service.spec.ts

cd C:\Codes\apic\apicenter-management
npm test -- service-onboarding.test.ts tribe-onboarding-flow.test.tsx event-topics.test.ts topic-migration.test.ts schemas.test.ts confluent-cloud.test.ts confluent-provisioning-card.test.tsx confluent-pipeline-status-panel.test.tsx topic-onboarding-state-store.test.ts

cd C:\Codes\apic\api-shared-services
npm test -- TribeClient.test.ts
```

This lane uses mocked Confluent/API responses and validates resolver behavior,
tenant policy, idempotent S3 Sink updates, topic-state persistence, UI
rendering, and SDK payload shape. It must not require provider credentials.

### Live Confluent/S3 Smoke Lane

Run manually before declaring a tribe ready for production reporting. Required
environment:

```text
APICENTER_URL
APICENTER_TRIBE_ID
APICENTER_SERVICE_ID
APICENTER_TRIBE_SECRET
CONFLUENT_ENVIRONMENT_ID
CONFLUENT_KAFKA_CLUSTER_ID
CONFLUENT_KAFKA_REST_ENDPOINT
CONFLUENT_KAFKA_API_KEY
CONFLUENT_KAFKA_API_SECRET
CONFLUENT_CLOUD_API_KEY
CONFLUENT_CLOUD_API_SECRET
CONFLUENT_S3_CONNECTOR_NAME
AWS_PROFILE or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY
API_CENTER_RAW_BUCKET
ATHENA_RESULTS_BUCKET
ATHENA_WORKGROUP
ATHENA_DATABASE
```

The live lane must prove:

1. APICenter accepts the smoke event.
2. The physical topic exists in Confluent.
3. The S3 Sink includes the physical topic.
4. The physical topic exists in `topic-projection-values.txt`.
5. The generated Athena enum in `raw-topic-tables.sql` matches the projection
   values file.
6. A new S3 object appears under the exact topic prefix.
7. Athena or Bronze sees the expected physical topic and event count.
8. The management topic-state record advances with evidence links.

Before adding a new topic to a test or prod connector, confirm the connector
service account can read the environment topic prefix and write to its DLQ.
For the current test connector:

```powershell
cd C:\Codes\apic\api-center
.\scripts\grant-confluent-s3-sink-acls.ps1 `
  -EnvFile ..\apicenter-management\.env.test `
  -TopicPrefix test. `
  -ConnectorServiceAccountId sa-8wz0rqm `
  -DlqTopic dlq-lcc-j5o59x8
```

Then restart or poll the connector and require `RUNNING` before marking the
topic as S3-ready.

## Temporary State Storage

Until a database-backed topic state table exists, `apicenter-management` stores
the machine-readable topic state record in a local JSON file:

```text
.local-state/topic-onboarding-states.json
```

Override this location with `TOPIC_ONBOARDING_STATE_FILE` for a shared operator
volume or controlled evidence repository. The record must include transition
history:

```text
owner_tribe_id
physical_topic
previous_state
new_state
actor
approver
timestamp
evidence_link
blocking_reason
next_review_date
```
