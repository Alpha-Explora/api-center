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
