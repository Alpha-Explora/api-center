# Shared-Service Topics And S3 Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export sanitized shared-service call events from API Center into dedicated Confluent topics and include those topics in the existing S3 sink connector.

**Architecture:** API Center remains the only producer for governed platform export events. Shared services do not receive Confluent credentials and do not write directly to S3. API Center publishes sanitized events to `api-center.shared.<service>.events`; Confluent S3 Sink exports those topics to `s3://api-center-raw-data/topics/...`.

**Tech Stack:** NestJS 11, KafkaJS, Zod, Confluent Cloud Kafka, Confluent S3 Sink, Next.js 16 management console.

---

## Boundaries

This plan includes:

- Shared-service Kafka topic definitions.
- Sanitized shared-service event contracts.
- API Center publisher wiring.
- Management console topic/S3 sink provisioning for shared-service topics.
- Docs and verification.

This plan does not include:

- Glue crawlers.
- Athena tables.
- Databricks Bronze/Silver/Gold jobs.
- PowerBI dashboards.
- Direct S3 writes from shared-service pods.

## Topic Model

Use dedicated platform topics:

```text
api-center.shared.sms.events
api-center.shared.email.events
api-center.shared.payment.events
api-center.shared.otp.events
api-center.shared.geo.events
api-center.shared.gauth.events
```

Keep these existing topics:

```text
api-center.audit.log
api-center.tribe.request
api-center.tribe.response
tribe.<tribeId>.events
```

`api-center.audit.log` remains operational metadata. `api-center.shared.*.events` becomes sanitized data export. `tribe.<tribeId>.events` remains tribe-owned business/domain events.

## Export Contract

Base event shape:

```ts
export type SharedServiceExportEvent = {
  eventId: string;
  eventType: string;
  tribeId: string;
  sharedServiceId: "sms" | "email" | "payment" | "otp" | "geo" | "gauth";
  route: string;
  method: string;
  statusCode: number;
  ok: boolean;
  latencyMs: number;
  correlationId?: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  redactions: string[];
  timestamp: string;
};
```

Sanitization rules:

- Never export bearer tokens, refresh tokens, OAuth codes, OTP codes, API keys, secrets, raw email body, raw SMS body, or payment secret keys.
- Hash email addresses and phone numbers before export.
- Keep provider IDs, status, amount, currency, service IDs, route, status code, latency, and timestamps.
- Keep request/response data shallow and service-specific.

## Phase 1: Contracts And Topics

**Files:**

- Modify: `api-center/src/kafka/topics.ts`
- Create: `api-center/src/kafka/schemas/shared-service-export.schemas.ts`
- Modify: `api-center/src/kafka/kafka.service.ts`
- Create: `api-center/docs/contracts/shared-service-export-events.md`

- [ ] Add shared-service topic constants.

```ts
SHARED_SMS_EVENTS: "api-center.shared.sms.events",
SHARED_EMAIL_EVENTS: "api-center.shared.email.events",
SHARED_PAYMENT_EVENTS: "api-center.shared.payment.events",
SHARED_OTP_EVENTS: "api-center.shared.otp.events",
SHARED_GEO_EVENTS: "api-center.shared.geo.events",
SHARED_GAUTH_EVENTS: "api-center.shared.gauth.events",
```

- [ ] Add a helper map from shared service ID to topic.

```ts
export const SHARED_SERVICE_EVENT_TOPICS = {
  sms: TOPICS.SHARED_SMS_EVENTS,
  email: TOPICS.SHARED_EMAIL_EVENTS,
  payment: TOPICS.SHARED_PAYMENT_EVENTS,
  otp: TOPICS.SHARED_OTP_EVENTS,
  geo: TOPICS.SHARED_GEO_EVENTS,
  gauth: TOPICS.SHARED_GAUTH_EVENTS,
} as const;
```

- [ ] Add Zod schema for `SharedServiceExportEvent`.

- [ ] Register the schema in `TOPIC_SCHEMAS` for all six shared-service topics.

- [ ] Document the event contract and redaction rules.

- [ ] Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- kafka.service.spec.ts
npm run lint
```

## Phase 2: Sanitizer Library

**Files:**

- Create: `api-center/src/shared-services/shared-service-event-sanitizer.ts`
- Create: `api-center/src/shared-services/shared-service-event-sanitizer.spec.ts`

- [ ] Implement `sanitizeSharedServiceEventInput(input)`.

Expected function signature:

```ts
export function sanitizeSharedServiceEventInput(input: {
  sharedServiceId: string;
  route: string;
  requestBody?: unknown;
  responseBody?: unknown;
}): {
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  redactions: string[];
};
```

- [ ] Add service-specific behavior:

```text
sms:
  request: recipientHash, hasMessage
  response: messageId, status, provider

email:
  request: recipientHash, subjectPresent, hasHtml, hasText
  response: messageId, status, provider

payment:
  request: referenceId, idempotencyKeyHash, amount, currency, lineItemCount
  response: checkoutId, paymentId, status, provider

otp:
  request: targetHash, channel, length, expiresInSeconds
  response: otpId, channel, status

geo:
  request: operation, latitudeRounded, longitudeRounded, addressHash
  response: provider, formattedAddressHash, inside

gauth:
  request: scopes, redirectUriHost, stateHash
  response: hasAuthorizationUrl, provider
```

- [ ] Ensure recursive redaction removes these keys anywhere:

```text
authorization
token
accessToken
refreshToken
secret
apiKey
password
code
otp
message
text
html
email
phone
to
from
```

- [ ] Tests must prove raw PII/secrets do not appear in JSON output.

- [ ] Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- shared-service-event-sanitizer.spec.ts
```

## Phase 3: API Center Publisher Wiring

**Files:**

- Modify: `api-center/src/shared/proxy-handler.ts`
- Create: `api-center/src/shared-services/shared-service-event-publisher.ts`
- Create: `api-center/src/shared-services/shared-service-event-publisher.spec.ts`
- Modify: `api-center/src/shared-services/shared-services.controller.ts`
- Modify: `api-center/src/shared-services/shared-services.module.ts`

- [ ] Add `SharedServiceEventPublisher`.

Expected public method:

```ts
publishSharedServiceCall(input: {
  tribeId: string;
  sharedServiceId: string;
  route: string;
  method: string;
  statusCode: number;
  ok: boolean;
  latencyMs: number;
  correlationId?: string;
  requestBody?: unknown;
  responseBody?: unknown;
}): void;
```

- [ ] Use `crypto.randomUUID()` for `eventId`.

- [ ] Route topic by `SHARED_SERVICE_EVENT_TOPICS[sharedServiceId]`.

- [ ] Publish non-blocking with key:

```ts
key: `${tribeId}:${sharedServiceId}`
```

- [ ] Add publisher to `ProxyHandlerDeps` as optional `sharedServiceEvents`.

- [ ] In shared-service proxy finish path, publish event only when `opts.namespace === "shared"`.

- [ ] If response body capture is too risky for first implementation, publish request body plus response status only. Do not block live proxying on export failure.

- [ ] Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- proxy-handler.spec.ts shared-service-event-publisher.spec.ts
npm run lint
```

## Phase 4: Management Console Topic Provisioning

**Files:**

- Modify: `apicenter-management/src/lib/event-topics.ts`
- Modify: `apicenter-management/src/components/confluent-provisioning-card.tsx`
- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`

- [ ] Extend topic mapping to include shared-service export topics.

Expected helper:

```ts
export function getSharedServiceExportTopic(serviceId: string) {
  return `api-center.shared.${serviceId}.events`;
}
```

- [ ] On shared-service detail pages, show the shared export topic instead of tribe event topic.

- [ ] Keep tribe pages using `tribe.<tribeId>.events`.

- [ ] Add UI copy:

```text
Shared-service export topic stores sanitized platform events for this shared service.
It is not a tribe-owned event topic.
```

- [ ] Add buttons to provision and include shared-service export topics in S3 sink using the existing Confluent local APIs.

- [ ] Run:

```powershell
cd C:\Codes\apic\apicenter-management
npx tsc --noEmit
npm run lint
```

## Phase 5: S3 Sink Coverage

**Files:**

- Modify: `api-center/docs/confluent-cloud-s3-sink-setup.md`
- Modify: `api-center/docs/confluent-topic-settings.csv`

- [ ] Add the six shared-service export topics to the documented required topic list.

- [ ] Recommended topic settings:

```text
Partitions: 1 for current low traffic
Retention: 1 to 7 days
Cleanup policy: delete
S3: durable long-term archive
```

- [ ] Use `apicenter-management` to add all six topics to `api-center-s3-sink`.

- [ ] Verify S3 paths after producing test events:

```text
s3://api-center-raw-data/topics/api-center.shared.sms.events/
s3://api-center-raw-data/topics/api-center.shared.email.events/
s3://api-center-raw-data/topics/api-center.shared.payment.events/
s3://api-center-raw-data/topics/api-center.shared.otp.events/
s3://api-center-raw-data/topics/api-center.shared.geo.events/
s3://api-center-raw-data/topics/api-center.shared.gauth.events/
```

## Phase 6: Deployment And Validation

**Files:**

- Modify docs only if validation discovers drift.

- [x] Build and deploy API Center.

- [x] Restart API Center deployment.

- [x] Run safe smoke tests for:

```text
geo geofence
gauth authorize URL
gauth health
geo health
payment health
email health
sms health
otp health
```

- [ ] Run provider-impacting smoke tests when test targets are approved:

```text
sms send
email send
payment checkout
otp generate
```

- [x] Confirm each shared-service export topic exists in Confluent Cloud.

- [x] Confirm S3 sink connector config includes each shared-service export topic.

- [x] Confirm S3 sink connector and task are running without validation trace.

- [ ] Confirm Kafka message offsets exist in each shared-service export topic from a network path that can reach the Confluent broker endpoint.

- [ ] Confirm S3 objects eventually appear under `topics/api-center.shared.<service>.events/`.

- [ ] Confirm no raw secrets or OTP codes appear in exported records.

**Deployment note (2026-05-15):** API Center image
`us-central1-docker.pkg.dev/api-center-492808/api-center/api-center:shared-service-export-20260515184111`
was deployed to GKE. The six shared-service export topics were created and added
to the `api-center-s3-sink` connector. The connector initially kept a validation
trace because `tribe.campusone.events` was listed in the connector config but
did not exist; creating that missing topic and re-saving the connector config
cleared the trace. Final connector state: connector `RUNNING`, task `RUNNING`,
no trace.

## Acceptance Criteria

- Each shared service has a dedicated export topic.
- API Center publishes sanitized shared-service events without giving shared-service pods Confluent credentials.
- Existing audit and tribe topics continue working.
- S3 sink includes all shared-service export topics.
- Management UI distinguishes shared-service export topics from tribe event topics.
- Tests prove redaction for SMS, email, payment, OTP, geo, and gauth.

## Commit Plan

1. `feat(api-center): add shared service export event topics`
2. `feat(api-center): publish sanitized shared service events`
3. `feat(management): provision shared service export topics`
4. `docs: document shared service s3 export topics`
