# Multi-Merchant PayMongo Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the payment shared service from one platform PayMongo account into a controlled multi-merchant model where each checkout can route funds to the correct approved merchant while API Center keeps gateway policy, status, refunds, audit, and analytics centralized.

**Architecture:** API Center remains the only gateway tribes call, and the PayMongo shared service remains the only runtime that calls PayMongo. Merchant routing is stored in the shared payment schema, validated before checkout creation, then translated into PayMongo split-payment attributes only for approved live merchants. The initial rollout keeps single-merchant behavior as the default and enables merchant routing behind explicit config gates.

**Tech Stack:** NestJS API Center, Node.js/Express PayMongo shared service, API Center SDK, Supabase Postgres shared payment schema, Prisma, PayMongo Checkout/Split Payment APIs, PayMongo webhooks, GKE, GCP Secret Manager, Confluent Cloud/S3 event export.

---

## Current State

The current payment runtime is a shared PayMongo wrapper:

```text
tribe app
  -> @implementsprint/sdk
  -> API Center /api/v1/shared/payment/*
  -> payment-service
  -> PayMongo
```

Current checkout creation:

```text
POST /api/v1/shared/payment/checkout/sessions
```

proxies to:

```text
POST /checkout/sessions
```

and the PayMongo service calls:

```text
POST https://api.paymongo.com/v1/checkout_sessions
```

Current behavior is single-merchant by credential:

- `PAYMENT_PROVIDER_MODE=test` uses `PAYMONGO_TEST_SECRET_KEY`.
- `PAYMENT_PROVIDER_MODE=live` uses `PAYMONGO_LIVE_SECRET_KEY`.
- PayMongo settlement belongs to the PayMongo account behind that secret key.
- The checkout request does not include PayMongo `split_payment`.
- The repo has no merchant onboarding table, no PayMongo child merchant mapping, no route approval workflow, and no payout reconciliation surface.

External PayMongo references to check again at implementation time:

- PayMongo checkout session docs: `https://developers.paymongo.com/docs/accepting-payments-with-checkout-api`
- PayMongo split payment docs: `https://developers.paymongo.com/docs/splitting-a-payment`
- PayMongo payout/settlement docs: `https://developers.paymongo.com/docs/payoutsettlement`

## Target Model

Use a marketplace-style shared payment model:

```text
tribe creates checkout
  -> API Center validates token, consumes, scopes, and shared-service policy
  -> payment-service validates merchant route
  -> payment-service creates PayMongo checkout with split_payment.transfer_to
  -> PayMongo collects payment and routes funds to the approved merchant account
  -> PayMongo sends webhook to API Center shared payment webhook
  -> payment-service stores normalized payment, split, and settlement state
  -> API Center emits sanitized payment lifecycle events to Confluent/S3
```

Terminology:

| Term | Meaning |
|---|---|
| `tribe` | API Center caller registered in the service registry. |
| `merchant` | Business/entity that should receive payment settlement. |
| `merchant route` | Approved mapping from a tribe checkout context to a PayMongo recipient merchant ID. |
| `platform account` | The PayMongo account whose API keys are configured in `payment-service`. |
| `recipient merchant ID` | PayMongo merchant identifier used in `split_payment.transfer_to`. |
| `platform fee` | Optional amount/percentage retained by the platform before merchant settlement. |

## Non-Negotiable Rules

- Tribes never receive PayMongo secret keys.
- Tribes do not send raw PayMongo `split_payment` objects directly.
- A checkout cannot route funds to a merchant unless that merchant is approved and active.
- Test mode and live mode merchant IDs stay separate.
- Refunds must be scoped to the original payment and merchant route.
- Webhooks remain the authority for paid, failed, refunded, and settlement-adjacent lifecycle state.
- Live split payments stay disabled until at least one full test-mode split checkout has been proven end to end.

---

## File Map

### `api-shared-services`

- Modify: `api-shared-services/src/types.ts`
  - Add SDK-safe merchant routing fields to payment request/response types.
- Modify: `api-shared-services/src/TribeClient.ts`
  - Preserve `paymentCreateCheckoutSession()` while passing merchant route fields through the typed payload.
- Modify: `api-shared-services/tests/TribeClient.test.ts`
  - Prove SDK wrappers preserve merchant routing fields without exposing PayMongo internals.
- Modify: `api-shared-services/prisma/shared-services/schema.prisma`
  - Add shared payment merchant, merchant route, checkout split, and settlement status models.
- Create: `api-shared-services/prisma/shared-services/migrations/<timestamp>_multi_merchant_payment_routing/migration.sql`
  - Add SQL tables, constraints, indexes, and status checks.
- Create: `api-shared-services/shared-services/paymongo/src/services/paymongo/merchantRoutes.js`
  - Own merchant route validation and split-payment construction.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
  - Read merchant routes and persist checkout split/settlement records.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
  - Validate merchant route before checkout creation and add PayMongo split payment fields.
- Modify: `api-shared-services/shared-services/paymongo/src/routes/paymongo.routes.js`
  - Keep API stable; reject malformed merchant route payloads with clear 400 errors.
- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`
  - Add provider-adapter tests for split-payment request shape and blocked inactive merchants.
- Modify: `api-shared-services/contracts/shared-service-contract.json`
  - Record the new payment request/response fields.
- Modify: `api-shared-services/docs/sdk-shared-services-apicenter-guide.md`
  - Document merchant-routed checkout usage.
- Modify: `api-shared-services/shared-services/paymongo/README.md`
  - Document multi-merchant config, test mode, live gates, and settlement assumptions.

### `api-center`

- Modify: `api-center/src/shared-services/shared-service-event-sanitizer.ts`
  - Include safe merchant routing metadata in exported payment events.
- Modify: `api-center/src/kafka/schemas/shared-service-export.schemas.ts`
  - Add schema fields for merchant ID, route ID, split status, and platform fee.
- Modify: `api-center/docs/contracts/shared-service-export-events.md`
  - Document sanitized multi-merchant payment event shape.
- Modify: `api-center/docs/apicenter-platform-setup.md`
  - Add operational setup for PayMongo child merchants/split payments.
- Modify: `api-center/docs/superpowers/plans/2026-05-16-hybrid-paymongo-payment-lifecycle.md`
  - Add a short pointer that this plan is the follow-on for marketplace settlement.

### `apicenter-management`

- Create: `apicenter-management/src/app/payment-merchants/page.tsx`
  - Operator list of registered merchants and route status.
- Create: `apicenter-management/src/app/payment-merchants/[merchantId]/page.tsx`
  - Merchant detail, PayMongo IDs, route status, test/live mode status, and last checkout.
- Create: `apicenter-management/src/app/api/local/payment-merchants/route.ts`
  - Server-only local proxy for merchant route reads/writes once API Center exposes admin endpoints.
- Modify: `apicenter-management/src/components/app-shell.tsx`
  - Add `Payment merchants` under shared-service operations.
- Modify: `apicenter-management/src/components/shared-service-smoke-tests.tsx`
  - Add a merchant-routed payment checkout smoke test disabled by default.

---

## Data Contract

SDK request shape:

```ts
export interface PaymentCheckoutCreateRequest {
  referenceId: string;
  idempotencyKey?: string;
  successUrl: string;
  cancelUrl: string;
  lineItems: PaymentCheckoutLineItem[];
  paymentMethods?: PaymentMethod[];
  paymentMethodTypes?: PaymentMethod[];
  customer?: PaymentCheckoutCustomer;
  metadata?: Record<string, string>;
  merchantRoute?: PaymentMerchantRouteRequest;
}

export interface PaymentMerchantRouteRequest {
  routeId?: string;
  merchantId?: string;
  platformFee?: PaymentPlatformFeeRequest;
}

export interface PaymentPlatformFeeRequest {
  amount?: PaymentAmount;
  percentageBps?: number;
}
```

Runtime response shape:

```ts
export interface PaymentCheckoutSession {
  checkoutId: string;
  provider: PaymentProvider;
  status: PaymentCheckoutStatus;
  referenceId: string;
  redirectUrl: string;
  merchantRoute?: {
    routeId: string;
    merchantId: string;
    providerMerchantId: string;
    splitStatus: 'not_requested' | 'requested' | 'accepted' | 'failed';
    platformFee?: {
      amount?: PaymentAmount;
      percentageBps?: number;
    };
  };
}
```

PayMongo provider body target:

```json
{
  "data": {
    "attributes": {
      "line_items": [],
      "payment_method_types": ["gcash", "card"],
      "success_url": "https://tribe.example/payments/success",
      "cancel_url": "https://tribe.example/payments/cancelled",
      "metadata": {
        "referenceId": "order-123",
        "merchantId": "merchant_servease"
      },
      "split_payment": {
        "transfer_to": "paymongo_merchant_id_here",
        "amount": 95000
      }
    }
  }
}
```

Implementation must verify the exact PayMongo field shape from official docs before coding. If PayMongo requires `split_payment.transfer_to` plus `amount`, use amount-based platform fees first. Percentage fees can be derived into fixed amounts before the provider request.

---

## Phase 0: Provider And Business Decision Checkpoint

**Outcome:** No code changes start until PayMongo account capability and merchant ownership assumptions are explicit.

- [ ] **Step 1: Confirm PayMongo account capability**

Check the PayMongo Dashboard and docs for:

```text
Checkout Sessions enabled
Split Payment enabled
Child/recipient merchant onboarding available
Test mode recipient merchant IDs available
Webhook endpoint configured for test and live
Refund behavior for split payments documented
Settlement/payout timing documented
```

Expected: the operator can identify whether split payment is enabled for the platform account.

- [ ] **Step 2: Decide merchant-of-record boundary**

Record the decision in `api-center/docs/apicenter-platform-setup.md`:

```text
Multi-merchant payment mode:
- Platform account creates checkout sessions.
- Approved merchants receive settlement through PayMongo split payment.
- Platform may retain a configured fee.
- The platform does not manually custody funds for ordinary merchant checkouts.
- Refund ownership follows the original checkout route.
```

- [ ] **Step 3: Keep current production behavior unchanged**

Set the rollout gate in shared-service runtime config:

```env
PAYMENT_MULTI_MERCHANT_ENABLED=false
PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED=false
```

Expected: existing checkout tests still pass without merchant route fields.

---

## Phase 1: Shared Payment Merchant Schema

**Files:**

- Modify: `api-shared-services/prisma/shared-services/schema.prisma`
- Create: `api-shared-services/prisma/shared-services/migrations/<timestamp>_multi_merchant_payment_routing/migration.sql`
- Modify: `api-shared-services/tests/shared-services/payment-store.test.ts`

- [ ] **Step 1: Add Prisma models**

Add these models under `shared_payment`:

```prisma
model PaymentMerchant {
  id                 String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  merchantId         String   @unique @map("merchant_id")
  displayName        String   @map("display_name")
  status             String   @default("pending")
  provider           String   @default("paymongo")
  testProviderMerchantId String? @map("test_provider_merchant_id")
  liveProviderMerchantId String? @map("live_provider_merchant_id")
  metadata           Json     @default("{}")
  createdAt          DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt          DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  routes PaymentMerchantRoute[]

  @@index([status, createdAt], name: "payment_merchants_status_created_idx")
  @@map("payment_merchants")
  @@schema("shared_payment")
}

model PaymentMerchantRoute {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  routeId        String   @unique @map("route_id")
  tribeId        String   @map("tribe_id")
  merchantRowId  String   @map("merchant_row_id") @db.Uuid
  status         String   @default("pending")
  defaultPlatformFeeBps Int? @map("default_platform_fee_bps")
  metadata       Json     @default("{}")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  merchant PaymentMerchant @relation(fields: [merchantRowId], references: [id], onDelete: Restrict)

  @@unique([tribeId, merchantRowId], name: "payment_merchant_routes_tribe_merchant")
  @@index([tribeId, status], name: "payment_merchant_routes_tribe_status_idx")
  @@map("payment_merchant_routes")
  @@schema("shared_payment")
}

model PaymentCheckoutSplit {
  id                String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  checkoutId        String   @map("checkout_id")
  tribeId           String   @map("tribe_id")
  routeId           String   @map("route_id")
  merchantId        String   @map("merchant_id")
  providerMerchantId String  @map("provider_merchant_id")
  status            String   @default("requested")
  grossAmount       Int      @map("gross_amount")
  merchantAmount    Int      @map("merchant_amount")
  platformFeeAmount Int      @default(0) @map("platform_fee_amount")
  currency          String   @default("PHP")
  providerMetadata  Json     @default("{}") @map("provider_metadata")
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([checkoutId], name: "payment_checkout_splits_checkout")
  @@index([merchantId, createdAt], name: "payment_checkout_splits_merchant_created_idx")
  @@index([tribeId, createdAt], name: "payment_checkout_splits_tribe_created_idx")
  @@map("payment_checkout_splits")
  @@schema("shared_payment")
}
```

- [ ] **Step 2: Add SQL checks**

In the migration SQL, add status checks:

```sql
alter table "shared_payment"."payment_merchants"
  add constraint "payment_merchants_status_check"
  check ("status" in ('pending', 'active', 'suspended', 'rejected'));

alter table "shared_payment"."payment_merchant_routes"
  add constraint "payment_merchant_routes_status_check"
  check ("status" in ('pending', 'active', 'suspended', 'rejected'));

alter table "shared_payment"."payment_checkout_splits"
  add constraint "payment_checkout_splits_status_check"
  check ("status" in ('not_requested', 'requested', 'accepted', 'failed', 'settled', 'refunded', 'partially_refunded'));
```

- [ ] **Step 3: Validate migration**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm run prisma:validate
```

Expected: Prisma schema validates.

---

## Phase 2: SDK Contract

**Files:**

- Modify: `api-shared-services/src/types.ts`
- Modify: `api-shared-services/tests/TribeClient.test.ts`
- Modify: `api-shared-services/contracts/shared-service-contract.json`

- [ ] **Step 1: Add payment merchant route types**

Add the request and response interfaces from the `Data Contract` section to `api-shared-services/src/types.ts`.

- [ ] **Step 2: Preserve payload pass-through**

Add a test in `api-shared-services/tests/TribeClient.test.ts`:

```ts
it('should preserve merchant route fields on payment checkout creation', async () => {
  await client.paymentCreateCheckoutSession({
    referenceId: 'order-merchant-123',
    idempotencyKey: 'checkout-order-merchant-123',
    successUrl: 'https://app.example.com/payment/success',
    cancelUrl: 'https://app.example.com/payment/cancel',
    merchantRoute: {
      routeId: 'route_servease_primary',
      platformFee: {
        percentageBps: 500,
      },
    },
    lineItems: [
      {
        name: 'Marketplace Booking',
        quantity: 1,
        amount: { value: 100000, currency: 'PHP' },
      },
    ],
  });

  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/api/v1/shared/payment/checkout/sessions',
      method: 'POST',
      data: expect.objectContaining({
        merchantRoute: {
          routeId: 'route_servease_primary',
          platformFee: { percentageBps: 500 },
        },
      }),
    }),
  );
});
```

- [ ] **Step 3: Run SDK tests**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/TribeClient.test.ts
```

Expected: all `TribeClient` tests pass.

---

## Phase 3: Merchant Route Validation Service

**Files:**

- Create: `api-shared-services/shared-services/paymongo/src/services/paymongo/merchantRoutes.js`
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`

- [ ] **Step 1: Add validation outcomes**

Create `merchantRoutes.js` with these exported functions:

```js
function isMultiMerchantEnabled() {
  return process.env.PAYMENT_MULTI_MERCHANT_ENABLED === 'true';
}

function isLiveSplitPaymentEnabled() {
  return process.env.PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED === 'true';
}

function calculatePlatformFee(grossAmount, fee = {}) {
  if (fee.amount?.value) {
    return Number(fee.amount.value);
  }

  if (fee.percentageBps) {
    return Math.floor((Number(grossAmount) * Number(fee.percentageBps)) / 10000);
  }

  return 0;
}

function buildSplitPaymentAttributes({ providerMerchantId, grossAmount, platformFee }) {
  const platformFeeAmount = calculatePlatformFee(grossAmount, platformFee);
  const merchantAmount = Number(grossAmount) - platformFeeAmount;

  if (merchantAmount <= 0) {
    const error = new Error('Merchant split amount must be greater than zero.');
    error.statusCode = 400;
    throw error;
  }

  return {
    split_payment: {
      transfer_to: providerMerchantId,
      amount: merchantAmount,
    },
    splitSummary: {
      merchantAmount,
      platformFeeAmount,
    },
  };
}

module.exports = {
  isMultiMerchantEnabled,
  isLiveSplitPaymentEnabled,
  calculatePlatformFee,
  buildSplitPaymentAttributes,
};
```

- [ ] **Step 2: Add store lookup**

Add `findActiveMerchantRoute({ routeId, merchantId, tribeId, providerMode })` in `paymentStore.js`.

Rules:

```text
If routeId is provided, load by route_id.
If merchantId is provided, load active route by tribe_id plus merchant_id.
The route status must be active.
The merchant status must be active.
For providerMode=test, test_provider_merchant_id is required.
For providerMode=live, live_provider_merchant_id is required.
Return routeId, merchantId, displayName, providerMerchantId, defaultPlatformFeeBps.
```

- [ ] **Step 3: Add blocked route tests**

Add tests that prove:

```text
missing merchant route -> 400
inactive merchant route -> 400
live mode with PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED=false -> 400
valid test merchant route -> provider request includes split_payment
```

- [ ] **Step 4: Run PayMongo provider tests**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected: tests fail until `paymongoService.js` uses merchant route validation.

---

## Phase 4: Checkout Split Payment Adapter

**Files:**

- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`

- [ ] **Step 1: Resolve merchant route before provider call**

Inside `charge(chargeData, options)`, before creating the PayMongo body:

```js
const merchantRouteRequest = chargeData.merchantRoute;
const routeLookupRequired = Boolean(merchantRouteRequest);
let merchantRoute = null;
let splitSummary = null;

if (routeLookupRequired) {
  if (!isMultiMerchantEnabled()) {
    throw new PayMongoError('Multi-merchant payment routing is disabled.', 400);
  }

  if (providerMode() === 'live' && !isLiveSplitPaymentEnabled()) {
    throw new PayMongoError('Live split-payment routing is disabled.', 400);
  }

  merchantRoute = await store.findActiveMerchantRoute({
    routeId: merchantRouteRequest.routeId,
    merchantId: merchantRouteRequest.merchantId,
    tribeId,
    providerMode: providerMode(),
  });
}
```

- [ ] **Step 2: Add split attributes to checkout request**

When `merchantRoute` exists:

```js
const grossAmount = totalLineItemAmount(chargeData.lineItems);
const split = buildSplitPaymentAttributes({
  providerMerchantId: merchantRoute.providerMerchantId,
  grossAmount,
  platformFee: merchantRouteRequest.platformFee || {
    percentageBps: merchantRoute.defaultPlatformFeeBps,
  },
});

splitSummary = split.splitSummary;
body.data.attributes.split_payment = split.split_payment;
body.data.attributes.metadata = {
  ...(body.data.attributes.metadata || {}),
  merchantId: merchantRoute.merchantId,
  merchantRouteId: merchantRoute.routeId,
};
```

- [ ] **Step 3: Persist split state after checkout creation**

After `persistCheckoutSession(...)`, call:

```js
if (merchantRoute && splitSummary) {
  await store.persistCheckoutSplit({
    checkoutId: session.checkoutId,
    tribeId,
    routeId: merchantRoute.routeId,
    merchantId: merchantRoute.merchantId,
    providerMerchantId: merchantRoute.providerMerchantId,
    status: 'requested',
    grossAmount: session.amount?.value || splitSummary.merchantAmount + splitSummary.platformFeeAmount,
    merchantAmount: splitSummary.merchantAmount,
    platformFeeAmount: splitSummary.platformFeeAmount,
    currency: session.currency || 'PHP',
    providerMetadata: response?.data || {},
  });
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/shared-services/paymongo-provider.test.ts
```

Expected: split-payment tests pass and existing checkout/refund/webhook tests still pass.

---

## Phase 5: Refund And Webhook Split State

**Files:**

- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js`
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
- Modify: `api-shared-services/tests/shared-services/payment-store.test.ts`
- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`

- [ ] **Step 1: Store split status from paid webhooks**

When a paid checkout webhook is processed, update `payment_checkout_splits.status`:

```text
requested -> accepted
```

Expected status response includes:

```json
{
  "merchantRoute": {
    "routeId": "route_servease_primary",
    "merchantId": "merchant_servease",
    "splitStatus": "accepted"
  }
}
```

- [ ] **Step 2: Store split status from refund webhooks**

Refund mapping:

```text
full refund -> payment_checkout_splits.status = refunded
partial refund -> payment_checkout_splits.status = partially_refunded
```

- [ ] **Step 3: Refuse cross-merchant refund attempts**

Refund creation must verify that the payment being refunded belongs to the calling tribe and original merchant route.

Expected failed response:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Refund is not allowed for this merchant route."
  }
}
```

- [ ] **Step 4: Run store and provider tests**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts
```

Expected: checkout, webhook, split status, and refund tests pass.

---

## Phase 6: API Center Event Export

**Files:**

- Modify: `api-center/src/shared-services/shared-service-event-sanitizer.ts`
- Modify: `api-center/src/kafka/schemas/shared-service-export.schemas.ts`
- Modify: `api-center/src/shared-services/shared-service-event-sanitizer.spec.ts`
- Modify: `api-center/docs/contracts/shared-service-export-events.md`

- [ ] **Step 1: Add sanitized merchant fields**

Allow these fields in payment export events:

```ts
{
  merchantId: 'merchant_servease',
  merchantRouteId: 'route_servease_primary',
  splitStatus: 'accepted',
  platformFeeAmount: 5000,
  merchantAmount: 95000,
  currency: 'PHP'
}
```

Do not export:

```text
PayMongo secret keys
raw provider payloads
raw customer payment credentials
webhook signatures
bank account details
```

- [ ] **Step 2: Update event schema**

Add optional fields to `shared-service-export.schemas.ts` for payment events:

```ts
merchantId: z.string().optional(),
merchantRouteId: z.string().optional(),
splitStatus: z.enum(['not_requested', 'requested', 'accepted', 'failed', 'settled', 'refunded', 'partially_refunded']).optional(),
platformFeeAmount: z.number().int().nonnegative().optional(),
merchantAmount: z.number().int().nonnegative().optional(),
currency: z.string().optional(),
```

- [ ] **Step 3: Run API Center tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts
```

Expected: sanitizer tests pass and secret redaction remains intact.

---

## Phase 7: Operator Console For Merchant Routes

**Files:**

- Create: `apicenter-management/src/app/payment-merchants/page.tsx`
- Create: `apicenter-management/src/app/payment-merchants/[merchantId]/page.tsx`
- Create: `apicenter-management/src/app/api/local/payment-merchants/route.ts`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/components/shared-service-smoke-tests.tsx`

- [ ] **Step 1: Add navigation**

Add a sidebar item:

```ts
{ href: "/payment-merchants", label: "Payment merchants", icon: CreditCardIcon }
```

- [ ] **Step 2: Add merchant list page**

Display:

```text
Merchant ID
Display name
Status
Test PayMongo merchant ID present
Live PayMongo merchant ID present
Active routes
Last checkout timestamp
```

- [ ] **Step 3: Add merchant-routed smoke test**

Add a disabled-by-default smoke preset:

```ts
{
  id: "payment-merchant-checkout",
  serviceId: "payment",
  label: "Payment merchant-routed checkout",
  description: "Creates PayMongo checkout test data routed to an approved test merchant.",
  method: "POST",
  path: "/checkout/sessions",
  safe: false,
  body: () => ({
    referenceId: `smoke-merchant-order-${Date.now()}`,
    idempotencyKey: `smoke-merchant-order-${Date.now()}`,
    successUrl: "https://api-center.itsandbox.site/smoke/success",
    cancelUrl: "https://api-center.itsandbox.site/smoke/cancel",
    merchantRoute: {
      routeId: "route_smoke_merchant_primary",
      platformFee: { percentageBps: 500 }
    },
    lineItems: [
      {
        name: "Merchant Routed Smoke Test Item",
        quantity: 1,
        amount: { value: 10000, currency: "PHP" }
      }
    ]
  })
}
```

- [ ] **Step 4: Build management app**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run build
```

Expected: Next.js build passes.

---

## Phase 8: Test-Mode End-To-End

**Outcome:** One merchant-routed checkout works in PayMongo test mode and all status surfaces agree.

- [ ] **Step 1: Seed one test merchant**

Insert an active merchant and route in test database:

```sql
insert into shared_payment.payment_merchants (
  merchant_id,
  display_name,
  status,
  provider,
  test_provider_merchant_id,
  metadata
) values (
  'merchant_smoke',
  'Smoke Test Merchant',
  'active',
  'paymongo',
  'paymongo_test_child_merchant_id',
  '{"purpose":"multi-merchant smoke"}'::jsonb
);

insert into shared_payment.payment_merchant_routes (
  route_id,
  tribe_id,
  merchant_row_id,
  status,
  default_platform_fee_bps
)
select
  'route_smoke_merchant_primary',
  'smoke-tribe',
  id,
  'active',
  500
from shared_payment.payment_merchants
where merchant_id = 'merchant_smoke';
```

- [ ] **Step 2: Enable only test split payments**

Set runtime config:

```env
PAYMENT_MULTI_MERCHANT_ENABLED=true
PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED=false
PAYMENT_PROVIDER_MODE=test
```

- [ ] **Step 3: Run merchant-routed smoke checkout**

Open:

```text
http://localhost:3000/smoke-tests?tribeId=smoke-tribe
```

Run:

```text
Payment health
Payment merchant-routed checkout
```

Expected:

```text
checkout created
redirectUrl returned
merchantRoute.routeId = route_smoke_merchant_primary
splitStatus = requested
```

- [ ] **Step 4: Verify status**

Call:

```powershell
Invoke-RestMethod `
  -Method Get `
  -Uri "https://api-center-test.itsandbox.site/api/v1/shared/payment/checkout/sessions/<checkoutId>/status" `
  -Headers @{ Authorization = "Bearer <smoke-tribe-token>" }
```

Expected:

```text
status is created, pending, paid, or failed
merchantRoute is present
providerMode is test
```

---

## Phase 9: Live Rollout Gates

**Outcome:** Live merchant routing is only enabled after explicit operational approval.

- [ ] **Step 1: Verify live PayMongo merchant IDs**

For each live merchant:

```text
Business KYB complete
PayMongo child/recipient merchant ID confirmed
Settlement destination configured
Webhook endpoint configured
Refund process accepted
Support owner assigned
```

- [ ] **Step 2: Run one live low-value checkout**

Use:

```text
PAYMENT_PROVIDER_MODE=live
PAYMENT_MULTI_MERCHANT_ENABLED=true
PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED=true
```

Run one operator-approved checkout using the lowest allowed amount for the chosen payment method.

- [ ] **Step 3: Verify live records**

Check:

```text
PayMongo Dashboard shows checkout/payment
shared_payment.checkout_sessions has provider_mode=live
shared_payment.payment_checkout_splits has the expected merchant_id
shared_payment.payment_webhook_events has the paid event
API Center audit shows the shared-service call
S3 export includes sanitized merchant fields only
```

- [ ] **Step 4: Roll back if needed**

Immediate rollback config:

```env
PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED=false
```

Expected: normal single-account checkout behavior can still work, but merchant-routed live checkouts are rejected with a clear 400 error.

---

## Acceptance Criteria

- Existing non-merchant checkout requests continue to work.
- Merchant-routed checkout requests fail closed when config gates are disabled.
- Merchant-routed checkout requests fail closed when the merchant or route is inactive.
- Test-mode checkout request includes PayMongo split-payment attributes for an active test merchant route.
- Live-mode checkout request cannot include split-payment attributes unless `PAYMENT_SPLIT_PAYMENT_LIVE_ENABLED=true`.
- Payment status responses include safe merchant route summary fields.
- Refunds cannot cross tribe or merchant route boundaries.
- Webhook processing updates checkout and split state idempotently.
- Exported Kafka/S3 payment events include merchant routing metadata but no secrets or raw provider payloads.
- Management console exposes merchant route state and a gated merchant-routed smoke test.

## Verification Commands

Run these before considering the implementation complete:

```powershell
cd C:\Codes\apic\api-shared-services
npm run prisma:validate
npm test -- tests/TribeClient.test.ts tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts
npm run build
```

```powershell
cd C:\Codes\apic\api-center
npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts
npm run build
```

```powershell
cd C:\Codes\apic\apicenter-management
npm run build
```

## Follow-On Decisions

- Whether platform fee should be fixed amount only for v1 or allow basis points.
- Whether merchant onboarding should live in `apicenter-management` only or become a tribe-facing self-service flow.
- Whether merchant settlement reports should be exported as a separate `api-center.shared.payment.settlements` topic.
- Whether PayMongo split payments are enough or the platform also needs PayMongo child account payout management.

