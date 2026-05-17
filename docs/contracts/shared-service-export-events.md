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

## Payment Lifecycle Events

Payment shared-service calls may include a normalized `lifecycle` object when
the route creates or changes payment state. This keeps PayMongo-specific payloads
out of the data lake while still exposing useful analytics fields.

```json
{
  "eventId": "ad82f2b7-7b2a-41b9-8a76-8a4d4df96a01",
  "eventType": "shared.payment.call",
  "tribeId": "servease",
  "sharedServiceId": "payment",
  "route": "/api/v1/shared/payment/checkout/sessions/cs_123/cancelled",
  "method": "POST",
  "statusCode": 200,
  "ok": true,
  "latencyMs": 31,
  "request": {
    "reason": "user_returned_from_cancel_url"
  },
  "response": {
    "checkoutId": "cs_123",
    "status": "cancelled"
  },
  "lifecycle": {
    "eventType": "payment.checkout.cancelled",
    "checkoutId": "cs_123",
    "referenceId": "order_123",
    "status": "cancelled",
    "amount": 10000,
    "currency": "PHP",
    "provider": "paymongo",
    "providerMode": "test"
  },
  "redactions": [],
  "timestamp": "2026-05-16T00:00:00.000Z"
}
```

Canonical payment lifecycle event types:

```text
payment.checkout.created
payment.checkout.paid
payment.checkout.failed
payment.checkout.cancelled
payment.checkout.expired
payment.subscription.created
payment.subscription.active
payment.subscription.past_due
payment.subscription.paused
payment.subscription.cancelled
payment.invoice.created
payment.invoice.paid
payment.invoice.failed
payment.refunded
payment.refund.updated
```

Subscription and invoice lifecycle events may include these sanitized fields in
`lifecycle` when present:

```json
{
  "eventType": "payment.invoice.paid",
  "subscriptionId": "sub_123",
  "invoiceId": "inv_123",
  "paymentId": "pay_123",
  "referenceId": "church_123_basic",
  "status": "paid",
  "amount": 9900,
  "currency": "PHP",
  "provider": "paymongo",
  "providerMode": "test"
}
```

Do not export raw webhook bodies, provider authorization headers, card/bank
payloads, PayMongo secret keys, or webhook signing secrets.
