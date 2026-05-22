# APICenter Event Schema Governance

Date: 2026-05-21

Status: implemented in APICenter publish governance and local catalog files. Test discovery is allowed only under policy. Production publish requires an approved registry record.

## Purpose

APICenter already validates the event envelope. Phase 6 adds event-type and schema-version governance so the platform can answer:

```text
Was this event allowed because its schema was approved, or was it only a test discovery event?
```

This is separate from payload delivery. Kafka can accept bytes that are still not production-approved data. APICenter must make that decision before publish and carry the evidence into the data lake.

## Scope

Governed topics:

```text
test.tribe.<tribe_id>.events
prod.tribe.<tribe_id>.events
test.api-center.shared.<shared_service_id>.events
prod.api-center.shared.<shared_service_id>.events
test/prod APICenter operational topics
```

This slice enforces tribe event schemas at the governed Kafka publish endpoint. Shared-service and APICenter operational schemas follow the same registry model but may be wired in a later slice where their publish paths are centralized.

## Compatibility Modes

| Mode                 | Meaning                                                       | Production Use                      |
| -------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `backward`           | New readers can read data written by the previous schema.     | Allowed after approval.             |
| `forward`            | Old readers can read data written by the new schema.          | Allowed after approval.             |
| `full`               | Both backward and forward compatible.                         | Preferred for stable data products. |
| `none-for-test-only` | No compatibility promise; used for discovery and experiments. | Rejected in prod.                   |

## Minimum Registry Record

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

Allowed `status` values in APICenter code:

```text
approved
pending_approval
draft
deprecated
rejected
```

Only `approved` records can pass production publish.

## Runtime Sources

Current APICenter service:

```text
EVENT_SCHEMA_REGISTRY_FILE=<path-to-json-registry>
EVENT_SCHEMA_REGISTRY_VERSION=<human-readable-version>
EVENT_SCHEMA_TEST_DISCOVERY_ENABLED=true|false
```

If `EVENT_SCHEMA_REGISTRY_FILE` is set, APICenter reads:

```json
{
  "registry_version": "schemas-2026-05-21",
  "records": [
    {
      "tribe_id": "orders",
      "event_type": "order.created",
      "schema_version": "1.0.0",
      "environment": "prod",
      "owner": "orders-platform",
      "steward": "orders-data-steward",
      "json_schema": {
        "type": "object",
        "required": ["orderId"],
        "properties": {
          "orderId": { "type": "string" }
        }
      },
      "compatibility_mode": "backward",
      "status": "approved",
      "approved_by": "api-center-governance",
      "approved_at": "2026-05-21T00:00:00.000Z"
    }
  ]
}
```

Without a file, the registry is empty. That is safe for prod because unknown prod event types are rejected. Test can still accept discovery events when `EVENT_SCHEMA_TEST_DISCOVERY_ENABLED=true` or the publish boundary passes the test discovery policy.

## Publish Contract

Governed publish accepts an optional `schemaVersion`:

```json
{
  "topic": "test.tribe.logistics.events",
  "eventType": "order.created",
  "schemaVersion": "1.0.0",
  "sourceServiceId": "logistics-orders",
  "payload": {
    "orderId": "ord_123"
  }
}
```

If `schemaVersion` is omitted, APICenter uses `1.0.0` for backward compatibility with existing SDK calls.

APICenter writes validation evidence into the governance envelope:

```json
{
  "governance": {
    "schemaVersion": "1.0.0",
    "eventSchemaVersion": "1.0.0",
    "schemaValidationStatus": "approved",
    "schemaRegistryVersion": "schemas-2026-05-21",
    "sourceTribeId": "logistics",
    "sourceServiceId": "logistics-orders"
  }
}
```

For rejected events, APICenter does not publish to Kafka. The error remains at the API boundary.

## Test Lane

Test behavior:

```text
known approved schema -> accepted as approved
unknown schema with discovery enabled -> accepted as test_discovery
unknown schema with discovery disabled -> rejected
schema status pending_approval/draft/deprecated/rejected -> rejected
```

Test discovery is for onboarding and evidence gathering. It does not imply production approval.

## Production Lane

Production behavior:

```text
known approved schema -> accepted
unknown event_type/schema_version -> rejected
none-for-test-only compatibility -> rejected
pending/draft/deprecated/rejected status -> rejected
payload missing required json_schema fields -> rejected
```

Production promotion requires the schema record to exist before the event is published.

## Data Lake Evidence

Bronze tribe events expose:

```text
schema_version
schema_validation_status
schema_registry_version
schema_validation_error
```

Common Silver carries the same fields forward. This separates envelope quality from schema governance:

| Case                                   | quality_status          | schema_validation_status           |
| -------------------------------------- | ----------------------- | ---------------------------------- |
| Missing `eventType`                    | `invalid`               | `not_provided`                     |
| Topic does not match tribe event topic | `invalid`               | `not_provided`                     |
| Approved schema                        | `valid`                 | `approved`                         |
| Test discovery                         | `valid`                 | `test_discovery`                   |
| Rejected before publish                | Not present in Kafka/S3 | Rejected at APICenter API boundary |

## Operator Flow

1. Tribe proposes an event type and version.
2. APICenter validates owner, steward, JSON schema, compatibility mode, and environment.
3. Test can publish discovery events to prove event shape and downstream usefulness.
4. Steward approves the schema record for the target environment.
5. Prod publish succeeds only after the approved record exists.
6. Bronze and Common Silver expose the validation evidence for dashboards and promotion gates.

## SDK Impact

No SDK publish break is required for this slice because APICenter defaults `schemaVersion` to `1.0.0`.

The next SDK improvement should expose `schemaVersion` explicitly in the tribe event publish helper so producers do not hide schema changes behind the default.
