# PayMongo Webhook Payments Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a paid PayMongo checkout reliably create records in `shared_payment.payment_webhook_events` and `shared_payment.payments`, not only in `shared_payment.checkout_sessions`.

**Architecture:** Keep checkout creation on the authenticated API Center shared-service route. Keep third-party PayMongo webhook delivery on a public API Center webhook endpoint that forwards the raw body and PayMongo signature to the internal PayMongo shared service. Use evidence from PayMongo recent deliveries, API Center logs, payment-service logs, and database counts to identify the exact failing layer before applying any additional code or config change.

**Tech Stack:** NestJS API Center, Express PayMongo shared service, GKE, GCP Artifact Registry, GCP Secret Manager, Supabase Postgres, PayMongo Webhooks, Node 24, Jest, Vitest.

---

## Current Evidence

- Checkout session creation writes rows to `shared_payment.checkout_sessions`.
- Test DB previously showed `checkout_sessions > 0`, `payment_webhook_events = 1`, and `payments = 0`.
- API Center now has a public route for PayMongo webhooks:

```text
POST /api/v1/shared/payment/webhooks
```

- The public route was verified with an unsigned payload and returned `INVALID_SIGNATURE`, which proves the request reaches `payment-service` and is no longer blocked by API Center JWT auth.
- The PayMongo service already verifies `Paymongo-Signature` and writes webhook/payment rows only after `webhook()` runs.
- Old paid checkout sessions will not backfill automatically unless PayMongo resends the event or we run a controlled backfill.

## File Map

### API Center

- Modify if needed: `api-center/src/shared-services/payment-webhook.controller.ts`
  - Public API Center ingress for PayMongo webhook callbacks.
- Modify if needed: `api-center/src/shared-services/payment-webhook.controller.spec.ts`
  - Unit coverage for raw-body and signature forwarding.
- Modify if needed: `api-center/src/main.ts`
  - Raw-body support for signed webhook payloads.
- Modify if needed: `api-center/src/shared-services/shared-services.module.ts`
  - Controller registration.
- Modify if needed: `api-center/gcp/gke/30-deployment.yaml`
  - API Center image tag after deployment.

### API Shared Services

- Modify if needed: `api-shared-services/shared-services/paymongo/src/routes/paymongo.routes.js`
  - Route-level logging and response behavior for `POST /webhooks`.
- Modify if needed: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
  - Webhook processing, idempotency branch, checkout update, payment upsert, refund upsert.
- Modify if needed: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js`
  - PayMongo payload parser for real webhook payload shapes.
- Modify if needed: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
  - DB insert/upsert and row-count diagnostics.
- Modify if needed: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`
  - Regression coverage for real PayMongo event shapes and persistence outcomes.
- Modify if needed: `api-shared-services/gcp/gke/00-shared-services.yaml`
  - Payment-service image tag after deployment.

---

## Phase 1: Freeze Baseline and Confirm the Broken Layer

**Purpose:** Avoid another blind deploy. Prove whether the missing rows are caused by PayMongo not calling us, API Center not forwarding, payment-service rejecting, parser missing `paymentId`, or DB insert failure.

- [ ] **Step 1: Record deployed image tags.**

Run:

```powershell
kubectl -n api-center-test get deploy api-center payment-service -o wide
kubectl -n api-center get deploy api-center payment-service -o wide
```

Expected:

```text
api-center and payment-service are running the webhook-route/payment-webhook-fix images, or the exact stale tags are recorded.
```

- [ ] **Step 2: Record DB table counts before any resend.**

Run a redacted in-pod aggregate query from `api-center-test` payment service:

```powershell
$script = @'
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.SHARED_SERVICES_DATABASE_URL, { max: 1 });
  try {
    const rows = await sql.unsafe(
      "select 'checkout_sessions' as table_name, count(*)::int as total, max(created_at)::text as latest from shared_payment.checkout_sessions " +
      "union all select 'payment_webhook_events', count(*)::int, max(received_at)::text from shared_payment.payment_webhook_events " +
      "union all select 'payments', count(*)::int, max(created_at)::text from shared_payment.payments"
    );
    console.log(JSON.stringify(rows));
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
kubectl -n api-center-test exec deploy/payment-service -- node -e "eval(Buffer.from('$encoded','base64').toString())"
```

Expected:

```text
Counts are captured without printing DB credentials.
```

- [ ] **Step 3: Check PayMongo Dashboard recent deliveries for one paid checkout.**

Record:

```text
Webhook endpoint URL:
Webhook mode: test or live
Event type:
Delivery HTTP response code:
Delivery response body:
Delivery timestamp:
PayMongo event id:
PayMongo checkout id:
PayMongo payment id if visible:
```

Decision:

```text
No recent delivery -> fix PayMongo dashboard endpoint/mode/events first.
404 -> wrong URL.
401 INVALID_SIGNATURE -> secret mismatch.
200 but no DB rows -> app parser/persistence bug.
5xx or timeout -> route/service runtime bug.
```

---

## Phase 2: Add Safe Diagnostics Only If Dashboard Evidence Is Not Enough

**Purpose:** Make one real webhook resend tell us exactly where it stops. Do not log secrets or full customer payloads.

- [ ] **Step 1: Add route-level diagnostic logging in `paymongo.routes.js`.**

Target file:

```text
api-shared-services/shared-services/paymongo/src/routes/paymongo.routes.js
```

Add a log after `webhook()` returns:

```js
console.log(JSON.stringify({
  component: 'paymongo-webhook',
  event: result.event,
  eventType: result.data?.eventType,
  checkoutId: result.data?.checkoutId,
  paymentIdSet: Boolean(result.data?.paymentId),
  refundIdSet: Boolean(result.data?.refundId),
  duplicate: Boolean(result.data?.duplicate),
  updated: Boolean(result.data?.updated),
}));
```

- [ ] **Step 2: Add service-level diagnostic logging in `paymongoService.js`.**

Target file:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Add logs after extraction and after persistence calls:

```js
console.log(JSON.stringify({
  component: 'paymongo-webhook-extract',
  providerEventId: providerEvent.providerEventId,
  providerEventType: providerEvent.providerEventType,
  providerMode: providerEvent.providerMode,
  checkoutId: providerEvent.checkoutId,
  paymentIdSet: Boolean(providerEvent.paymentId),
  refundIdSet: Boolean(providerEvent.refundId),
  status: providerEvent.status,
}));
```

```js
console.log(JSON.stringify({
  component: 'paymongo-webhook-persist',
  checkoutUpdated: Boolean(updatedCheckout),
  paymentIdSet: Boolean(providerEvent.paymentId),
  refundIdSet: Boolean(providerEvent.refundId),
}));
```

- [ ] **Step 3: Add focused tests for the diagnostic branch.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected:

```text
PayMongo provider tests pass.
```

- [ ] **Step 4: Deploy diagnostics to test only.**

Build and deploy `payment-service` to `api-center-test` first.

Expected:

```text
kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
```

passes.

---

## Phase 3: Resend One Real PayMongo Event

**Purpose:** Reproduce with the provider's actual webhook delivery, not a mock.

- [ ] **Step 1: Capture DB counts before resend.**

Use the Phase 1 aggregate query.

- [ ] **Step 2: Resend one paid checkout webhook from PayMongo Dashboard.**

Use the delivery for the checkout session that should have created a payment row.

- [ ] **Step 3: Inspect API Center logs.**

Run:

```powershell
kubectl -n api-center-test logs deploy/api-center --since=15m | Select-String -Pattern 'shared/payment/webhooks|PaymentWebhookController|INVALID_SIGNATURE|payment-service'
```

Expected:

```text
At least one request to /api/v1/shared/payment/webhooks appears, or PayMongo did not reach API Center.
```

- [ ] **Step 4: Inspect payment-service logs.**

Run:

```powershell
kubectl -n api-center-test logs deploy/payment-service --since=15m | Select-String -Pattern 'paymongo-webhook|INVALID_SIGNATURE|payment'
```

Expected:

```text
Diagnostic logs show event id, event type, checkout id, whether payment id was found, and whether checkout/payment persistence ran.
```

- [ ] **Step 5: Capture DB counts after resend.**

Use the Phase 1 aggregate query.

Success:

```text
payment_webhook_events increases by 1.
payments increases by 1.
The relevant checkout session status becomes paid.
```

---

## Phase 4: Apply the Correct Fix Based on Evidence

### Branch A: No PayMongo Delivery Reaches API Center

**Cause:** Wrong PayMongo dashboard configuration.

- [ ] Configure the PayMongo test webhook endpoint:

```text
https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks
```

- [ ] Confirm it is enabled and subscribed to:

```text
checkout_session.payment.paid
payment.paid
payment.failed
payment.refunded
payment.refund.updated
```

- [ ] Resend the event and return to Phase 3.

### Branch B: Delivery Reaches API Center but Not Payment Service

**Cause:** API Center forwarding issue.

- [ ] Add or adjust tests in:

```text
api-center/src/shared-services/payment-webhook.controller.spec.ts
```

Required test behavior:

```text
The controller forwards req.rawBody, Content-Type, and Paymongo-Signature to registry.resolveUpstream('payment', '/webhooks').
```

- [ ] Fix:

```text
api-center/src/shared-services/payment-webhook.controller.ts
```

- [ ] Run:

```powershell
npm test -- src/shared-services/payment-webhook.controller.spec.ts src/shared-services/shared-services.controller.spec.ts --runInBand
npm run typecheck
npm run build
```

- [ ] Deploy API Center to test, then return to Phase 3.

### Branch C: Payment Service Returns `INVALID_SIGNATURE`

**Cause:** PayMongo dashboard webhook secret and Kubernetes secret do not match.

- [ ] Compare PayMongo Dashboard webhook secret with the redacted secret source.

Do not print the secret. Confirm only:

```text
PAYMONGO_TEST_WEBHOOK_SECRET is set.
The value was copied from the same test-mode webhook endpoint that sends the event.
```

- [ ] Update GCP Secret Manager `api-shared-services-test`.

- [ ] Sync Kubernetes secret:

```powershell
.\scripts\sync-gke-secret.ps1 `
  -ProjectId api-center-496422 `
  -SecretName api-shared-services-test `
  -Namespace api-center-test `
  -KubernetesSecretName api-shared-services-test
```

- [ ] Restart payment-service:

```powershell
kubectl -n api-center-test rollout restart deploy/payment-service
kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
```

- [ ] Return to Phase 3.

### Branch D: `payment_webhook_events` Inserts but `payments` Stays Empty

**Cause:** Parser did not find a payment id in the real payload.

- [ ] Add a failing test to:

```text
api-shared-services/tests/shared-services/paymongo-provider.test.ts
```

Use a sanitized copy of the real PayMongo payload shape from recent deliveries. Keep these fields:

```text
data.id
data.attributes.type
data.attributes.livemode
data.attributes.data.id
data.attributes.data.type
data.attributes.data.attributes.payments[].id
data.attributes.data.attributes.payments[].attributes.amount
data.attributes.data.attributes.payments[].attributes.currency
data.attributes.data.attributes.payments[].attributes.source.type or payment_method_type
```

- [ ] Run the failing test:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected:

```text
The test fails because paymentId is missing or payment row is not inserted.
```

- [ ] Fix:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js
```

- [ ] Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
npm test
npm run typecheck
npm run build
```

- [ ] Deploy payment-service to test, then return to Phase 3.

### Branch E: Payment Upsert Throws a DB Error

**Cause:** Schema, constraint, or DB permissions issue.

- [ ] Capture only the error message, not credentials.

- [ ] Check table shape:

```sql
select column_name, is_nullable, data_type
from information_schema.columns
where table_schema = 'shared_payment'
  and table_name = 'payments'
order by ordinal_position;
```

- [ ] Check uniqueness and constraints:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'shared_payment.payments'::regclass;
```

- [ ] Fix either:

```text
api-shared-services/supabase/migrations/*
api-shared-services/prisma/shared-services/schema.prisma
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js
```

- [ ] Run migration in test only, then return to Phase 3.

---

## Phase 5: Remove Temporary Diagnostics or Convert Them to Low-Noise Production Logs

**Purpose:** Keep enough observability for future support without noisy or sensitive logs.

- [ ] Remove any logs that print full payloads.

- [ ] Keep one low-noise structured log per processed webhook:

```js
console.log(JSON.stringify({
  component: 'paymongo-webhook',
  eventType: providerEvent.eventType,
  providerMode: providerEvent.providerMode,
  checkoutId: providerEvent.checkoutId,
  paymentIdSet: Boolean(providerEvent.paymentId),
  duplicate: Boolean(idempotency.duplicate),
}));
```

- [ ] Confirm no secret fields are logged:

```powershell
rg -n "SECRET|DATABASE_URL|WEBHOOK_SECRET|payload|rawBody" shared-services/paymongo/src
```

Expected:

```text
No production log statement emits secrets, raw body, or full webhook payload.
```

---

## Phase 6: Deploy Test, Prove End-to-End, Then Deploy Production

- [ ] Deploy API Center only if API Center files changed.

Test namespace:

```powershell
kubectl -n api-center-test set image deploy/api-center api-center=<new-api-center-image>
kubectl -n api-center-test rollout status deploy/api-center --timeout=5m
```

Production namespace:

```powershell
kubectl -n api-center set image deploy/api-center api-center=<new-api-center-image>
kubectl -n api-center rollout status deploy/api-center --timeout=5m
```

- [ ] Deploy payment-service only if PayMongo service files changed.

Test namespace:

```powershell
kubectl -n api-center-test set image deploy/payment-service payment-service=<new-payment-service-image>
kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
```

Production namespace:

```powershell
kubectl -n api-center set image deploy/payment-service payment-service=<new-payment-service-image>
kubectl -n api-center rollout status deploy/payment-service --timeout=5m
```

- [ ] Update manifests after live deployment:

```text
api-center/gcp/gke/30-deployment.yaml
api-shared-services/gcp/gke/00-shared-services.yaml
```

- [ ] Run final DB proof in test:

```text
New paid checkout produces:
- checkout_sessions row
- payment_webhook_events row
- payments row
```

---

## Phase 7: Backfill Old Paid Checkout Sessions

**Purpose:** Fix historical test data after the live flow is proven. Do not backfill before the live flow is known good.

- [ ] Identify paid PayMongo checkout sessions with no matching payment row.

Query shape:

```sql
select cs.checkout_id, cs.reference_id, cs.tribe_id, cs.status, cs.created_at
from shared_payment.checkout_sessions cs
left join shared_payment.payments p
  on p.checkout_id = cs.checkout_id
where cs.status = 'paid'
  and p.id is null
order by cs.created_at desc;
```

- [ ] Prefer PayMongo Dashboard resend when available.

- [ ] If resend is unavailable, create a one-off idempotent backfill script that:

```text
1. reads missing paid checkout ids;
2. fetches PayMongo checkout details;
3. extracts the provider payment id;
4. upserts shared_payment.payments;
5. records an audit note or synthetic metadata marker;
6. never marks unpaid/cancelled sessions as paid.
```

- [ ] Run backfill in test first.

- [ ] Verify counts and a sample row.

---

## Definition of Done

The issue is fixed only when all of these are true:

- [ ] A new test-mode checkout creates a row in `shared_payment.checkout_sessions`.
- [ ] After paying that checkout, PayMongo recent deliveries show a 2xx response.
- [ ] `shared_payment.payment_webhook_events` gets a new row for the PayMongo event id.
- [ ] `shared_payment.payments` gets a new row with a `pay_...` id.
- [ ] Duplicate webhook resend does not create duplicate payment rows.
- [ ] `api-center-test` and `api-center` deployed images match the repo manifests.
- [ ] No logs expose PayMongo secrets, database URLs, raw webhook bodies, or customer billing data.

## Execution Options

1. Subagent-Driven
   - Use a fresh worker for each branch after Phase 3 evidence is captured.
   - Best if PayMongo dashboard evidence points to a parser or DB bug.

2. Inline Execution
   - Run Phase 1 through Phase 3 in this session.
   - Patch only the branch proven by evidence.

