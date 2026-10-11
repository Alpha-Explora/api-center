---
title: "Payment Checkout And Subscription Handoff"
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["packages/contracts/src/index.ts","apps/payments/src/server.ts"]
---
# Payment Checkout And Subscription Handoff

## Tribe Contract

Tribes call `@implementsprint/sdk`.

Tribes configure only:

```text
APICENTER_URL
APICENTER_TRIBE_ID
APICENTER_TRIBE_SECRET
```

Tribes do not configure PayMongo keys, PayMongo webhooks, or provider mode.

## Platform Contract

API Center enforces auth, consumes policy, scopes, telemetry, and proxying.

The payment shared service owns PayMongo credentials, provider mode, and webhook
signature validation. PayMongo owns payment and subscription records. APICenter keeps
project ownership and reconciliation facts, verified webhook receipts, and event
delivery state in its payment schema.

## Test Evidence Checklist

- [x] SDK release gate passed for `@implementsprint/sdk@1.1.0`:
  `npm run ci` completed with 7 test files and 84 tests passing.
- [x] SDK build and package dry-run passed; tarball includes
  `dist/smoke/paymentSubscriptionSmoke.js`.
- [x] Test SDK smoke passed against test API Center with rebuilt SDK `1.1.0`:
  `sub_sdk_smoke_1779007801581` was created as `active`, cancelled as
  `cancelled`, with `provider: paymongo` and `providerMode: test`.
- [x] Runtime analytics after SDK `1.1.0` smoke showed
  `smoke-tribe -> payment`: 22 successful requests, 0 failed requests,
  last used at `2026-05-17T08:50:09.507Z`.
- [x] Test tribe static gates passed after adding subscription suite coverage:
  `npm run typecheck`, `npm run test`, and `npm run build`.
- [x] Management console static gates passed after adding the lifecycle smoke
  action: `npx tsc --noEmit` and `npm run build`.
- [x] Public test webhook URL reaches payment runtime signature validation:
  unsigned probe returned `INVALID_SIGNATURE`.
- [x] Sanitizer/schema tests passed for shared-service subscription export
  metadata: 2 suites and 7 tests passing.
- [ ] Published SDK package `@implementsprint/sdk@1.1.0` is available from
  GitHub Packages.
- [ ] Test tribe installs the published SDK package from GitHub Packages.
- [ ] Test tribe full suite passes against test API Center with payment
  subscription side effects enabled.
- [ ] Test webhook persistence passed; record provider event ID and database row
  timestamp.
- [ ] Test sanitized S3 export passed; record topic, S3 prefix, and object
  timestamp.
- [ ] Live checkout passed; record checkout ID and provider mode.
- [ ] Live subscription passed; record subscription ID, cancellation status, and
  rollback readiness.

## Rollback

Set:

```text
PAYMENT_SUBSCRIPTIONS_ENABLED=false
```

Then restart only `payment-service`.

Checkout can remain enabled while new subscription creation is disabled.
