# Stripe-Like PayMongo Checkout And Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the current PayMongo payment wrapper into a Stripe-like platform payment API for both one-time checkout and recurring subscriptions, while keeping provider credentials, webhook handling, policy, persistence, audit, and SDK contracts centralized in API Center shared services.

**Architecture:** Tribe apps continue to call API Center and the `@implementsprint/sdk`; they never call PayMongo directly. The payment shared service exposes stable Stripe-inspired resources such as checkout sessions, customers, products, prices, subscriptions, invoices, payments, refunds, and webhooks, then translates those resources into PayMongo API calls or internal records. The wrapper keeps PayMongo as the first provider but uses canonical API Center types so a later provider swap does not break tribe applications.

**Tech Stack:** Node.js/Express PayMongo shared service, `@implementsprint/sdk`, NestJS API Center proxy and event pipeline, Supabase Postgres `shared_payment` schema, PayMongo Checkout and recurring-payment capabilities, PayMongo webhooks, GKE, GCP Secret Manager, Confluent Cloud/S3 event export, Vitest.

---

## Implementation Status

Started on 2026-05-17.

Completed in the first slice:

- PayMongo subscription capability verified from current official PayMongo docs.
- Provider notes created at `api-shared-services/docs/paymongo-subscription-provider-notes.md`.
- SDK-safe customer, product, price, subscription, and invoice types added.
- SDK wrapper methods added for catalog, subscription, and invoice routes.
- Shared-service payment manifest and contract updated with Stripe-like route surface.
- PayMongo shared-service routes added with controlled disabled/not-found responses while subscription runtime stays gated.
- Checkout creation now rejects `mode: "subscription"` with `SUBSCRIPTIONS_DISABLED` until the provider adapter is implemented.
- API Center contract copy, sanitizer, and export schema updated for subscription/invoice lifecycle metadata.
- Focused tests and builds passed:
  - `api-shared-services`: `npm run check:contracts`
  - `api-shared-services`: `npm run typecheck`
  - `api-shared-services`: `npm test -- tests/TribeClient.test.ts tests/shared-services/paymongo-provider.test.ts`
- `api-center`: `npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts`
- `api-center`: `npm run build`

Completed in the second slice:

- `shared_payment` catalog/subscription/invoice schema added to Prisma and Supabase migrations.
- Payment store expanded with tenant-scoped customer, product, price, subscription, subscription-event, and invoice methods.
- Memory and Postgres store paths follow the existing checkout persistence pattern.
- Catalog routes now persist records when `SHARED_SERVICES_DATABASE_ENABLED=true`.
- Subscription reads and invoice reads are tenant-scoped; subscription creation remains gated until the real PayMongo adapter is implemented.
- Focused verification passed:
  - `api-shared-services`: `npm test -- tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts`
  - `api-shared-services`: `npm test -- tests/TribeClient.test.ts tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts`
  - `api-shared-services`: `npx prisma validate --schema prisma/shared-services/schema.prisma`
  - `api-shared-services`: `npm run check:contracts`
  - `api-shared-services`: `npm run typecheck`
  - `api-shared-services`: `npm run build`

Completed in the third slice:

- `PAYMENT_SUBSCRIPTIONS_ENABLED=true` now enables guarded API Center subscription creation in the PayMongo shared-service wrapper.
- Subscription creation validates tribe context, idempotency key, customer ownership, price ownership, and recurring price configuration.
- Duplicate subscription creation with the same idempotency key and reference returns the existing subscription instead of creating another record.
- Subscription lifecycle routes now update local normalized state for cancel, pause, resume, and change-price.
- Subscription invoice listing remains tenant-scoped and returns an empty list when no invoices exist.
- Focused verification passed:
  - `api-shared-services`: `npm test -- tests/shared-services/paymongo-provider.test.ts`
  - `api-shared-services`: `npm test -- tests/TribeClient.test.ts tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts`
  - `api-shared-services`: `npm run check:contracts`
  - `api-shared-services`: `npm run typecheck`
  - `api-shared-services`: `npm run build`

Completed in the fourth slice:

- PayMongo webhook normalization now extracts subscription, invoice, and customer identifiers.
- Subscription and invoice lifecycle event names are normalized into API Center payment lifecycle events.
- Subscription webhook events are recorded idempotently through the subscription-event store.
- Invoice webhooks create/update tenant-scoped invoice records and update the subscription latest-invoice pointer when the subscription exists.
- Focused verification passed:
  - `api-shared-services`: `npx vitest run tests/shared-services/paymongo-provider.test.ts --pool threads`
  - `api-shared-services`: `npx vitest run tests/TribeClient.test.ts tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts --pool threads`
  - `api-shared-services`: `npm run check:contracts`
  - `api-shared-services`: `npm run typecheck`
  - `api-shared-services`: `npm run build`

Completed in the fifth slice:

- Management smoke-test UI now separates payment checks into health, checkout session, subscription setup, and subscription lifecycle groups.
- Local smoke-test route allowlist now permits catalog and subscription smoke routes.
- Shared-service manifest and catalog copy now describe payment as checkout plus subscription wrapper.
- Local smoke-testing docs now include subscription smoke IDs and live-disable guidance.
- Focused verification passed:
  - `apicenter-management`: `npm test`
  - `apicenter-management`: `npm run build`

Completed in the sixth slice:

- Production `payment-service` manifest now explicitly keeps `PAYMENT_SUBSCRIPTIONS_ENABLED=false`.
- Test shared-service overlay now enables `PAYMENT_SUBSCRIPTIONS_ENABLED=true` only for the test `payment-service` deployment.
- Shared-service GKE README documents the production-off and test-on subscription flag posture.
- API Center platform setup docs now include subscription wrapper SDK methods, subscription secret/config guidance, and required PayMongo subscription/invoice webhook events.
- Shared-service export-events docs now list subscription and invoice lifecycle event types and sanitized lifecycle fields.
- Focused verification passed:
  - `api-shared-services`: `kubectl kustomize infra/gcp/gke/test --load-restrictor LoadRestrictionsNone`
  - `api-shared-services`: `npx vitest run tests/TribeClient.test.ts tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts --pool threads`
  - `api-shared-services`: `npm run check:contracts`
  - `api-center`: `npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts`

Completed in the seventh slice:

- Test Supabase project `qnebjcboppqdsgmgizvs` was migrated with `20260517000000_add_payment_subscription_catalog.sql`.
- Remote migration history now shows `20260515000000`, `20260516000000`, and `20260517000000` applied on the linked test project.
- Built and pushed the test payment image:
  - `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/shared-payment-service:subscriptions-50f5ee6-202605171500`
- Test shared-service overlay now pins `api-center-test/payment-service` to that image and enables `PAYMENT_SUBSCRIPTIONS_ENABLED=true`.
- Deployed the test overlay and verified `api-center-test/payment-service` rolled out with one ready pod and zero restarts.
- Direct deployed smoke test through a temporary port-forward created test customer/product/price/subscription records and cancelled the test subscription successfully.
- Focused verification passed:
  - `api-shared-services`: `supabase db push --linked`
  - `api-shared-services`: `supabase migration list --linked`
  - `api-shared-services`: `gcloud builds submit shared-services --project api-center-496422 --config infra/gcp/cloud-build/payment-service.yaml --substitutions _IMAGE=<test-payment-image>`
  - `api-shared-services`: `kubectl kustomize infra/gcp/gke/test --load-restrictor LoadRestrictionsNone | kubectl apply -f -`
  - `api-shared-services`: `kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m`
  - `api-shared-services`: direct payment-service smoke over local port-forward

Completed in the eighth slice:

- Production Supabase project `hguyivbodlrmooayuxwt` was migrated through the direct database host after the pooler URL hit prepared-statement errors.
- Production migration history now shows `20260515000000`, `20260516000000`, and `20260517000000` applied.
- Production baseline migration history was repaired for the two schema migrations that already existed in the database before applying `20260517000000_add_payment_subscription_catalog.sql`.
- `api-shared-services-prod` Secret Manager was corrected from `PAYMENT_PROVIDER_MODE=true` to `PAYMENT_PROVIDER_MODE=live`.
- The intermediate BOM-encoded secret version was disabled, and the latest production secret version was verified with `PAYMENT_PROVIDER_MODE=live`.
- The corrected prod secret was synced to Kubernetes secret `api-center/api-shared-services-prod`.
- Production `api-center/payment-service` was restarted and rolled out successfully.
- Production subscriptions remain disabled because `PAYMENT_SUBSCRIPTIONS_ENABLED` is not present in the synced prod secret and the live rollout still requires explicit approval.
- Focused verification passed:
  - `api-shared-services`: `supabase migration repair 20260515000000 20260516000000 --status applied --db-url <prod-direct-db-url> --yes`
  - `api-shared-services`: `supabase db push --db-url <prod-direct-db-url> --yes`
  - `api-shared-services`: `supabase migration list --db-url <prod-direct-db-url>`
  - `api-shared-services`: `gcloud secrets versions access latest --secret=api-shared-services-prod --project=api-center-496422`
  - `api-shared-services`: `.\scripts\sync-gke-secret.ps1 -ProjectId api-center-496422 -SecretName api-shared-services-prod -Namespace api-center -KubernetesSecretName api-shared-services-prod`
  - `api-shared-services`: `kubectl -n api-center rollout status deployment/payment-service --timeout=5m`
  - `api-shared-services`: `kubectl -n api-center logs deployment/payment-service --tail=80`

Completed in the ninth slice:

- API Center shared-service export now captures bounded JSON upstream response bodies at the proxy boundary before publishing sanitized export events.
- Payment export lifecycle mapping now includes subscription, invoice, refund, customer, price, reference, amount, currency, provider, and provider-mode metadata when present.
- Payment request redaction now treats `idempotencyKey` as sensitive while still exporting its hash.
- Added `infra/gcp/cloud-build/api-center-gke.yaml` for GKE image builds that use `docker/Dockerfile.gcp` and run Prisma generation.
- Built and pushed the test API Center image:
  - `asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:proxy-events-29ef3bd-202605171555`
- Test API Center overlay now pins `api-center-test/api-center` to that image.
- Deployed the test overlay and verified `api-center-test/api-center` rolled out with one ready pod and zero restarts.
- Ran the full API Center proxy smoke through `https://api-center-test.itsandbox.site/api/v1/shared/payment/*` using `smoke-tribe`:
  - `GET /health`
  - `POST /customers`
  - `POST /products`
  - `POST /prices`
  - `POST /subscriptions`
  - `GET /subscriptions/:subscriptionId`
  - `POST /subscriptions/:subscriptionId/cancel`
  - `GET /subscriptions/:subscriptionId`
- The smoke subscription `sub_proxy_1779005036` was created as `active` in `test` mode and then cancelled successfully through the API Center proxy.
- Runtime analytics for the 1-hour window showed `smoke-tribe -> payment` with `8` total requests, `0` failed requests, and last usage at `2026-05-17T08:04:04.185Z`.
- Alert verification showed `0` Kafka publish failure alerts after the smoke run.
- Focused verification passed:
  - `api-center`: `npm test -- src/shared-services/shared-service-event-publisher.spec.ts src/shared/proxy-handler.spec.ts --runInBand`
  - `api-center`: `npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts src/shared-services/shared-service-event-publisher.spec.ts src/shared/proxy-handler.spec.ts --runInBand`
  - `api-center`: `npm run typecheck`
  - `api-center`: `npx tsc -p tsconfig.build.json --outDir .build-check`
  - `api-center`: `gcloud builds submit . --project=api-center-496422 --config infra/gcp/cloud-build/api-center-gke.yaml --substitutions _IMAGE=<test-api-center-image>`
  - `api-center`: `kubectl kustomize infra/gcp/gke/test --load-restrictor LoadRestrictionsNone | kubectl apply -f -`
  - `api-center`: `kubectl -n api-center-test rollout status deployment/api-center --timeout=5m`
  - `apicenter-management`: `GET /api/local/analytics/shared-service-usage?window=1h`
  - `apicenter-management`: `GET /api/local/analytics/alerts?window=1h`
- Local `npm run build` could not be used as the build proof because Windows had a local file lock on `dist/app.module.js`; the repo-local alternate `tsc` compile and Cloud Build image build both passed.

Remaining work:

- Wire the guarded subscription runtime to verified PayMongo recurring-product APIs once the live/test provider product is approved.
- Keep live subscriptions disabled until live rollout approval.

---

## Current State

The current platform payment path is:

```text
tribe app
  -> @implementsprint/sdk
  -> API Center /api/v1/shared/payment/*
  -> payment-service
  -> PayMongo
```

The current shared-service wrapper supports one-time checkout only:

```text
POST /checkout/sessions
GET /checkout/sessions/:checkoutId
GET /checkout/sessions/:checkoutId/status
GET /checkout/sessions/by-reference/:referenceId/status
POST /checkout/sessions/:checkoutId/cancelled
POST /payments/:paymentId/refunds
POST /webhooks
```

The current SDK exposes checkout and refund helpers:

```ts
apiCenter.paymentCreateCheckoutSession(...)
apiCenter.paymentGetCheckoutSession(...)
apiCenter.paymentGetCheckoutStatus(...)
apiCenter.paymentGetCheckoutStatusByReference(...)
apiCenter.paymentMarkCheckoutCancelled(...)
apiCenter.paymentCreateRefund(...)
```

The current provider configuration already lives in `api-shared-services-prod`:

```text
PAYMENT_PROVIDER_MODE
PAYMENT_PROVIDER_NAME
PAYMONGO_BASE_URL
PAYMONGO_TEST_SECRET_KEY
PAYMONGO_LIVE_SECRET_KEY
PAYMONGO_TEST_WEBHOOK_SECRET
PAYMONGO_LIVE_WEBHOOK_SECRET
PAYMONGO_ALLOWED_PAYMENT_METHODS
PAYMONGO_DEFAULT_PAYMENT_METHODS
SHARED_SERVICES_DATABASE_ENABLED
SHARED_SERVICES_DATABASE_URL
```

No additional base PayMongo secret key is expected for a subscription wrapper. New secrets should only be added if PayMongo requires a separate product for recurring billing, a separate webhook signing secret, or a separate live/test integration surface. Plan IDs, price IDs, product IDs, and tenant mapping should be stored in the shared payment database, not in Secret Manager.

---

## Product Boundary

### Platform-Owned

API Center and the payment shared service own:

- PayMongo API keys and webhook secrets.
- Provider mode selection: `test` or `live`.
- Checkout session creation and status normalization.
- Subscription lifecycle creation, renewal, cancellation, pause/resume, and status normalization.
- Customer, product, price, subscription, invoice, payment, refund, and webhook persistence.
- Idempotency keys and duplicate webhook protection.
- Webhook signature verification.
- Audit, cost, and provider-usage events.
- SDK method naming, request validation, and response compatibility.
- Management-console smoke tests and operational status.

### Tribe-Owned

Tribe applications own:

- Branded checkout entry page.
- Branded success, cancelled, failed, and subscription-management pages.
- Product copy and plan selection UI.
- Business metadata such as `churchId`, `memberId`, `orderId`, or `membershipId`.
- Fulfillment after API Center confirms payment or subscription status.

Tribes must not receive PayMongo secret keys, raw webhook secrets, provider URLs, or unvalidated provider-specific objects.

---

## Stripe-Like Wrapper Model

Use Stripe-inspired concepts, but keep API Center names explicit and provider-neutral.

| Stripe-like concept | API Center resource | PayMongo/provider mapping |
|---|---|---|
| Customer | `payment_customer` | PayMongo customer equivalent if available; otherwise API Center-owned customer record |
| Product | `payment_product` | Platform-owned catalog record |
| Price | `payment_price` | Platform-owned amount/currency/interval record, mapped to provider recurring config if available |
| Checkout Session | `payment_checkout_session` | PayMongo Checkout Session |
| Subscription | `payment_subscription` | PayMongo recurring/subscription API if available; otherwise API Center subscription state plus provider payment attempts |
| Invoice | `payment_invoice` | Provider invoice/recurring payment event if available; otherwise API Center-generated billing-cycle record |
| Payment | `payment_payment` | PayMongo payment object |
| Refund | `payment_refund` | PayMongo refund object |
| Webhook Event | `payment_webhook_event` | PayMongo signed webhook payload normalized into lifecycle events |

The public API should feel like Stripe without copying Stripe's exact object model blindly:

```text
POST /customers
GET /customers/:customerId
POST /products
GET /products/:productId
POST /prices
GET /prices/:priceId

POST /checkout/sessions
GET /checkout/sessions/:checkoutId
GET /checkout/sessions/:checkoutId/status
POST /checkout/sessions/:checkoutId/cancelled

POST /subscriptions
GET /subscriptions/:subscriptionId
GET /subscriptions/by-reference/:referenceId
POST /subscriptions/:subscriptionId/cancel
POST /subscriptions/:subscriptionId/pause
POST /subscriptions/:subscriptionId/resume
POST /subscriptions/:subscriptionId/change-price

GET /invoices/:invoiceId
GET /subscriptions/:subscriptionId/invoices
POST /payments/:paymentId/refunds
POST /webhooks
```

---

## Target SDK Surface

Add methods incrementally. Keep existing checkout helpers backward compatible.

```ts
apiCenter.paymentCreateCustomer(payload)
apiCenter.paymentGetCustomer(customerId)

apiCenter.paymentCreateProduct(payload)
apiCenter.paymentGetProduct(productId)

apiCenter.paymentCreatePrice(payload)
apiCenter.paymentGetPrice(priceId)

apiCenter.paymentCreateCheckoutSession(payload)
apiCenter.paymentGetCheckoutSession(checkoutId)
apiCenter.paymentGetCheckoutStatus(checkoutId)
apiCenter.paymentMarkCheckoutCancelled(checkoutId, payload)

apiCenter.paymentCreateSubscription(payload)
apiCenter.paymentGetSubscription(subscriptionId)
apiCenter.paymentGetSubscriptionByReference(referenceId)
apiCenter.paymentCancelSubscription(subscriptionId, payload)
apiCenter.paymentPauseSubscription(subscriptionId, payload)
apiCenter.paymentResumeSubscription(subscriptionId, payload)
apiCenter.paymentChangeSubscriptionPrice(subscriptionId, payload)

apiCenter.paymentListSubscriptionInvoices(subscriptionId)
apiCenter.paymentGetInvoice(invoiceId)

apiCenter.paymentCreateRefund(paymentId, payload)
```

Use explicit provider-neutral request fields:

```ts
type PaymentInterval = 'day' | 'week' | 'month' | 'year';

type PaymentPrice = {
  priceId: string;
  productId: string;
  amount: { value: number; currency: 'PHP' | string };
  recurring?: {
    interval: PaymentInterval;
    intervalCount: number;
    trialPeriodDays?: number;
  };
  active: boolean;
};

type PaymentSubscriptionCreateRequest = {
  referenceId: string;
  idempotencyKey?: string;
  customerId: string;
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
  trialPeriodDays?: number;
  metadata?: Record<string, string>;
};
```

---

## File Map

### `api-shared-services`

- Modify: `api-shared-services/src/types.ts`
  - Add customer, product, price, subscription, invoice, and expanded payment lifecycle types.
- Modify: `api-shared-services/src/TribeClient.ts`
  - Add SDK helpers for customers, products, prices, subscriptions, and invoices.
- Modify: `api-shared-services/tests/TribeClient.test.ts`
  - Assert SDK helpers call the correct shared payment routes.
- Modify: `api-shared-services/shared-services/manifests/payment-manifest.json`
  - Add new route paths and scopes.
- Modify: `api-shared-services/shared-services/paymongo/src/routes/paymongo.routes.js`
  - Add Stripe-like payment routes.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymongoService.js`
  - Split current checkout logic into focused provider adapter functions and add subscription orchestration.
- Create: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentCatalog.js`
  - Own customer, product, and price validation/persistence orchestration.
- Create: `api-shared-services/shared-services/paymongo/src/services/paymongo/subscriptionService.js`
  - Own subscription creation, state changes, billing-cycle handling, and provider mapping.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentStore.js`
  - Add persistence methods for customers, products, prices, subscriptions, invoices, and subscription events.
- Modify: `api-shared-services/shared-services/paymongo/src/services/paymongo/paymentEvents.js`
  - Normalize subscription, invoice, and recurring-payment webhook events.
- Modify: `api-shared-services/tests/shared-services/payment-store.test.ts`
  - Add persistence tests for catalog and subscription records.
- Modify: `api-shared-services/tests/shared-services/paymongo-provider.test.ts`
  - Add provider-adapter and webhook tests for checkout and subscription flows.
- Modify: `api-shared-services/README.md`
  - Document the Stripe-like wrapper and subscription flow.
- Modify: `api-shared-services/docs/sdk-shared-services-apicenter-guide.md`
  - Add tribe examples for checkout and subscriptions.

### `api-center`

- Modify: `api-center/src/shared-services/shared-service-event-sanitizer.ts`
  - Add sanitized lifecycle fields for subscription and invoice events.
- Modify: `api-center/src/shared-services/shared-service-event-sanitizer.spec.ts`
  - Assert customer metadata and provider secrets are redacted.
- Modify: `api-center/src/kafka/schemas/shared-service-export.schemas.ts`
  - Add subscription lifecycle event enum values.
- Modify: `api-center/src/kafka/schemas/shared-service-export.schemas.spec.ts`
  - Assert subscription events validate.
- Modify: `api-center/docs/contracts/shared-service-contract.json`
  - Add new payment routes and required scopes.
- Modify: `api-center/docs/contracts/shared-service-export-events.md`
  - Document subscription lifecycle export events.
- Modify: `api-center/docs/apicenter-platform-setup.md`
  - Add PayMongo subscription wrapper setup and webhook event guidance.

### `apicenter-management`

- Modify: `apicenter-management/src/components/shared-service-smoke-tests.tsx`
  - Add better operator UI for checkout and subscription smoke checks.
- Modify: `apicenter-management/src/lib/shared-service-manifests.ts`
  - Add subscription route visibility and scopes.
- Modify: `apicenter-management/src/components/shared-services-catalog-client.tsx`
  - Show payment as checkout plus subscriptions, not checkout only.
- Modify: `apicenter-management/src/components/shared-service-usage-matrix.tsx`
  - Add subscription route labels.
- Modify: `apicenter-management/src/app/api/local/smoke-tests/shared-service/route.ts`
  - Include subscription-safe and provider-impacting test presets.
- Modify: `apicenter-management/docs/operations/local-smoke-testing.md`
  - Document how to run checkout-only and subscription-impacting checks.

---

## Phases

### Phase 0: Provider Capability Verification

**Goal:** Confirm the exact PayMongo recurring/subscription API capabilities before implementation.

- [x] **Step 1: Verify PayMongo recurring billing APIs**

  Check current PayMongo docs and dashboard for recurring billing, subscriptions, stored payment method, customer, invoice, and webhook support.

  Record exact provider paths in a short implementation note:

  ```text
  api-shared-services/docs/paymongo-subscription-provider-notes.md
  ```

  The note must state which model is supported:

  ```text
  Model A: PayMongo has first-class subscriptions.
  Model B: PayMongo has recurring payments but no full subscription object.
  Model C: PayMongo does not support subscriptions directly, so API Center must own subscription state and create provider checkout/payment attempts per billing cycle.
  ```

- [x] **Step 2: Choose the adapter path**

  Use this decision rule:

  ```text
  If PayMongo has first-class subscriptions, map API Center subscriptions to provider subscriptions.
  If PayMongo only has recurring payments, map API Center subscriptions to recurring payment mandates plus API Center billing cycles.
  If PayMongo has no usable recurring API, keep subscriptions disabled in live mode and support catalog + checkout-only until provider support exists.
  ```

- [x] **Step 3: Keep secrets unchanged unless provider docs require otherwise**

  Confirm `api-shared-services-prod` still only needs the existing PayMongo keys and webhook secrets. Store provider plan/product identifiers in database tables, not in Secret Manager.

### Phase 1: Canonical Types And SDK Contract

**Goal:** Define the Stripe-like API Center contract before changing runtime behavior.

- [x] **Step 1: Add failing SDK tests**

  Modify `api-shared-services/tests/TribeClient.test.ts` with tests for:

  ```ts
  paymentCreateCustomer
  paymentCreateProduct
  paymentCreatePrice
  paymentCreateSubscription
  paymentGetSubscription
  paymentGetSubscriptionByReference
  paymentCancelSubscription
  paymentPauseSubscription
  paymentResumeSubscription
  paymentChangeSubscriptionPrice
  paymentListSubscriptionInvoices
  paymentGetInvoice
  ```

  Expected route examples:

  ```text
  POST /api/v1/shared/payment/customers
  POST /api/v1/shared/payment/products
  POST /api/v1/shared/payment/prices
  POST /api/v1/shared/payment/subscriptions
  GET /api/v1/shared/payment/subscriptions/sub_123
  GET /api/v1/shared/payment/subscriptions/by-reference/church_123_basic
  POST /api/v1/shared/payment/subscriptions/sub_123/cancel
  GET /api/v1/shared/payment/subscriptions/sub_123/invoices
  ```

- [x] **Step 2: Add TypeScript types**

  Modify `api-shared-services/src/types.ts` with provider-neutral types:

  ```ts
  export type PaymentBillingInterval = 'day' | 'week' | 'month' | 'year';
  export type PaymentSubscriptionStatus =
    | 'incomplete'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'paused'
    | 'cancelled'
    | 'expired';

  export interface PaymentCustomer {
    customerId: string;
    provider: PaymentProvider;
    providerMode?: 'test' | 'live';
    email?: string;
    phone?: string;
    name?: string;
    metadata?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
  }

  export interface PaymentProduct {
    productId: string;
    name: string;
    description?: string;
    active: boolean;
    metadata?: Record<string, string>;
  }

  export interface PaymentPrice {
    priceId: string;
    productId: string;
    amount: PaymentAmount;
    recurring?: {
      interval: PaymentBillingInterval;
      intervalCount: number;
      trialPeriodDays?: number;
    };
    active: boolean;
    metadata?: Record<string, string>;
  }

  export interface PaymentSubscriptionCreateRequest {
    referenceId: string;
    idempotencyKey?: string;
    customerId: string;
    priceId: string;
    successUrl?: string;
    cancelUrl?: string;
    trialPeriodDays?: number;
    metadata?: Record<string, string>;
  }

  export interface PaymentSubscription {
    subscriptionId: string;
    provider: PaymentProvider;
    providerMode?: 'test' | 'live';
    referenceId: string;
    customerId: string;
    priceId: string;
    status: PaymentSubscriptionStatus;
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
    latestInvoiceId?: string;
    latestPaymentId?: string;
    metadata?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
  }
  ```

- [x] **Step 3: Add SDK methods**

  Modify `api-shared-services/src/TribeClient.ts` to call the new shared payment routes using `callSharedService`.

- [x] **Step 4: Run SDK tests**

  Run:

  ```powershell
  npm test -- tests/TribeClient.test.ts
  ```

  Expected: all existing checkout tests and new subscription-route tests pass.

### Phase 2: Shared Payment Schema Expansion

**Goal:** Add durable records for catalog and subscription state without mixing provider secrets into the database.

- [x] **Step 1: Add migration tables**

  Add a Supabase/Prisma migration in `api-shared-services` for:

  ```text
  shared_payment.customers
  shared_payment.products
  shared_payment.prices
  shared_payment.subscriptions
  shared_payment.subscription_events
  shared_payment.invoices
  shared_payment.invoice_line_items
  ```

  Required invariants:

  ```text
  Every customer, product, price, subscription, invoice, and invoice line item has tribe_id.
  Provider mode is always test or live.
  Reference IDs are unique per tribe where exposed to tribes.
  Provider object IDs are unique with provider + provider_mode.
  Metadata is jsonb and never stores API keys, webhook secrets, or full card data.
  ```

- [x] **Step 2: Add store tests**

  Modify `api-shared-services/tests/shared-services/payment-store.test.ts` to verify:

  ```text
  create/get customer
  create/get product
  create/get price
  create subscription
  update subscription status
  get subscription by reference within tribe
  reject cross-tribe reference lookup
  insert invoice idempotently
  insert subscription event idempotently by provider_event_id
  ```

- [x] **Step 3: Extend payment store**

  Modify `paymentStore.js` with focused methods:

  ```js
  createCustomer(customer)
  getCustomer(customerId, options)
  createProduct(product)
  getProduct(productId, options)
  createPrice(price)
  getPrice(priceId, options)
  createSubscription(subscription)
  getSubscription(subscriptionId, options)
  getSubscriptionByReference(referenceId, options)
  updateSubscriptionStatus(subscriptionId, patch)
  insertSubscriptionEvent(event)
  createInvoice(invoice)
  getInvoice(invoiceId, options)
  listInvoicesForSubscription(subscriptionId, options)
  ```

- [x] **Step 4: Run store tests**

  Run:

  ```powershell
  npm test -- tests/shared-services/payment-store.test.ts
  ```

  Expected: payment store tests pass in disabled, memory, and Postgres-shaped paths.

### Phase 3: Checkout Wrapper Modernization

**Goal:** Make the existing checkout wrapper feel more Stripe-like while preserving compatibility.

- [x] **Step 1: Keep existing checkout route compatibility**

  Do not remove:

  ```text
  POST /checkout/sessions
  GET /checkout/sessions/:checkoutId
  GET /checkout/sessions/:checkoutId/status
  POST /checkout/sessions/:checkoutId/cancelled
  ```

- [ ] **Step 2: Normalize checkout response shape**

  Ensure checkout responses consistently include:

  ```ts
  {
    checkoutId: string;
    provider: 'paymongo' | 'mock';
    providerMode: 'test' | 'live';
    status: 'pending' | 'paid' | 'failed' | 'cancelled' | 'expired';
    referenceId: string;
    redirectUrl: string;
    amount: { value: number; currency: string };
    paymentMethodsAllowed: string[];
    customerId?: string;
    subscriptionId?: string;
    metadata?: Record<string, string>;
  }
  ```

- [x] **Step 3: Add optional subscription checkout mode**

  Allow checkout creation to accept:

  ```ts
  mode?: 'payment' | 'subscription';
  priceId?: string;
  customerId?: string;
  ```

  For `mode: 'payment'`, use current PayMongo checkout behavior.

  For `mode: 'subscription'`, reject with a controlled `501 SUBSCRIPTION_PROVIDER_NOT_ENABLED` until Phase 5 is implemented.

- [x] **Step 4: Test backward compatibility**

  Run:

  ```powershell
  npm test -- tests/shared-services/paymongo-provider.test.ts tests/TribeClient.test.ts
  ```

  Expected: existing checkout tests pass; new `mode: 'subscription'` tests return controlled disabled behavior before the subscription provider adapter is enabled.

### Phase 4: Catalog And Customer Wrapper

**Goal:** Add platform-owned catalog primitives that subscriptions can depend on.

- [x] **Step 1: Add routes**

  Add routes in `paymongo.routes.js`:

  ```text
  POST /customers
  GET /customers/:customerId
  POST /products
  GET /products/:productId
  POST /prices
  GET /prices/:priceId
  ```

- [x] **Step 2: Validate request ownership**

  Require tribe context whenever persistence is enabled. Store `tribeId` on every customer, product, and price record.

- [x] **Step 3: Add catalog smoke tests**

  Add provider-safe tests that create catalog records without charging a payment method.

- [x] **Step 4: Run tests**

  Run:

  ```powershell
  npm test -- tests/shared-services/payment-store.test.ts tests/shared-services/paymongo-provider.test.ts
  npm test -- tests/TribeClient.test.ts
  ```

### Phase 5: Subscription Wrapper Runtime

**Goal:** Add subscriptions behind a guarded provider adapter.

- [x] **Step 1: Add subscription routes**

  Add:

  ```text
  POST /subscriptions
  GET /subscriptions/:subscriptionId
  GET /subscriptions/by-reference/:referenceId
  POST /subscriptions/:subscriptionId/cancel
  POST /subscriptions/:subscriptionId/pause
  POST /subscriptions/:subscriptionId/resume
  POST /subscriptions/:subscriptionId/change-price
  GET /subscriptions/:subscriptionId/invoices
  GET /invoices/:invoiceId
  ```

- [x] **Step 2: Add runtime feature flag**

  Add a non-secret config value:

  ```text
  PAYMENT_SUBSCRIPTIONS_ENABLED=false
  ```

  Behavior:

  ```text
  false: routes exist but subscription creation returns 501 SUBSCRIPTIONS_DISABLED.
  true in test: subscription creation may call PayMongo test provider or internal recurring adapter.
  true in live: allowed only after Phase 8 live gates pass.
  ```

- [x] **Step 3: Implement subscription creation**

  `paymentCreateSubscription` should:

  ```text
  validate tribe context
  validate customer exists and belongs to tribe
  validate price exists, active, recurring, and belongs to tribe or platform catalog
  enforce idempotency by tribe_id + idempotency_key
  create provider subscription or recurring payment setup
  persist normalized subscription
  return subscription with canonical status
  ```

- [x] **Step 4: Implement lifecycle actions**

  Cancellation:

  ```text
  POST /subscriptions/:subscriptionId/cancel
  ```

  should support:

  ```ts
  {
    cancelAtPeriodEnd?: boolean;
    reason?: string;
  }
  ```

  Pause/resume/change-price update the guarded API Center subscription state while the live PayMongo recurring adapter remains disabled.

- [x] **Step 5: Run runtime tests**

  Run:

  ```powershell
  npm test -- tests/shared-services/paymongo-provider.test.ts
  ```

  Expected:

  ```text
  subscriptions disabled returns 501
  missing tribe returns 400 when persistence is enabled
  missing customer returns 404
  non-recurring price returns 400
  subscription creation persists normalized status in test mode
  cancel updates subscription status or cancel_at_period_end
  ```

### Phase 6: Webhooks And Lifecycle Events

**Goal:** Treat provider webhooks as the authority for payment, invoice, and subscription state.

- [x] **Step 1: Extend webhook event extraction**

  Modify `paymentEvents.js` to map provider events into:

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
  payment.refund.created
  payment.refund.succeeded
  payment.refund.failed
  ```

- [x] **Step 2: Persist subscription webhook events idempotently**

  Use provider event ID plus provider mode as the idempotency key.

- [x] **Step 3: Update API Center sanitizer and schemas**

  Add subscription and invoice lifecycle fields to:

  ```text
  api-center/src/shared-services/shared-service-event-sanitizer.ts
  api-center/src/kafka/schemas/shared-service-export.schemas.ts
  ```

  Sanitized events may include:

  ```text
  subscriptionId
  invoiceId
  paymentId
  checkoutId
  referenceId
  status
  amount
  currency
  provider
  providerMode
  ```

  Sanitized events must not include:

  ```text
  PayMongo secret keys
  webhook secrets
  raw authorization headers
  full customer card/bank data
  full webhook body
  ```

- [x] **Step 4: Run API Center tests**

  Run from `api-center`:

  ```powershell
  npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts
  ```

### Phase 7: Management Console And Smoke Tests

**Goal:** Make operators see checkout and subscription wrappers clearly.

- [x] **Step 1: Improve payment smoke-test UI**

  Modify `apicenter-management/src/components/shared-service-smoke-tests.tsx`.

  Payment should show separate operator groups:

  ```text
  Payment health
  Checkout session
  Subscription setup
  Subscription lifecycle
  Refund
  Webhook status
  ```

  Keep provider-impacting actions behind the existing confirmation checkbox.

- [x] **Step 2: Add safe subscription checks**

  Safe checks:

  ```text
  GET payment /health
  GET payment catalog route if available
  GET payment subscription route for known fake ID should return controlled 404
  ```

  Provider-impacting checks:

  ```text
  POST /customers
  POST /products
  POST /prices
  POST /subscriptions
  POST /subscriptions/:id/cancel
  ```

- [x] **Step 3: Update manifest/catalog UI**

  Update catalog copy to show:

  ```text
  payment = PayMongo-backed checkout and subscription wrapper
  ```

- [x] **Step 4: Run management checks**

  Run from `apicenter-management`:

  ```powershell
  npm test
  npm run build
  ```

### Phase 8: Test Environment Rollout

**Goal:** Prove the wrapper in test before touching live subscription traffic.

- [x] **Step 1: Keep live disabled**

  In production/live secrets or deployment env:

  ```text
  PAYMENT_SUBSCRIPTIONS_ENABLED=false
  ```

- [x] **Step 2: Enable test only**

  In test shared-services runtime:

  ```text
  PAYMENT_PROVIDER_MODE=test
  PAYMENT_SUBSCRIPTIONS_ENABLED=true
  ```

- [x] **Step 3: Sync Kubernetes secret/config**

  Use the existing secret-sync path after updating Secret Manager or config maps.

- [x] **Step 4: Roll out test payment service**

  Run:

  ```powershell
  kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
  ```

- [x] **Step 5: Run non-provider-impacting checks**

  Run health and route checks first.

- [ ] **Step 6: Run one provider-impacting test subscription**

  Use a test customer and a low-value test price. Confirm:

  ```text
  customer row exists
  product row exists
  price row exists
  subscription row exists
  invoice row exists if provider emits one
  webhook event row exists
  sanitized Confluent/S3 event exists
  no secrets appear in logs or events
  ```

  Partial direct-service verification completed on 2026-05-17. Still required:
  run through the API Center proxy with a tribe token, verify webhook/event export
  behavior, and confirm sanitized Confluent/S3 event delivery.

### Phase 9: Live Rollout Gates

**Goal:** Prevent accidental recurring charges.

- [ ] **Step 1: Confirm business readiness**

  Before live:

  ```text
  cancellation policy is written
  refund policy is written
  failed renewal handling is written
  customer support flow is written
  test-mode subscription was proven end to end
  live PayMongo account supports the required recurring product
  webhook event list is configured in PayMongo dashboard
  ```

- [ ] **Step 2: Enable live behind explicit approval**

  Only after approval, set:

  ```text
  PAYMENT_PROVIDER_MODE=live
  PAYMENT_SUBSCRIPTIONS_ENABLED=true
  ```

- [ ] **Step 3: Run one controlled live checkout**

  Run checkout first, not subscription.

- [ ] **Step 4: Run one controlled live subscription**

  Use an approved internal test customer. Immediately verify:

  ```text
  subscription status
  PayMongo dashboard state
  database records
  webhook event
  API Center analytics
  cancellation path
  ```

- [ ] **Step 5: Disable on abnormal behavior**

  If any state mismatch appears, set:

  ```text
  PAYMENT_SUBSCRIPTIONS_ENABLED=false
  ```

  and restart only `payment-service`.

---

## Slice 10: SDK Consumer Validation

**Goal:** Prove tribes can consume the Stripe-like PayMongo checkout and
subscription wrapper through `@implementsprint/sdk`, without direct PayMongo
credentials in tribe apps.

- [x] Added an SDK-level subscription smoke runner in
  `api-shared-services/src/smoke/paymentSubscriptionSmoke.ts`.
- [x] Exported the runner from the SDK and added
  `npm run smoke:payment-subscription:sdk`.
- [x] Covered the consumer call order with
  `api-shared-services/tests/payment-subscription-smoke.test.ts`.
- [x] Updated SDK payment request/response types for deterministic smoke IDs
  and provider observability fields.
- [x] Documented checkout and subscription consumption in
  `api-shared-services/docs/tribe-sdk-consumption.md` and
  `api-shared-services/docs/consumer-runbook.md`.
- [x] Ran the SDK smoke against test API Center through `smoke-tribe`.

Test evidence from 2026-05-17:

```text
npx vitest run tests/TribeClient.test.ts tests/payment-subscription-smoke.test.ts --pool threads
Test Files 2 passed
Tests 33 passed

npm run typecheck
passed

npm run build
passed

npm run smoke:payment-subscription:sdk
subscriptionStatus active
cancelStatus cancelled
provider paymongo
providerMode test
```

Runtime analytics after the SDK smoke:

```text
smoke-tribe -> payment
window 1h
totalRequests 15
successRequests 15
failedRequests 0
lastUsedAt 2026-05-17T08:21:35.140Z
```

Important ownership decision:

```text
tribe app -> @implementsprint/sdk -> API Center -> payment shared service -> PayMongo
```

Tribes configure only API Center runtime variables:

```text
APICENTER_URL
APICENTER_TRIBE_ID
APICENTER_TRIBE_SECRET
```

They do not configure PayMongo keys, PayMongo webhooks, or
`PAYMENT_PROVIDER_MODE`. Those remain platform/shared-service configuration.

---

## Required Verification Commands

Run these before marking the implementation complete.

From `api-shared-services`:

```powershell
npx vitest run tests/TribeClient.test.ts tests/payment-subscription-smoke.test.ts --pool threads
npm run typecheck
npm run build
npm run smoke:payment-subscription:sdk
```

From `api-center`:

```powershell
npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts
npm run build
```

From `apicenter-management`:

```powershell
npm test
npm run build
```

Live/test rollout verification:

```powershell
kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
kubectl -n api-center rollout status deploy/payment-service --timeout=5m
```

---

## Done Criteria

- Existing checkout SDK methods still work.
- Existing checkout routes remain backward compatible.
- Checkout response shape is normalized and Stripe-like.
- Subscription SDK methods exist and are documented.
- Subscription routes exist and return controlled disabled errors until enabled.
- Subscription persistence exists in `shared_payment`.
- Webhooks update checkout, payment, invoice, and subscription lifecycle state idempotently.
- API Center emits sanitized lifecycle events for checkout and subscriptions.
- Management smoke tests separate safe checks from provider-impacting checks.
- Test environment proves subscription lifecycle before live enablement.
- Live subscriptions require explicit operator approval and can be disabled quickly with `PAYMENT_SUBSCRIPTIONS_ENABLED=false`.

Follow-on rollout and handoff:

- Next phases:
  `docs/superpowers/plans/2026-05-17-payment-sdk-production-rollout-next-phases.md`
- Operator handoff:
  `docs/operations/payment-checkout-subscription-handoff.md`
