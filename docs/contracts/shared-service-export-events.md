# Shared-Service Export Events

API Center publishes sanitized shared-service export events to Confluent Cloud so
the existing S3 sink can land platform service usage in the raw data lake.

Shared-service runtimes do not receive Confluent credentials and do not write
directly to S3. API Center emits these events after proxying
`/api/v1/shared/:serviceId/*` calls.

## Topics

| Shared service | Topic |
|---|---|
| SMS | `api-center.shared.sms.events` |
| Email | `api-center.shared.email.events` |
| Payment | `api-center.shared.payment.events` |
| OTP | `api-center.shared.otp.events` |
| Geo | `api-center.shared.geo.events` |
| Google auth | `api-center.shared.gauth.events` |

## Event Shape

```json
{
  "eventId": "ad82f2b7-7b2a-41b9-8a76-8a4d4df96a01",
  "eventType": "shared.sms.call",
  "tribeId": "smoke-tribe",
  "sharedServiceId": "sms",
  "route": "/api/v1/shared/sms/send",
  "method": "POST",
  "statusCode": 201,
  "ok": true,
  "latencyMs": 42,
  "correlationId": "corr-123",
  "request": {
    "recipientHash": "sha256:...",
    "hasMessage": true
  },
  "response": {
    "messageId": "msg_123",
    "status": "mock_sent"
  },
  "redactions": ["request.to", "request.message"],
  "timestamp": "2026-05-15T00:00:00.000Z"
}
```

## Redaction Rules

Export events must not contain:

- bearer tokens
- refresh tokens
- OAuth codes
- OTP codes
- API keys
- secrets or passwords
- raw SMS messages
- raw email bodies
- raw email addresses or phone numbers
- payment secret keys

Email addresses, phone numbers, idempotency keys, addresses, state values, and
similar sensitive identifiers are hashed before export.

## Relationship To Other Topics

`api-center.audit.log` remains the operational audit stream. It answers who
called which route, with status and latency metadata.

`api-center.shared.<service>.events` stores sanitized shared-service data export
events for S3 and later analytics.

`tribe.<tribeId>.events` remains the tribe-owned event stream for events that a
tribe explicitly publishes through API Center.
