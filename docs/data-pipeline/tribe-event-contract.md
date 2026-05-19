# Tribe Event Contract

This contract defines the event shape tribes use when APICenter exports
business events to Confluent and S3.

Use `publishTribeEvent()` for ordinary tribe producers. Use raw
`kafkaPublish()` only when the SDK helper cannot express a governed use case.
Both calls must publish to the owner tribe topic:

```text
tribe.<ownerTribeId>.events
```

APICenter applies the runtime environment prefix, such as `test.` or `prod.`,
when writing to Kafka.

## Required Shape

```ts
await apiCenter.publishTribeEvent({
  sourceServiceId: "registered-backend-service-id",
  key: "stable-domain-id",
  eventType: "domain.event_name",
  payload: {
    domainId: "stable-domain-id",
    status: "business-status",
    occurredAt: "2026-05-19T00:00:00.000Z"
  },
  metadata: {
    schemaVersion: "1"
  }
});
```

Equivalent governed `kafkaPublish()` shape:

```ts
await apiCenter.kafkaPublish({
  topic: "tribe.logistics.events",
  sourceServiceId: "logistics-orders",
  key: "order-123",
  eventType: "order.created",
  payload: {
    orderId: "order-123",
    amount: 99900,
    currency: "PHP",
    occurredAt: "2026-05-19T00:00:00.000Z"
  },
  metadata: {
    schemaVersion: "1"
  }
});
```

`APICENTER_TRIBE_ID` is the owner tribe principal. A microservice registered as
`logistics-orders` with `ownerTribeId=logistics` uses
`APICENTER_TRIBE_ID=logistics` and sends `sourceServiceId=logistics-orders`.

## Naming And Keys

- `eventType` uses `domain.event_name`, for example `order.created`.
- Add a version suffix only for incompatible meaning changes, for example
  `order.created.v2`.
- `key` should be a stable domain identifier: order ID, booking ID, customer ID,
  invoice ID, enrollment ID, or similar.
- `payload` must be an object.
- `occurredAt` should be the business event time in ISO-8601 UTC.

## Payload Rules

Allowed:

```json
{
  "orderId": "order-123",
  "customerRef": "cus_hash_456",
  "amount": 99900,
  "currency": "PHP",
  "status": "created",
  "occurredAt": "2026-05-19T00:00:00.000Z"
}
```

Rejected:

```json
{
  "orderId": "order-123",
  "paymongoSecretKey": "sk_live_xxx",
  "otpCode": "123456",
  "rawEmailBody": "<html>...</html>",
  "customerEmail": "plain@example.com"
}
```

Do not publish API keys, provider secrets, passwords, OAuth tokens, OTP codes,
raw SMS bodies, raw email bodies, unnecessary PII, or frontend session tokens.

## Field Classification

Every field must be classified before production export:

| Field type | Publish? | Requirement |
| --- | --- | --- |
| Domain IDs | Yes | Stable and documented. |
| Status values | Yes | Enumerations documented by the tribe. |
| Amounts/currency | Yes | Units and rounding rules documented. |
| Email/phone/name | Only if approved | Hash or tokenize unless raw value is explicitly approved. |
| Secrets/tokens/OTP codes | No | Never publish. |

If hashing or tokenization is used, the schema review must record who owns the
salt, key, or tokenization service and whether the token is reversible.

## Examples

Transactional event:

```ts
await apiCenter.publishTribeEvent({
  sourceServiceId: "logistics-orders",
  key: "order-123",
  eventType: "order.created",
  payload: {
    orderId: "order-123",
    customerRef: "cus_hash_456",
    amount: 99900,
    currency: "PHP",
    occurredAt: "2026-05-19T00:00:00.000Z"
  }
});
```

Lifecycle/status event:

```ts
await apiCenter.publishTribeEvent({
  sourceServiceId: "campusone-enrollment",
  key: "application-789",
  eventType: "application.status_changed",
  payload: {
    applicationId: "application-789",
    previousStatus: "submitted",
    newStatus: "approved",
    occurredAt: "2026-05-19T00:00:00.000Z"
  }
});
```

## Schema Review Checklist

```text
schema_owner:
semantic_owner:
compatibility_policy:
versioning_rule:
pii_classification:
expected_daily_volume:
retention_class:
sample_payload:
breaking_change_approver:
source_service_id:
owner_tribe_id:
event_type:
stable_key_rule:
redaction_method:
production_metric_dependencies:
```

No Gold metric or production dashboard should depend on an event until this
checklist is approved.
