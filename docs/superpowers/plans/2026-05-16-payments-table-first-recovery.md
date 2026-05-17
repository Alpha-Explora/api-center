# PayMongo Payments Table First Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `shared_payment.payments` the primary proof of a successful PayMongo payment, including when PayMongo resends an already-recorded webhook event.

**Architecture:** Keep the public PayMongo webhook route and raw signature forwarding already deployed. Change the PayMongo shared service so a duplicate webhook event can still idempotently repair missing payment rows, because `payment_webhook_events` can already contain the provider event while `payments` is empty. Add one fallback path that fetches checkout details from PayMongo when a paid checkout webhook has a checkout id but no extractable `pay_...` id in the webhook body.

**Tech Stack:** Express PayMongo shared service, PayMongo Webhooks/API, Supabase Postgres schema `shared_payment`, Node 24, Vitest, GKE, GCP Artifact Registry.

---

## Current Evidence

- `shared_payment.checkout_sessions` receives rows.
- `shared_payment.payment_webhook_events` has at least one row.
- `shared_payment.payments` is still empty.
- API Center public route exists and forwards to `payment-service`:

```text
POST /api/v1/shared/payment/webhooks
```

- The important failure mode for the payments table is this branch in `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`:

```js
if (idempotency.duplicate) {
  return {
    received: true,
    event: eventType,
    data: {
      duplicate: true,
    },
  };
}
```

If the original event was recorded in `payment_webhook_events` before the parser or payment upsert worked, a PayMongo resend of that same event can become `duplicate: true` and skip `applyWebhookState()`. That means the row in `payments` never gets repaired.

## File Map

### API Shared Services

- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
  - Let duplicate paid webhooks still run the idempotent payment/refund upsert path.
  - Add checkout-detail fallback when a checkout paid event lacks `paymentId`.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js`
  - Export a helper for extracting payment data from a PayMongo checkout-session resource.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
  - Add an optional payment existence/read helper only if tests need explicit proof from store state.
- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`
  - Add regression tests for duplicate replay repairing `payments`.
  - Add regression tests for checkout-detail fallback creating a `payments` row.
- Modify after deployment: `api-shared-services/gcp/gke/00-shared-services.yaml`
  - Record the deployed `shared-payment-service` image tag.

### API Center

- No code changes expected unless the diagnostic logs prove PayMongo reaches API Center but not `payment-service`.

---

## Phase 1: Protect the Payment Upsert From Webhook Event Duplicates

**Purpose:** A resend must be able to create or repair `shared_payment.payments` even when `payment_webhook_events` already contains the provider event id.

- [ ] **Step 1: Write a failing test for duplicate replay repair.**

Modify:

```text
api-shared-services/tests/shared-services/paymongo-provider.test.ts
```

Add this test near the existing webhook persistence tests:

```ts
it('repairs the payment row when a duplicate paid webhook is resent', async () => {
  const app = loadPayMongoGateway({
    PAYMONGO_TEST_SECRET_KEY: 'sk_test_webhook',
    PAYMONGO_TEST_WEBHOOK_SECRET: 'webhook-secret',
    SHARED_SERVICES_DATABASE_ENABLED: 'true',
    SHARED_SERVICES_DATABASE_URL: 'memory://paymongo-duplicate-repair',
    PAYMONGO_PAYMENT_STORE_MODE: 'memory',
  });

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        id: 'cs_duplicate_repair',
        attributes: {
          checkout_url: 'https://checkout.paymongo.com/cs_duplicate_repair',
          status: 'active',
          currency: 'PHP',
        },
      },
    }),
  }));

  await requestApp(app, {
    method: 'POST',
    path: '/checkout/sessions',
    headers: {
      'Idempotency-Key': 'checkout-duplicate-repair-test',
      'X-Tribe-ID': 'servease',
    },
    body: {
      referenceId: 'order-duplicate-repair',
      successUrl: 'https://servease.test/payment/success',
      cancelUrl: 'https://servease.test/payment/cancelled',
      lineItems: [{ name: 'Starter Plan', quantity: 1, amount: { value: 99900, currency: 'PHP' } }],
    },
  });

  const firstPayload = webhookPayload({
    eventId: 'evt_duplicate_repair',
    eventType: 'checkout_session.payment.paid',
    providerData: {
      id: 'cs_duplicate_repair',
      type: 'checkout_session',
      attributes: {},
    },
  });
  const firstRawBody = JSON.stringify(firstPayload);
  const timestamp = '1496734173';
  const firstSignature = crypto
    .createHmac('sha256', 'webhook-secret')
    .update(`${timestamp}.${firstRawBody}`)
    .digest('hex');

  const first = await requestApp<ApiBody<{ paymentId?: string; duplicate: boolean }>>(app, {
    method: 'POST',
    path: '/webhooks',
    headers: { 'Paymongo-Signature': `t=${timestamp},te=${firstSignature},li=` },
    body: firstPayload,
  });

  const repairedPayload = webhookPayload({
    eventId: 'evt_duplicate_repair',
    eventType: 'checkout_session.payment.paid',
    providerData: {
      id: 'cs_duplicate_repair',
      type: 'checkout_session',
      attributes: {
        payments: [
          {
            id: 'pay_duplicate_repair',
            type: 'payment',
            attributes: {
              amount: 99900,
              currency: 'PHP',
              source: { type: 'gcash' },
            },
          },
        ],
      },
    },
  });
  const repairedRawBody = JSON.stringify(repairedPayload);
  const repairedSignature = crypto
    .createHmac('sha256', 'webhook-secret')
    .update(`${timestamp}.${repairedRawBody}`)
    .digest('hex');

  const repaired = await requestApp<ApiBody<{ paymentId?: string; duplicate: boolean }>>(app, {
    method: 'POST',
    path: '/webhooks',
    headers: { 'Paymongo-Signature': `t=${timestamp},te=${repairedSignature},li=` },
    body: repairedPayload,
  });

  expect(first.status).toBe(200);
  expect(first.body.data?.paymentId).toBeUndefined();
  expect(repaired.status).toBe(200);
  expect(repaired.body.data).toMatchObject({
    duplicate: true,
    paymentId: 'pay_duplicate_repair',
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected failure:

```text
expected duplicate response data to include paymentId 'pay_duplicate_repair'
```

- [ ] **Step 3: Change duplicate handling to still apply idempotent payment state.**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Replace the duplicate return branch with this shape:

```js
if (idempotency.duplicate) {
  const updatedCheckout = await applyWebhookState(providerEvent, store);
  logWebhookPersist(providerEvent, {
    duplicate: true,
    updatedCheckout,
  });

  return {
    received: true,
    event: eventType,
    data: {
      eventType: providerEvent.eventType,
      status: providerEvent.status,
      checkoutId: providerEvent.checkoutId,
      paymentId: providerEvent.paymentId,
      refundId: providerEvent.refundId,
      updated: Boolean(updatedCheckout),
      duplicate: true,
    },
  };
}
```

Why this is safe:

```text
store.upsertPayment() uses on conflict (payment_id) do update.
store.upsertRefund() uses on conflict (refund_id) do update.
store.updateCheckoutStatus() writes the same paid/refunded/failed state again.
```

- [ ] **Step 4: Run the focused test and verify it passes.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected:

```text
PayMongo provider runtime tests pass.
```

---

## Phase 2: Add a Checkout Detail Fallback for Missing `paymentId`

**Purpose:** A paid checkout webhook should still create `shared_payment.payments` if the webhook body only contains `cs_...` and PayMongo exposes the `pay_...` id on checkout retrieval.

- [ ] **Step 1: Write a failing test for checkout-detail fallback.**

Modify:

```text
api-shared-services/tests/shared-services/paymongo-provider.test.ts
```

Add this test:

```ts
it('fetches checkout details to create a payment row when a paid checkout webhook has no payment id', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 'cs_fallback_checkout',
          attributes: {
            checkout_url: 'https://checkout.paymongo.com/cs_fallback_checkout',
            status: 'active',
            currency: 'PHP',
          },
        },
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          id: 'cs_fallback_checkout',
          type: 'checkout_session',
          attributes: {
            status: 'paid',
            payments: [
              {
                id: 'pay_fallback_checkout',
                type: 'payment',
                attributes: {
                  amount: 99900,
                  currency: 'PHP',
                  source: { type: 'gcash' },
                },
              },
            ],
          },
        },
      }),
    });
  vi.stubGlobal('fetch', fetchMock);

  const app = loadPayMongoGateway({
    PAYMENT_PROVIDER_MODE: 'test',
    PAYMONGO_TEST_SECRET_KEY: 'sk_test_webhook',
    PAYMONGO_TEST_WEBHOOK_SECRET: 'webhook-secret',
    SHARED_SERVICES_DATABASE_ENABLED: 'true',
    SHARED_SERVICES_DATABASE_URL: 'memory://paymongo-checkout-fallback',
    PAYMONGO_PAYMENT_STORE_MODE: 'memory',
  });

  await requestApp(app, {
    method: 'POST',
    path: '/checkout/sessions',
    headers: {
      'Idempotency-Key': 'checkout-fallback-test',
      'X-Tribe-ID': 'servease',
    },
    body: {
      referenceId: 'order-checkout-fallback',
      successUrl: 'https://servease.test/payment/success',
      cancelUrl: 'https://servease.test/payment/cancelled',
      lineItems: [{ name: 'Starter Plan', quantity: 1, amount: { value: 99900, currency: 'PHP' } }],
    },
  });

  const payload = webhookPayload({
    eventId: 'evt_checkout_fallback',
    eventType: 'checkout_session.payment.paid',
    providerData: {
      id: 'cs_fallback_checkout',
      type: 'checkout_session',
      attributes: {},
    },
  });
  const rawBody = JSON.stringify(payload);
  const timestamp = '1496734173';
  const signature = crypto
    .createHmac('sha256', 'webhook-secret')
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const response = await requestApp<ApiBody<{ paymentId?: string; status: string }>>(app, {
    method: 'POST',
    path: '/webhooks',
    headers: { 'Paymongo-Signature': `t=${timestamp},te=${signature},li=` },
    body: payload,
  });

  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({
    checkoutId: 'cs_fallback_checkout',
    paymentId: 'pay_fallback_checkout',
    status: 'paid',
  });
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.paymongo.com/v1/checkout_sessions/cs_fallback_checkout',
    expect.objectContaining({ method: 'GET' }),
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected failure:

```text
paymentId is undefined because the service does not fetch checkout details during webhook processing.
```

- [ ] **Step 3: Export a checkout-session payment extractor.**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js
```

Add:

```js
function extractPaymentFromCheckoutSession(providerData = {}) {
  const providerAttributes = providerData.attributes || {};
  const nestedPayment = extractNestedPayment(providerAttributes);
  const nestedPaymentAttributes = nestedPayment?.attributes || {};

  if (!nestedPayment?.id) {
    return null;
  }

  return {
    paymentId: nestedPayment.id,
    amount: nestedPaymentAttributes.amount,
    currency: nestedPaymentAttributes.currency || providerAttributes.currency || 'PHP',
    paymentMethodType: nestedPaymentAttributes.payment_method_type
      || nestedPaymentAttributes.source?.type
      || providerAttributes.payment_method_type,
    providerData,
  };
}
```

Update the export:

```js
module.exports = {
  extractPayMongoEvent,
  extractPaymentFromCheckoutSession,
  mapPayMongoEvent,
};
```

- [ ] **Step 4: Add fallback enrichment before `recordWebhookEvent()`.**

Modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Change the import:

```js
const {
  extractPaymentFromCheckoutSession,
  extractPayMongoEvent,
} = require('./paymentEvents');
```

Add:

```js
async function enrichPaidCheckoutPayment(providerEvent) {
  if (
    providerEvent.paymentId
    || providerEvent.providerEventType !== 'checkout_session.payment.paid'
    || !providerEvent.checkoutId
    || isMockMode()
  ) {
    return providerEvent;
  }

  const checkout = await getCheckoutSession(providerEvent.checkoutId);
  const payment = extractPaymentFromCheckoutSession(checkout.providerData || checkout);
  if (!payment?.paymentId) {
    return providerEvent;
  }

  return {
    ...providerEvent,
    paymentId: payment.paymentId,
    amount: payment.amount ?? providerEvent.amount,
    currency: payment.currency || providerEvent.currency,
    paymentMethodType: payment.paymentMethodType || providerEvent.paymentMethodType,
    providerData: payment.providerData || providerEvent.providerData,
  };
}
```

Then change:

```js
const providerEvent = extractPayMongoEvent(webhookPayload, rawBody);
```

to:

```js
const extractedEvent = extractPayMongoEvent(webhookPayload, rawBody);
const providerEvent = await enrichPaidCheckoutPayment(extractedEvent);
```

- [ ] **Step 5: Make `getCheckoutSession()` retain provider data.**

Modify `toCheckoutSession()` in:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js
```

Add this property to the returned object:

```js
providerData,
```

The returned object should still include existing fields:

```js
return {
  checkoutId: providerData.id || `mock_checkout_${crypto.randomUUID().replace(/-/g, '')}`,
  provider: 'paymongo',
  status: mapCheckoutStatus(attributes.status),
  referenceId: request.referenceId,
  redirectUrl: attributes.checkout_url || request.successUrl || 'https://checkout.paymongo.local/mock',
  expiresAt: attributes.expires_at ? new Date(attributes.expires_at * 1000).toISOString() : undefined,
  amount,
  paymentMethodsAllowed,
  metadata: request.metadata,
  providerData,
};
```

- [ ] **Step 6: Run the focused test and verify it passes.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected:

```text
PayMongo provider runtime tests pass.
```

---

## Phase 3: Prove the Database Contract Directly

**Purpose:** Do not rely only on HTTP response data. The definition of success is a row in `shared_payment.payments`.

- [ ] **Step 1: Add a store-level proof helper only if needed.**

If memory-store tests cannot inspect payments, modify:

```text
api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js
```

Add this method to memory and Postgres stores:

```js
async getPaymentByProviderId(paymentId) {
  return payments.get(paymentId) || null;
}
```

For Postgres:

```js
async getPaymentByProviderId(paymentId) {
  const sql = await getSql();
  const rows = await sql`
    select *
    from shared_payment.payments
    where payment_id = ${paymentId}
    limit 1
  `;

  return rows[0] || null;
}
```

- [ ] **Step 2: Assert payment row creation in tests.**

In the duplicate-repair and fallback tests, after the webhook response, call the status/read endpoint if one exists. If no read endpoint exists, use the store helper indirectly by requiring `getPaymentStore()` in the test after the app is loaded:

```ts
const { getPaymentStore } = require(join(repoRoot, 'shared-services/paymongo/src/services/paymongo/paymentStore.js'));
const storedPayment = await getPaymentStore().getPaymentByProviderId('pay_duplicate_repair');
expect(storedPayment).toMatchObject({
  paymentId: 'pay_duplicate_repair',
  checkoutId: 'cs_duplicate_repair',
  status: 'paid',
});
```

- [ ] **Step 3: Run focused tests.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected:

```text
Tests prove the in-service payment store receives the `paymentId`, `checkoutId`, and `paid` status.
```

---

## Phase 4: Deploy to Test and Resend the Existing PayMongo Event

**Purpose:** Repair the real test DB row. This phase is what actually gets data into `shared_payment.payments`.

- [ ] **Step 1: Run complete local verification.**

Run:

```powershell
npm test -- tests/shared-services/paymongo-provider.test.ts
npm test
npm run typecheck
npm run build
```

Expected:

```text
All commands exit 0.
```

- [ ] **Step 2: Build and push `shared-payment-service`.**

Use Cloud Build if Docker Desktop is unavailable:

```powershell
gcloud builds submit . `
  --project api-center-496422 `
  --config C:\tmp\apic-payment-repair-cloudbuild.yaml `
  --timeout=1800s
```

Expected:

```text
Build status SUCCESS and image pushed to Artifact Registry.
```

- [ ] **Step 3: Deploy to test.**

Run:

```powershell
kubectl -n api-center-test set image deploy/payment-service payment-service=<new-shared-payment-service-image>
kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
```

Expected:

```text
deployment "payment-service" successfully rolled out
```

- [ ] **Step 4: Capture counts before resend.**

Run:

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

Expected current baseline:

```text
payments total is 0 or lower than expected.
```

- [ ] **Step 5: Resend the exact PayMongo paid event from the test dashboard.**

Use the PayMongo Dashboard event/delivery that corresponds to the paid checkout. Resend to:

```text
https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks
```

Expected:

```text
PayMongo recent delivery returns 2xx.
```

- [ ] **Step 6: Check payment-service diagnostics.**

Run:

```powershell
kubectl -n api-center-test logs deploy/payment-service --since=15m | Select-String -Pattern 'paymongo-webhook|paymongo-webhook-extract|paymongo-webhook-persist'
```

Expected:

```json
{"component":"paymongo-webhook-extract","paymentIdSet":true,"status":"paid"}
{"component":"paymongo-webhook-persist","paymentIdSet":true}
{"component":"paymongo-webhook","paymentIdSet":true}
```

- [ ] **Step 7: Capture counts after resend and verify the payment row.**

Run the aggregate count query again, then run:

```powershell
$script = @'
const postgres = require('postgres');
(async () => {
  const sql = postgres(process.env.SHARED_SERVICES_DATABASE_URL, { max: 1 });
  try {
    const rows = await sql`
      select payment_id, checkout_id, reference_id, status, amount, currency, payment_method_type, created_at, updated_at
      from shared_payment.payments
      order by created_at desc
      limit 5
    `;
    console.log(JSON.stringify(rows));
  } finally {
    await sql.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
kubectl -n api-center-test exec deploy/payment-service -- node -e "eval(Buffer.from('$encoded','base64').toString())"
```

Success:

```text
payments total increases by at least 1.
Latest row has payment_id beginning with pay_.
Latest row has status paid.
Latest row has checkout_id matching the paid checkout.
```

---

## Phase 5: If Resend Is Not Available, Run a Controlled Test Backfill

**Purpose:** Get existing paid checkout data into `shared_payment.payments` without pretending unpaid sessions are paid.

- [ ] **Step 1: Identify candidate checkouts.**

Run in the payment-service pod:

```sql
select cs.checkout_id, cs.reference_id, cs.tribe_id, cs.status, cs.created_at
from shared_payment.checkout_sessions cs
left join shared_payment.payments p
  on p.checkout_id = cs.checkout_id
where p.id is null
order by cs.created_at desc;
```

- [ ] **Step 2: For each candidate, fetch PayMongo checkout details by `checkout_id`.**

Use the existing service function:

```js
const checkout = await getCheckoutSession(checkoutId);
```

Only continue if:

```text
checkout.status is paid
checkout.providerData.attributes.payments contains a pay_ id
```

- [ ] **Step 3: Upsert the payment row using the existing store.**

Use:

```js
await store.upsertPayment({
  tribeId: checkout.tribeId,
  provider: 'paymongo',
  providerMode: 'test',
  paymentId: payment.paymentId,
  checkoutId: checkout.checkoutId,
  referenceId: checkout.referenceId,
  status: 'paid',
  amount: payment.amount,
  currency: payment.currency,
  paymentMethodType: payment.paymentMethodType,
  providerMetadata: payment.providerData,
});
```

- [ ] **Step 4: Verify the backfill row.**

Run:

```sql
select payment_id, checkout_id, reference_id, status, amount, currency, created_at
from shared_payment.payments
where checkout_id = '<checkout_id>';
```

Expected:

```text
One row exists with payment_id beginning with pay_ and status paid.
```

---

## Definition of Done

- [ ] A resent duplicate PayMongo paid event can create a missing `shared_payment.payments` row.
- [ ] A paid checkout webhook without an embedded payment id can fetch checkout details and create the payment row.
- [ ] `shared_payment.payments.payment_id` stores a real `pay_...` provider id.
- [ ] `shared_payment.payments.checkout_id` matches the `cs_...` checkout session.
- [ ] `shared_payment.payments.status` is `paid`.
- [ ] Replaying the same webhook does not create duplicate payment rows.
- [ ] Test namespace proves the row exists with a direct DB query.
- [ ] Production is deployed only after test proves the payment row exists.

