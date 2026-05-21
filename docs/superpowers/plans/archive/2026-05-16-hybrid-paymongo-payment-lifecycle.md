# Hybrid PayMongo Payment Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Option C: API Center and shared services own payment state, webhook processing, status APIs, receipts, audit, and S3 export while tribes own their branded success, cancelled, and failed pages.

**Architecture:** The PayMongo shared service remains the only service that talks to PayMongo. API Center continues to route tribe calls through `/api/v1/shared/payment/*`, publish governed events to Confluent/S3, and expose status through the shared-service contract. Tribes use SDK wrappers to create checkout sessions, render their own result pages, and call API Center for authoritative payment status.

**Tech Stack:** Node.js/Express PayMongo shared service, NestJS API Center proxy/event pipeline, Supabase Postgres shared payment schema, Confluent Cloud Kafka topics, API Center SDK, GKE, GCP Secret Manager.

---

## Current State

The PayMongo shared service already exposes:

```text
POST /checkout/sessions
GET /checkout/sessions/:checkoutId
POST /payments/:paymentId/refunds
POST /webhooks
```

Through API Center, tribes call:

```text
POST /api/v1/shared/payment/checkout/sessions
GET /api/v1/shared/payment/checkout/sessions/:checkoutId
POST /api/v1/shared/payment/payments/:paymentId/refunds
POST /api/v1/shared/payment/webhooks
```

The webhook endpoint currently verifies `Paymongo-Signature` and returns an acknowledgement:

```json
{
  "received": true,
  "event": "checkout_session.payment.paid"
}
```

It does not yet:

- persist webhook events;
- update checkout/payment/receipt status;
- enforce event idempotency by PayMongo event id;
- record cancellation when a user returns through `cancelUrl`;
- expose a normalized status endpoint for tribe result pages;
- publish clean payment lifecycle events for S3 analytics.

## Option C Boundary

API Center and shared services own:

```text
checkout creation
PayMongo API calls
webhook signature verification
payment state persistence
idempotency
receipt/payment/refund records
payment status API
Confluent/S3 export events
audit trail
SDK wrappers
```

Tribes own:

```text
success page UI
cancelled page UI
failed page UI
order/cart display
customer support copy
retry button behavior
post-payment fulfillment logic
```

This allows tribes to build branded pages like:

```text
Payment Cancelled
No charges have been made to your account
Order Information
What happened?
What can you do next?
Return to tribe site
```

without making every tribe integrate with PayMongo directly.

---

## Payment State Contract

Use these canonical statuses across API responses, DB rows, SDK methods, and events:

```text
created
pending
paid
failed
cancelled
expired
refunded
partially_refunded
```

Status meanings:

| Status | Meaning |
|---|---|
| `created` | Checkout session was created but not redirected/paid yet |
| `pending` | Provider indicates payment is in progress |
| `paid` | PayMongo confirmed payment success |
| `failed` | PayMongo confirmed payment failure |
| `cancelled` | User returned through cancel flow or tribe marked checkout cancelled |
| `expired` | Checkout can no longer be paid |
| `refunded` | Payment was fully refunded |
| `partially_refunded` | Payment was partially refunded |

Normalized status response:

```json
{
  "checkoutId": "cs_xxx",
  "tribeId": "servease",
  "referenceId": "order_123",
  "status": "cancelled",
  "amount": 10000,
  "currency": "PHP",
  "provider": "paymongo",
  "providerMode": "test",
  "description": "Servease booking deposit",
  "successUrl": "https://servease.example/payments/success",
  "cancelUrl": "https://servease.example/payments/cancelled",
  "metadata": {
    "orderId": "order_123"
  },
  "createdAt": "2026-05-16T00:00:00.000Z",
  "updatedAt": "2026-05-16T00:00:00.000Z"
}
```

---

## Files And Responsibilities

### `api-shared-services`

- `shared-services/paymongo/src/routes/paymongo.routes.js`
  - Add cancelled marker route and normalized status route.
- `shared-services/paymongo/src/services/paymongo/paymongoService.js`
  - Add payment state transitions, webhook event parsing, and normalized mapping.
- `shared-services/paymongo/src/services/paymongo/paymentStore.js`
  - New persistence adapter for Supabase-backed payment state.
- `shared-services/paymongo/src/services/paymongo/paymentEvents.js`
  - New event mapper from PayMongo webhook types to canonical API Center event types.
- `shared-services/paymongo/src/services/paymongo/paymentStore.test.js`
  - Unit tests for DB write/read/idempotency behavior.
- `tests/shared-services/paymongo-provider.test.ts`
  - Runtime contract tests for checkout, webhook, cancellation, and status behavior.
- `docs/shared-service-database-schemas.md`
  - Document payment lifecycle tables and ownership.
- `docs/sdk-shared-services-apicenter-guide.md`
  - Document how tribes consume payment SDK methods.

### `api-center`

- `src/shared/proxy-handler.ts`
  - Ensure shared-service proxy emits payment lifecycle export events for status-changing routes.
- `src/shared-services/shared-service-event-publisher.ts`
  - Publish clean lifecycle events to `shared.payment.events`.
- `src/kafka/schemas/shared-service-export.schemas.ts`
  - Add validation for payment lifecycle events.
- `docs/contracts/shared-service-export-events.md`
  - Document payment event shapes sent to Confluent/S3.
- `docs/apicenter-platform-setup.md`
  - Document PayMongo webhook setup and result-page integration.

### SDK Repository Or Package Location

Use the existing SDK package location in the shared services repo.

- SDK payment wrapper file
  - Add `createCheckoutSession`, `getCheckoutStatus`, `getCheckoutStatusByReference`, `markCheckoutCancelled`, and `refundPayment`.
- SDK tests
  - Verify wrapper paths and payloads.
- SDK docs
  - Add tribe result-page examples.

### `apicenter-management`

- `src/components/shared-service-smoke-tests.tsx`
  - Add safe payment lifecycle smoke flow after test credentials are available.
- `src/components/service-detail-client.tsx`
  - Show payment webhook/status capability in the payment service detail page.
- `docs/operations/apicenter-management-runbook.md`
  - Add payment lifecycle verification steps.

---

## Phase 1: Confirm DB And Env Preconditions

**Goal:** Ensure the payment lifecycle has somewhere durable to store state before changing behavior.

- [ ] **Step 1: Confirm test Supabase migration has shared payment tables**

Run in Supabase SQL Editor for the test database:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'shared_payment'
order by table_name;
```

Expected required tables:

```text
checkout_sessions
payments
receipts
receipt_line_items
refunds
payment_webhook_events
```

- [ ] **Step 2: Confirm test shared-service secret has DB URL but DB writes are still disabled**

Secret Manager secret:

```text
api-shared-services-test
```

Required keys:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false",
  "SHARED_SERVICES_DATABASE_URL": "<test Supabase pooled runtime URL>"
}
```

- [ ] **Step 3: Confirm PayMongo test webhook points to test API Center**

In PayMongo Dashboard test mode:

```text
Webhook URL:
https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks
```

Minimum event:

```text
checkout_session.payment.paid
```

Recommended payment/refund events:

```text
payment.paid
payment.failed
payment.refunded
payment.refund.updated
```

- [ ] **Step 4: Confirm live remains unchanged**

Live secret should not enable DB writes until test passes:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

---

## Phase 2: Add Payment Store Adapter

**Goal:** Add a focused persistence layer for checkout/payment state without spreading SQL through route handlers.

- [ ] **Step 1: Create payment store module**

Create:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js
```

Responsibilities:

```text
connect only when SHARED_SERVICES_DATABASE_ENABLED=true
upsert checkout sessions
read checkout sessions by checkoutId
read checkout sessions by referenceId and tribeId
record webhook event idempotently
update checkout status
upsert payment rows
upsert refund rows
create receipt rows after paid events
return null/no-op when disabled
```

- [ ] **Step 2: Define disabled-store behavior**

When disabled:

```text
createCheckoutSessionRecord -> returns null
getCheckoutSessionStatus -> returns null
recordWebhookEvent -> returns { inserted: true, disabled: true }
updateCheckoutStatus -> returns null
```

This keeps existing runtime behavior working until the flag is turned on.

- [ ] **Step 3: Add payment store tests**

Create:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.test.js
```

Test cases:

```text
disabled store skips DB connection
disabled store returns null for reads
enabled store requires SHARED_SERVICES_DATABASE_URL
recordWebhookEvent returns duplicate=false on first event
recordWebhookEvent returns duplicate=true on repeated event id
updateCheckoutStatus only allows canonical statuses
```

- [ ] **Step 4: Run payment store tests**

```powershell
npm test -- paymentStore.test.js
```

Expected:

```text
PASS
```

---

## Phase 3: Persist Checkout Session Creation

**Goal:** Every checkout session created through the shared service gets a durable record.

- [ ] **Step 1: Update checkout session creation path**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

After PayMongo returns a checkout session, store:

```text
tribeId
checkoutId
referenceId
status=created
amount
currency
successUrl
cancelUrl
description
metadata
providerMetadata
providerMode
```

- [ ] **Step 2: Require tribe identity for persisted writes**

Use the incoming API Center headers already forwarded by the proxy. Store:

```text
X-Tribe-ID or authenticated tribe id
```

If tribe id is missing:

```text
DB disabled -> allow existing behavior
DB enabled -> return 400 INVALID_TRIBE_CONTEXT
```

- [ ] **Step 3: Add checkout persistence tests**

Update:

```text
api-shared-services/tests/shared-services/paymongo-provider.test.ts
```

Test cases:

```text
checkout creation stores a checkout row when DB enabled
checkout creation still succeeds when DB disabled
missing tribe id fails only when DB enabled
stored row includes successUrl and cancelUrl
```

- [ ] **Step 4: Run PayMongo tests**

```powershell
npm test -- paymongo-provider.test.ts
```

Expected:

```text
PASS
```

---

## Phase 4: Process PayMongo Webhooks

**Goal:** Turn PayMongo webhooks into durable, idempotent state transitions.

- [ ] **Step 1: Create webhook event mapper**

Create:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js
```

Map PayMongo event types:

```text
checkout_session.payment.paid -> payment.checkout.paid
payment.paid                  -> payment.paid
payment.failed                -> payment.failed
payment.refunded              -> payment.refunded
payment.refund.updated        -> payment.refund.updated
unknown                       -> payment.provider_event.received
```

Map statuses:

```text
checkout_session.payment.paid -> paid
payment.paid                  -> paid
payment.failed                -> failed
payment.refunded              -> refunded
payment.refund.updated        -> refunded or partially_refunded based on amount/status
```

- [ ] **Step 2: Update webhook handler**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Flow:

```text
verify signature
extract provider event id
extract event type
record event in payment_webhook_events
if duplicate, return received=true duplicate=true
map event to canonical status
update checkout/payment/refund tables
return received=true event=<type> status=<canonical status>
```

- [ ] **Step 3: Keep webhook response fast**

The route must return within PayMongo retry limits. Avoid slow external callbacks in the webhook request path.

Allowed in request path:

```text
signature verification
single idempotency insert
single status update
single event publish call if non-blocking
```

Not allowed in request path:

```text
calling tribe backend fulfillment URLs synchronously
sending emails synchronously
long reconciliation jobs
```

- [ ] **Step 4: Add webhook tests**

Update:

```text
api-shared-services/tests/shared-services/paymongo-provider.test.ts
```

Test cases:

```text
valid paid webhook marks checkout paid
valid failed webhook marks checkout failed
duplicate webhook returns duplicate=true and does not update twice
invalid signature returns 401 INVALID_SIGNATURE
missing webhook secret returns controlled 500 in production mode
unknown event is recorded but does not break acknowledgement
```

- [ ] **Step 5: Run webhook tests**

```powershell
npm test -- paymongo-provider.test.ts
```

Expected:

```text
PASS
```

---

## Phase 5: Add Cancellation Endpoint

**Goal:** Support tribe-owned cancelled pages by allowing the tribe to record user cancellation when PayMongo redirects to `cancelUrl`.

- [ ] **Step 1: Add route**

Modify:

```text
api-shared-services/shared-services/paymongo/src/routes/paymongo.routes.js
```

Add:

```text
POST /checkout/sessions/:checkoutId/cancelled
```

Request:

```json
{
  "reason": "user_returned_from_cancel_url"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "checkoutId": "cs_xxx",
    "status": "cancelled",
    "reason": "user_returned_from_cancel_url"
  }
}
```

- [ ] **Step 2: Add cancellation service function**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Add:

```text
markCheckoutCancelled(checkoutId, { tribeId, reason })
```

Rules:

```text
paid checkout cannot be changed to cancelled
refunded checkout cannot be changed to cancelled
missing checkout returns 404 when DB enabled
DB disabled returns a best-effort cancelled response for backward compatibility
```

- [ ] **Step 3: Add cancellation tests**

Test cases:

```text
pending checkout can be marked cancelled
paid checkout cannot be marked cancelled
unknown checkout returns 404 when DB enabled
DB disabled returns success=true with status=cancelled
```

---

## Phase 6: Add Normalized Status APIs

**Goal:** Give tribe pages a stable API to render success, cancelled, failed, and receipt states.

- [ ] **Step 1: Add checkout status route**

Add:

```text
GET /checkout/sessions/:checkoutId/status
```

Response:

```json
{
  "success": true,
  "data": {
    "checkoutId": "cs_xxx",
    "referenceId": "order_123",
    "status": "cancelled",
    "amount": 10000,
    "currency": "PHP",
    "provider": "paymongo",
    "providerMode": "test",
    "createdAt": "2026-05-16T00:00:00.000Z",
    "updatedAt": "2026-05-16T00:00:00.000Z"
  }
}
```

- [ ] **Step 2: Add reference status route**

Add:

```text
GET /checkout/sessions/by-reference/:referenceId/status
```

Require tribe context so one tribe cannot query another tribe's reference id.

- [ ] **Step 3: Add status tests**

Test cases:

```text
get status by checkout id returns normalized shape
get status by reference id requires tribe context
unknown checkout returns 404
status response never includes PayMongo secret/provider credentials
```

---

## Phase 7: Publish Clean Lifecycle Events To Confluent/S3

**Goal:** Make every payment state transition available to the data lake.

- [ ] **Step 1: Define shared payment event schema**

Modify:

```text
api-center/src/kafka/schemas/shared-service-export.schemas.ts
```

Add accepted payment event types:

```text
payment.checkout.created
payment.checkout.paid
payment.checkout.failed
payment.checkout.cancelled
payment.checkout.expired
payment.refunded
payment.refund.updated
```

- [ ] **Step 2: Publish from API Center proxy or shared-service event publisher**

Modify:

```text
api-center/src/shared-services/shared-service-event-publisher.ts
```

Publish topic:

```text
shared.payment.events
```

With environment prefix applied by API Center:

```text
test.shared.payment.events
prod.shared.payment.events
```

- [ ] **Step 3: Event payload**

Use:

```json
{
  "eventType": "payment.checkout.cancelled",
  "tribeId": "servease",
  "serviceId": "payment",
  "checkoutId": "cs_xxx",
  "referenceId": "order_123",
  "status": "cancelled",
  "amount": 10000,
  "currency": "PHP",
  "provider": "paymongo",
  "providerMode": "test",
  "occurredAt": "2026-05-16T00:00:00.000Z"
}
```

- [ ] **Step 4: Add S3 sink topic**

Use `apicenter-management` or Confluent Cloud to add:

```text
test.shared.payment.events
prod.shared.payment.events
```

to the managed S3 sink connector.

---

## Phase 8: SDK Tribe Consumption

**Goal:** Make tribe integration simple and consistent.

- [ ] **Step 1: Add SDK methods**

Add:

```ts
payment.createCheckoutSession(input)
payment.getCheckoutStatus(checkoutId)
payment.getCheckoutStatusByReference(referenceId)
payment.markCheckoutCancelled(checkoutId, reason)
payment.refundPayment(paymentId, input)
```

- [ ] **Step 2: Expected tribe success page flow**

```ts
const status = await apiCenter.payment.getCheckoutStatus(checkoutId);

if (status.status === "paid") {
  renderPaidPage(status);
} else if (status.status === "pending") {
  renderPendingPage(status);
} else {
  renderNotPaidPage(status);
}
```

- [ ] **Step 3: Expected tribe cancelled page flow**

```ts
await apiCenter.payment.markCheckoutCancelled(checkoutId, {
  reason: "user_returned_from_cancel_url",
});

const status = await apiCenter.payment.getCheckoutStatus(checkoutId);
renderCancelledPage(status);
```

- [ ] **Step 4: Add SDK contract tests**

Verify:

```text
createCheckoutSession posts to /shared/payment/checkout/sessions
getCheckoutStatus gets /shared/payment/checkout/sessions/:checkoutId/status
markCheckoutCancelled posts to /shared/payment/checkout/sessions/:checkoutId/cancelled
refundPayment posts to /shared/payment/payments/:paymentId/refunds
```

---

## Phase 9: Tribe Integration Documentation

**Goal:** Give tribes exact steps to build their own result pages.

- [ ] **Step 1: Update shared-service SDK guide**

Modify:

```text
api-shared-services/docs/sdk-shared-services-apicenter-guide.md
```

Add:

```text
payment checkout creation
successUrl and cancelUrl requirements
success page status lookup
cancel page cancellation marker
failed page status lookup
retry checkout guidance
```

- [ ] **Step 2: Add example cancelled page**

Document that tribes can render:

```text
Payment Cancelled
No charges have been made to your account
Order Information
What happened?
What can you do next?
Return to <tribe app>
```

using the normalized status response.

- [ ] **Step 3: Update API Center setup docs**

Modify:

```text
api-center/docs/apicenter-platform-setup.md
```

Clarify PayMongo Dashboard webhook setup:

```text
Test webhook URL:
https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks

Live webhook URL:
https://api-center.itsandbox.site/api/v1/shared/payment/webhooks
```

---

## Phase 10: Test Environment Rollout

**Goal:** Prove the full flow in test before touching live.

- [ ] **Step 1: Enable shared-service DB in test**

Set in Secret Manager:

```text
api-shared-services-test
```

Values:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true",
  "SHARED_SERVICES_DATABASE_URL": "<test Supabase pooled URL>"
}
```

- [ ] **Step 2: Sync and restart test payment service**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-test -Namespace api-center-test -KubernetesSecretName api-shared-services-test
kubectl rollout restart deployment/payment-service -n api-center-test
kubectl rollout status deployment/payment-service -n api-center-test
```

- [ ] **Step 3: Run checkout smoke**

Through `apicenter-management`, create a test checkout with:

```text
successUrl=https://your-test-tribe.local/payments/success
cancelUrl=https://your-test-tribe.local/payments/cancelled
```

- [ ] **Step 4: Verify Supabase rows**

Run:

```sql
select checkout_id, reference_id, status, provider_mode, created_at, updated_at
from shared_payment.checkout_sessions
order by created_at desc
limit 10;
```

- [ ] **Step 5: Verify S3 export events**

Check S3 for:

```text
test.shared.payment.events
```

Expected events:

```text
payment.checkout.created
payment.checkout.cancelled or payment.checkout.paid
```

---

## Phase 11: Live Rollout

**Goal:** Enable the same flow in live only after test is stable.

- [ ] **Step 1: Confirm live PayMongo webhook**

PayMongo live mode:

```text
https://api-center.itsandbox.site/api/v1/shared/payment/webhooks
```

Events:

```text
checkout_session.payment.paid
payment.paid
payment.failed
payment.refunded
payment.refund.updated
```

- [ ] **Step 2: Enable shared-service DB in live**

Set in Secret Manager:

```text
api-shared-services-prod
```

Values:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "true",
  "SHARED_SERVICES_DATABASE_URL": "<live Supabase pooled URL>"
}
```

- [ ] **Step 3: Restart live payment service**

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-prod -Namespace api-center -KubernetesSecretName api-shared-services-prod
kubectl rollout restart deployment/payment-service -n api-center
kubectl rollout status deployment/payment-service -n api-center
```

- [ ] **Step 4: Verify live health**

```powershell
curl.exe -i https://api-center.itsandbox.site/api/v1/health/ready
```

Expected:

```text
HTTP/1.1 200
```

---

## Rollback

For test:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

Then:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-test -Namespace api-center-test -KubernetesSecretName api-shared-services-test
kubectl rollout restart deployment/payment-service -n api-center-test
```

For live:

```json
{
  "SHARED_SERVICES_DATABASE_ENABLED": "false"
}
```

Then:

```powershell
.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-prod -Namespace api-center -KubernetesSecretName api-shared-services-prod
kubectl rollout restart deployment/payment-service -n api-center
```

Rollback stops DB writes. It does not delete Supabase rows, PayMongo checkout sessions, Confluent events, or S3 objects.

---

## Verification Checklist

- [x] Test PayMongo webhook verifies signatures.
- [x] Duplicate webhook event ids are ignored.
- [x] Checkout creation writes through the payment store when persistence is enabled.
- [x] Paid webhook changes checkout status to `paid`.
- [ ] Failed webhook changes checkout status to `failed`.
- [x] Cancel endpoint changes unpaid checkout status to `cancelled`.
- [ ] Paid checkout cannot be marked cancelled.
- [x] Status API returns normalized response.
- [x] SDK wraps checkout creation, status lookup, cancellation, and refunds.
- [ ] Payment lifecycle events publish to `test.shared.payment.events`.
- [ ] S3 sink receives `test.shared.payment.events`.
- [ ] Live remains unchanged until test passes.
- [ ] Live writes to live Supabase only.
- [ ] Test writes to test Supabase only.

## Implementation Status

Updated on 2026-05-16:

- Added PayMongo `paymentStore` with disabled, memory, and Postgres-backed modes.
- Added PayMongo webhook event mapping and idempotency handling.
- Added normalized checkout status routes.
- Added checkout cancellation route for tribe-owned cancelled pages.
- Added SDK methods for status lookup and cancellation.
- Added payment lifecycle fields to the API Center shared-service export schema.
- Updated PayMongo/API Center docs for hybrid payment result pages.
- Verified with `npm run typecheck` in `api-shared-services` and `api-center`.
- Verified PayMongo lifecycle behavior with a direct Node smoke test because local Vitest startup is blocked by `spawn EPERM`.

Remaining implementation work:

- Add failed/refund webhook test coverage and receipt row creation.
- Capture proxied shared-service response bodies in API Center if lifecycle-rich export events must be emitted by the gateway rather than reconstructed from sanitized call metadata.
- Enable `SHARED_SERVICES_DATABASE_ENABLED=true` only after test Supabase URL is set and migrations are confirmed.
- Deploy to `api-center-test`, run PayMongo test checkout/webhook, then verify Supabase and S3 rows.

## Final Tribe Flow

Checkout creation:

```text
Tribe backend
  -> SDK payment.createCheckoutSession
  -> API Center /api/v1/shared/payment/checkout/sessions
  -> payment-service
  -> PayMongo checkout session
  -> shared_payment.checkout_sessions row
```

Success page:

```text
Customer returns to tribe successUrl
  -> tribe frontend calls SDK payment.getCheckoutStatus
  -> render paid/pending/failed state
```

Cancelled page:

```text
Customer returns to tribe cancelUrl
  -> tribe frontend calls SDK payment.markCheckoutCancelled
  -> tribe frontend calls SDK payment.getCheckoutStatus
  -> render branded cancelled page
```

Webhook:

```text
PayMongo
  -> API Center /api/v1/shared/payment/webhooks
  -> payment-service verifies signature
  -> idempotency check
  -> update shared_payment rows
  -> publish lifecycle event
  -> Confluent/S3 export
```
