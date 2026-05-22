# Payment SDK Production Rollout Next Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Stripe-like PayMongo checkout and subscription wrapper from test-proven SDK smoke into publishable SDK release, tribe-consumer validation, provider webhook proof, and controlled live rollout.

**Architecture:** Tribe services consume payments only through `@implementsprint/sdk`, which calls API Center gateway routes under `/api/v1/shared/payment/*`. API Center owns authentication, consumes/scope policy, telemetry, event sanitization, and proxying to the shared payment runtime; the shared payment runtime owns PayMongo credentials, provider mode, webhook signature validation, and persistence.

**Tech Stack:** Node.js 24, TypeScript, Vitest, Next.js management console, NestJS API Center, Kubernetes/GKE, Google Secret Manager, Supabase/Postgres `shared_payment`, Confluent Cloud, AWS S3, GitHub Packages.

---

## Current State

- Test API Center and test payment service are deployed with payment proxy response capture and subscription lifecycle forwarding.
- Test payment subscription flow has passed through API Center using `smoke-tribe`.
- `api-shared-services` has SDK methods for checkout, customer, product, price, subscription create/read/cancel and a platform smoke script:

```powershell
npm run smoke:payment-subscription:sdk
```

- Test analytics showed `smoke-tribe -> payment` with successful calls and zero failures after SDK smoke.
- Tribes must not configure PayMongo secrets, PayMongo webhooks, or `PAYMENT_PROVIDER_MODE`.

---

## File Map

### `api-shared-services`

- Modify: `C:\Codes\apic\api-shared-services\package.json`
  - Bump SDK version after the new payment subscription API is ready to publish.
  - Keep `smoke:payment-subscription:sdk`.
- Modify: `C:\Codes\apic\api-shared-services\package-lock.json`
  - Keep version and lock metadata aligned with `package.json`.
- Modify: `C:\Codes\apic\api-shared-services\src\TribeClient.ts`
  - Confirm `SDK_VERSION` matches the package version.
- Modify: `C:\Codes\apic\api-shared-services\PUBLISH.md`
  - Add the exact release command and smoke sequence for the payment subscription SDK release.
- Modify: `C:\Codes\apic\api-shared-services\docs\tribe-sdk-consumption.md`
  - Add the published version and the minimum payment subscription SDK version.

### `C:\Codes\test tribe`

- Modify: `C:\Codes\test tribe\package.json`
  - Update `@implementsprint/sdk` after publish.
- Modify: `C:\Codes\test tribe\package-lock.json`
  - Refresh lockfile from GitHub Packages.
- Modify: `C:\Codes\test tribe\app\api\tests\payment\route.ts`
  - Add subscription safe/full test coverage from the actual tribe app using SDK methods.
- Modify: `C:\Codes\test tribe\app\api\tests\all\route.ts`
  - Include the payment subscription sequence in the full suite only when side effects are enabled.
- Modify: `C:\Codes\test tribe\docs\shared-service-test-matrix.md`
  - Document checkout versus subscription coverage and side-effect rules.

### `apicenter-management`

- Modify: `C:\Codes\apic\apicenter-management\src\app\api\local\smoke-tests\shared-service\route.ts`
  - Keep allowlisting for customer/product/price/subscription routes and add any missing webhook-safe route only if needed.
- Modify: `C:\Codes\apic\apicenter-management\src\components\shared-service-smoke-tests-panel.tsx`
  - Add a visible payment subscription smoke flow with safe and provider-impacting states.
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
  - Add validation for subscription smoke payloads if the UI needs a structured request type.
- Modify: `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`
  - Add operator steps for SDK smoke, tribe-app smoke, webhook proof, and live enablement.

### `api-center`

- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-05-17-stripe-like-paymongo-checkout-subscriptions.md`
  - Mark Phase 8 Step 6 complete only after provider webhook and event export are proven.
- Modify: `C:\Codes\apic\api-center\docs\contracts\shared-service-export-events.md`
  - Confirm sanitized payment subscription lifecycle events are documented.
- Modify: `C:\Codes\apic\api-center\src\shared-services\payment-webhook.controller.spec.ts`
  - Add/adjust webhook forwarding tests if a missing subscription webhook event is found.
- Modify: `C:\Codes\apic\api-center\src\shared-services\shared-service-event-sanitizer.spec.ts`
  - Add missing subscription event redaction coverage if event payloads include new fields.

---

## Phase 1: SDK Release Readiness

**Goal:** Make the SDK publishable as the canonical tribe-facing payment wrapper.

### Task 1: Version The SDK Release

**Files:**
- Modify: `C:\Codes\apic\api-shared-services\package.json`
- Modify: `C:\Codes\apic\api-shared-services\package-lock.json`
- Modify: `C:\Codes\apic\api-shared-services\src\TribeClient.ts`

- [x] **Step 1: Inspect current version fields**

Run:

```powershell
Set-Location C:\Codes\apic\api-shared-services
node -e "const p=require('./package.json'); console.log(p.version)"
rg -n "SDK_VERSION|version" src\TribeClient.ts package-lock.json
```

Expected:

```text
package.json still shows the current SDK version.
TribeClient.SDK_VERSION is found in src\TribeClient.ts.
package-lock.json has matching package metadata.
```

- [x] **Step 2: Bump to the next patch or minor version**

Use patch if only exposing the already-added wrapper and smoke script. Use minor if the team wants to signal a new subscription API surface.

Run one of:

```powershell
npm version patch --no-git-tag-version
```

or:

```powershell
npm version minor --no-git-tag-version
```

Expected:

```text
package.json and package-lock.json both update to the same version.
```

- [x] **Step 3: Align `TribeClient.SDK_VERSION`**

Open `C:\Codes\apic\api-shared-services\src\TribeClient.ts` and set the SDK version constant to the package version.

Expected shape:

```ts
static readonly SDK_VERSION = '1.0.4';
```

Use the actual version from `package.json`, not the example value.

- [x] **Step 4: Verify release build gates**

Run:

```powershell
npm run typecheck
npm run build
npx vitest run tests/TribeClient.test.ts tests/payment-subscription-smoke.test.ts --pool threads
npm run pack:check
```

Expected:

```text
typecheck passes
build passes
2 test files pass
npm pack --dry-run includes dist, src, README.md, package.json
```

Verification evidence:

```text
npm run ci passed for @implementsprint/sdk@1.1.0:
7 test files passed, 84 tests passed, build passed, pack dry-run produced
implementsprint-sdk-1.1.0.tgz.

npm run smoke:payment-subscription:sdk passed against test API Center:
subscriptionStatus active
cancelStatus cancelled
provider paymongo
providerMode test
```

- [ ] **Step 5: Commit SDK release readiness**

Run:

```powershell
git status --short
git add package.json package-lock.json src/TribeClient.ts
git commit -m "chore: prepare payment subscription sdk release"
```

Expected:

```text
Commit contains only SDK version metadata and SDK version constant changes.
```

Current blocker:

```text
Skipped for now because the repository is on main with a large existing dirty
payment worktree. The SDK release gate itself passed for version 1.1.0, but
commit/tag/push should be done as an intentional release commit that includes
the full SDK subscription wrapper.
```

### Task 2: Update SDK Release Docs

**Files:**
- Modify: `C:\Codes\apic\api-shared-services\PUBLISH.md`
- Modify: `C:\Codes\apic\api-shared-services\docs\tribe-sdk-consumption.md`

- [x] **Step 1: Add payment subscription release checklist to `PUBLISH.md`**

Add this section under the GitHub Actions publish section:

````markdown
## Payment Subscription Release Checklist

Before tagging a release that includes payment subscriptions:

```powershell
npm run typecheck
npm run build
npx vitest run tests/TribeClient.test.ts tests/payment-subscription-smoke.test.ts --pool threads
npm run pack:check
```

After the package is published, validate the consumer path against test:

```powershell
$env:APICENTER_GATEWAY_URL = "https://api-center-test.itsandbox.site"
$env:APICENTER_TRIBE_ID = "smoke-tribe"
$env:APICENTER_TRIBE_SECRET = $env:SMOKE_TRIBE_SECRET
npm run smoke:payment-subscription:sdk
```

Do not publish if the smoke result does not return `provider: "paymongo"` and
`providerMode: "test"` in test.
````

- [x] **Step 2: Add minimum SDK version note to `tribe-sdk-consumption.md`**

Add this under `## What You Install`:

```markdown
Payment subscription wrappers require the SDK version published from the
payment subscription release or newer. Checkout-only consumers can remain on
older versions, but new tribe integrations should use the latest SDK package.
```

- [x] **Step 3: Verify docs contain no stale version claims**

Run:

```powershell
rg -n "1\.0\.3|payment subscription|smoke:payment-subscription:sdk" PUBLISH.md docs\tribe-sdk-consumption.md
```

Expected:

```text
No stale mandatory version remains unless it is intentionally describing an older example.
The payment subscription smoke script appears in PUBLISH.md.
```

- [ ] **Step 4: Commit docs**

Run:

```powershell
git add PUBLISH.md docs/tribe-sdk-consumption.md
git commit -m "docs: document payment subscription sdk release checks"
```

Current blocker:

```text
Skipped for now for the same release-commit reason as Task 1 Step 5.
```

---

## Phase 2: Publish And Verify The SDK Package

**Goal:** Make the new payment wrapper available to tribe repositories through GitHub Packages.

### Task 3: Publish Through Existing Release Workflow

**Files:**
- Read: `C:\Codes\apic\api-shared-services\.github\workflows\release.yml`

- [ ] **Step 1: Inspect release workflow**

Run:

```powershell
Set-Location C:\Codes\apic\api-shared-services
Get-Content .github\workflows\release.yml
```

Expected:

```text
Workflow publishes on semver tag or workflow_dispatch.
Workflow has packages: write permission.
Workflow runs validation before npm publish.
```

- [ ] **Step 2: Create and push the matching tag**

Replace `v1.0.4` with the actual version from `package.json`.

Run:

```powershell
$version = node -p "require('./package.json').version"
git tag "v$version"
git push origin "v$version"
```

Expected:

```text
GitHub Actions release workflow starts for the tag.
```

- [ ] **Step 3: Watch the release workflow**

Run:

```powershell
gh run list --workflow release.yml --limit 5
gh run watch
```

Expected:

```text
Release workflow completes successfully.
```

- [ ] **Step 4: Confirm the published package version**

Run:

```powershell
npm view @implementsprint/sdk version --registry=https://npm.pkg.github.com
```

Expected:

```text
The returned version matches package.json.
```

If this returns `401`, fix GitHub Packages auth first. Do not change SDK runtime code to solve an install-time registry token problem.

Current blocker:

```text
npm view @implementsprint/sdk@1.1.0 version --registry=https://npm.pkg.github.com
returned 401 Unauthorized because the local shell has no GitHub Packages token.
gh auth status also showed no logged-in GitHub host. Publishing/installing from
GitHub Packages is blocked until GitHub/package credentials are available.
```

---

## Phase 3: Real Tribe App Consumption

**Goal:** Prove a tribe repo can install the published SDK and run checkout/subscription tests through API Center.

### Task 4: Update The Test Tribe Package

**Files:**
- Modify: `C:\Codes\test tribe\package.json`
- Modify: `C:\Codes\test tribe\package-lock.json`

- [ ] **Step 1: Install the newly published SDK**

Run:

```powershell
Set-Location "C:\Codes\test tribe"
if (-not $env:GITHUB_PACKAGES_READ_TOKEN) { throw "Set GITHUB_PACKAGES_READ_TOKEN before installing the SDK." }
$env:GITHUB_TOKEN = $env:GITHUB_PACKAGES_READ_TOKEN
npm install @implementsprint/sdk@latest
Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
```

Expected:

```text
package.json dependency for @implementsprint/sdk points at the new version range.
package-lock.json resolves @implementsprint/sdk from https://npm.pkg.github.com.
```

Current blocker:

```text
Blocked until @implementsprint/sdk@1.1.0 is published and GitHub Packages read
auth is available. The local shell currently has no package token.
```

- [ ] **Step 2: Verify installed version**

Run:

```powershell
node -p "require('./node_modules/@implementsprint/sdk/package.json').version"
```

Expected:

```text
Installed version matches the package published in Phase 2.
```

Current blocker:

```text
Blocked by the same package publish/install prerequisite.
```

- [x] **Step 3: Run existing test tribe gates**

Run:

```powershell
npm run typecheck
npm run test
npm run build
```

Expected:

```text
All existing test tribe checks pass before adding new subscription coverage.
```

### Task 5: Add Subscription Flow To Test Tribe Payment Tests

**Files:**
- Modify: `C:\Codes\test tribe\app\api\tests\payment\route.ts`
- Modify: `C:\Codes\test tribe\app\api\tests\all\route.ts`
- Modify: `C:\Codes\test tribe\docs\shared-service-test-matrix.md`

- [x] **Step 1: Inspect existing payment test route**

Run:

```powershell
Set-Location "C:\Codes\test tribe"
Get-Content app\api\tests\payment\route.ts
Get-Content app\api\tests\all\route.ts
```

Expected:

```text
Payment route already uses @implementsprint/sdk and honors side-effect gating.
All route includes payment in the shared-services suite.
```

- [x] **Step 2: Add subscription test helper to payment route**

Add a helper with this shape, adapting only local response wrapper names to match the file:

```ts
async function runPaymentSubscriptionTest(apiCenter: TribeClient) {
  const suffix = Date.now().toString();
  const customer = await apiCenter.paymentCreateCustomer({
    customerId: `cus_test_tribe_${suffix}`,
    email: 'test-tribe-payment@example.com',
    name: 'Test Tribe Payment Customer',
    metadata: { source: 'test-tribe-payment-route' },
  });

  const product = await apiCenter.paymentCreateProduct({
    productId: `prod_test_tribe_${suffix}`,
    name: 'Test Tribe Subscription',
    metadata: { source: 'test-tribe-payment-route' },
  });

  const price = await apiCenter.paymentCreatePrice({
    priceId: `price_test_tribe_${suffix}`,
    productId: product.productId,
    amount: { value: 10000, currency: 'PHP' },
    recurring: { interval: 'month', intervalCount: 1 },
    metadata: { source: 'test-tribe-payment-route' },
  });

  const subscription = await apiCenter.paymentCreateSubscription({
    subscriptionId: `sub_test_tribe_${suffix}`,
    referenceId: `test-tribe-subscription-${suffix}`,
    idempotencyKey: `test-tribe-subscription-${suffix}`,
    customerId: customer.customerId,
    priceId: price.priceId,
    metadata: { source: 'test-tribe-payment-route' },
  });

  const readBack = await apiCenter.paymentGetSubscription(subscription.subscriptionId);
  const cancelled = await apiCenter.paymentCancelSubscription(subscription.subscriptionId, {
    cancelAtPeriodEnd: false,
    reason: 'test_tribe_cleanup',
  });

  return {
    customerId: customer.customerId,
    productId: product.productId,
    priceId: price.priceId,
    subscriptionId: subscription.subscriptionId,
    subscriptionStatus: readBack.status,
    cancelStatus: cancelled.status,
    provider: subscription.provider,
    providerMode: subscription.providerMode,
  };
}
```

- [x] **Step 3: Gate subscription side effects**

In the payment route, run the subscription helper only when the request or environment enables side effects.

Expected behavior:

```text
Safe mode checks health and non-mutating status/discovery only.
Full mode creates a low-value test subscription and cancels it immediately.
```

- [x] **Step 4: Include payment subscription in all-tests route**

In `app\api\tests\all\route.ts`, keep subscription coverage inside the full suite only.

Expected response field:

```json
{
  "serviceId": "payment",
  "scenario": "subscription",
  "sideEffects": true,
  "ok": true
}
```

- [x] **Step 5: Document the matrix**

Add this row to `docs\shared-service-test-matrix.md`:

```markdown
| Payment subscription | Full only | Creates customer/product/price/subscription through SDK, reads it, cancels it, and checks API Center analytics. |
```

- [x] **Step 6: Verify test tribe**

Run:

```powershell
npm run typecheck
npm run test
npm run build
```

Expected:

```text
TypeScript passes.
Vitest passes.
Next build passes.
```

- [ ] **Step 7: Run the full suite against test API Center**

Start the app if needed:

```powershell
npm run dev
```

Then run from another shell:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/tests/all -ContentType 'application/json' -Body (@{ includeSideEffects = $true } | ConvertTo-Json) | ConvertTo-Json -Depth 10
```

Expected:

```text
Payment subscription scenario passes.
No PayMongo secret is present in C:\Codes\test tribe\.env.local.
API Center analytics increments payment usage for the test tribe.
```

Current blocker:

```text
Do not run this until the test tribe installs the published SDK version with
payment subscription methods. Static typecheck, Vitest, and Next build already
passed after adding the subscription suite path.
```

---

## Phase 4: Management Console Smoke UX

**Goal:** Let operators run the same subscription validation from the management console without hand-writing API calls.

### Task 6: Add Subscription Smoke UI

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\components\shared-service-smoke-tests-panel.tsx`
- Modify: `C:\Codes\apic\apicenter-management\src\lib\schemas.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\app\api\local\smoke-tests\shared-service\route.ts`

- [x] **Step 1: Inspect current smoke panel**

Run:

```powershell
Set-Location C:\Codes\apic\apicenter-management
Get-Content src\components\shared-service-smoke-tests-panel.tsx
Get-Content src\lib\schemas.ts
Get-Content src\app\api\local\smoke-tests\shared-service\route.ts
```

Expected:

```text
Current panel has shared-service smoke actions.
Route allowlist already contains payment customer/product/price/subscription paths.
```

- [x] **Step 2: Add a two-stage payment smoke action**

Add UI behavior:

```text
Payment health smoke: safe, always available.
Payment subscription smoke: provider-impacting, requires explicit checkbox or confirmation.
```

The subscription smoke sequence must call:

```text
POST payment /customers
POST payment /products
POST payment /prices
POST payment /subscriptions
GET payment /subscriptions/<id>
POST payment /subscriptions/<id>/cancel
GET payment /subscriptions/<id>
```

- [x] **Step 3: Keep route allowlist strict**

Allowed route keys should include only:

```ts
"POST payment /customers",
"POST payment /products",
"POST payment /prices",
"POST payment /subscriptions",
```

Allowed route patterns should include only:

```ts
/^GET payment \/subscriptions\/[^/]+$/,
/^POST payment \/subscriptions\/[^/]+\/cancel$/,
```

- [x] **Step 4: Add tests or run manual smoke if test harness is not present**

Run:

```powershell
npm run typecheck
npm run build
```

Expected:

```text
Management app builds.
The smoke panel can run health without side effects.
The subscription action requires explicit operator confirmation.
```

- [x] **Step 5: Update operator runbook**

Add a section to `docs\operations\apicenter-management-runbook.md`:

```markdown
### Payment Subscription Smoke

Use this only in test unless live rollout has been explicitly approved.

1. Open `/shared-services`.
2. Run payment health smoke.
3. Enable provider-impacting smoke.
4. Run payment subscription smoke.
5. Confirm customer, product, price, subscription, cancellation, analytics, and sanitized event export.
```

---

## Phase 5: Webhook And Event Export Proof

**Goal:** Close the remaining Phase 8 gap: prove provider webhook persistence and sanitized export for subscription lifecycle events.

### Task 7: Prove Test Webhooks Reach The Payment Runtime

**Files:**
- Read: `C:\Codes\apic\api-center\src\shared-services\payment-webhook.controller.ts`
- Read: `C:\Codes\apic\api-shared-services\shared-services\paymongo\src\routes\paymongo.routes.js`
- Read: `C:\Codes\apic\api-shared-services\shared-services\paymongo\src\services\paymongo\paymentEvents.js`

- [x] **Step 1: Confirm public webhook URLs**

Use these URLs:

```text
Test: https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks
Live: https://api-center.itsandbox.site/api/v1/shared/payment/webhooks
```

Expected:

```text
PayMongo test dashboard uses the test URL.
PayMongo live dashboard uses the live URL only when live rollout is approved.
```

- [x] **Step 2: Send an unsigned reachability probe to test**

Run:

```powershell
Invoke-WebRequest -Method Post -Uri https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks -ContentType 'application/json' -Body '{}'
```

Expected:

```text
HTTP 401 or controlled INVALID_SIGNATURE from the payment runtime.
This proves the public route reaches webhook signature validation.
```

- [ ] **Step 3: Trigger real PayMongo test event**

From PayMongo test dashboard or the test checkout/subscription action:

```text
Create a test subscription.
Complete any required test provider action.
Cancel the subscription.
```

Expected:

```text
payment_webhook_events has the event rows.
subscription row changes status.
payment or invoice rows appear if PayMongo emits them for the event.
```

Current blocker:

```text
Requires PayMongo dashboard/test-provider action. The public test webhook URL
was probed and returned INVALID_SIGNATURE, proving the request reaches the
payment runtime signature validator.
```

- [ ] **Step 4: Query shared payment persistence**

Run the project-approved Supabase query path for test DB:

```sql
select provider_event_id, event_type, provider_mode, processed_at
from shared_payment.payment_webhook_events
order by received_at desc
limit 20;

select subscription_id, provider_mode, status, latest_invoice_id, latest_payment_id, updated_at
from shared_payment.subscriptions
order by updated_at desc
limit 20;
```

Expected:

```text
Webhook event rows exist for the test subscription lifecycle.
No raw secrets, signatures, or provider secret keys are stored in event payload columns.
```

Current blocker:

```text
Requires DB query credentials/session for the test shared_payment schema after a
real PayMongo test event is triggered.
```

### Task 8: Prove Sanitized Kafka/S3 Export

**Files:**
- Modify if needed: `C:\Codes\apic\api-center\src\shared-services\shared-service-event-sanitizer.spec.ts`
- Modify if needed: `C:\Codes\apic\api-center\src\kafka\schemas\shared-service-export.schemas.spec.ts`
- Modify: `C:\Codes\apic\api-center\docs\contracts\shared-service-export-events.md`

- [x] **Step 1: Run sanitizer and schema tests**

Run:

```powershell
Set-Location C:\Codes\apic\api-center
npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts
```

Expected:

```text
Tests pass for payment checkout, payment, invoice, and subscription lifecycle event shapes.
```

- [ ] **Step 2: Check Kafka publish path after SDK smoke**

Use API Center logs and Confluent topic inspection for the test topic prefix.

Expected:

```text
Sanitized shared-service payment event is published.
Payload includes tribe ID, shared service ID, event type, provider mode, status, and object IDs.
Payload excludes provider secret keys, webhook signatures, authorization headers, and raw customer payment credentials.
```

Current blocker:

```text
Requires Confluent/topic inspection access after running the provider-impacting
payment subscription smoke.
```

- [ ] **Step 3: Check S3 sink delivery**

Confirm the connector includes the shared-service export topic and that S3 receives objects under the expected topic folder.

Expected:

```text
S3 has new objects for the shared-service export topic after connector flush.
No secret-bearing payload is present.
```

Current blocker:

```text
Requires Confluent S3 connector/AWS S3 inspection access after Kafka export is
confirmed.
```

- [ ] **Step 4: Update plan completion evidence**

In `C:\Codes\apic\api-center\docs\superpowers\plans\2026-05-17-stripe-like-paymongo-checkout-subscriptions.md`, mark Phase 8 Step 6 complete only after Steps 1-3 pass.

---

## Phase 6: Live Readiness Gates

**Goal:** Enable live only after test proof, business readiness, and operator rollback are all confirmed.

### Task 9: Confirm Live Business And Provider Readiness

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-05-17-stripe-like-paymongo-checkout-subscriptions.md`
- Modify: `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`

- [ ] **Step 1: Confirm required policy docs exist**

Checklist:

```text
cancellation policy is written
refund policy is written
failed renewal handling is written
customer support flow is written
test-mode subscription was proven end to end
live PayMongo account supports the required recurring product
PayMongo live webhook URL is configured
PayMongo live webhook secret is stored in Secret Manager
```

Expected:

```text
No live subscription traffic starts until every checklist item is true.
```

- [ ] **Step 2: Confirm production config says live, not boolean true**

Production target must use:

```text
PAYMENT_PROVIDER_MODE=live
PAYMENT_SUBSCRIPTIONS_ENABLED=true
```

Do not use:

```text
PAYMENT_PROVIDER_MODE=true
```

Expected:

```text
Provider mode is the literal string live.
Subscriptions are enabled by the feature flag only after approval.
```

- [ ] **Step 3: Roll out live payment service after approval**

Run:

```powershell
kubectl -n api-center rollout status deploy/payment-service --timeout=5m
kubectl -n api-center get deploy payment-service -o jsonpath="{.spec.template.spec.containers[0].image}"
```

Expected:

```text
Deployment rolls out successfully.
Image tag matches the intended payment-service build.
```

### Task 10: Controlled Live Checkout Then Subscription

**Files:**
- Modify: `C:\Codes\apic\api-center\docs\superpowers\plans\2026-05-17-stripe-like-paymongo-checkout-subscriptions.md`

- [ ] **Step 1: Run one controlled live checkout**

Use a platform-approved internal customer and low-value item.

Expected:

```text
checkout session is created
PayMongo dashboard shows the live checkout
shared_payment.checkout_sessions stores provider_mode live
API Center analytics records payment usage
```

- [ ] **Step 2: Run one controlled live subscription**

Use the SDK or management smoke path only after checkout passes.

Expected:

```text
subscription is created
providerMode is live
database row exists
webhook event row arrives
subscription cancellation works
API Center analytics records success
```

- [ ] **Step 3: Roll back immediately on mismatch**

If any state mismatch appears, set:

```text
PAYMENT_SUBSCRIPTIONS_ENABLED=false
```

Then restart only:

```powershell
kubectl -n api-center rollout restart deploy/payment-service
kubectl -n api-center rollout status deploy/payment-service --timeout=5m
```

Expected:

```text
Checkout may remain available.
New subscription creation is disabled.
Existing records remain queryable.
```

---

## Phase 7: Operations And Support Hardening

**Goal:** Make the payment wrapper maintainable after first live use.

### Task 11: Add Operator Alerts For Subscription Failures

**Files:**
- Modify: `C:\Codes\apic\apicenter-management\src\app\api\local\analytics\alerts\route.ts`
- Modify: `C:\Codes\apic\apicenter-management\src\components\alerts-panel.tsx`
- Modify: `C:\Codes\apic\apicenter-management\docs\operations\apicenter-management-runbook.md`

- [x] **Step 1: Inspect alert route and panel**

Run:

```powershell
Set-Location C:\Codes\apic\apicenter-management
Get-Content src\app\api\local\analytics\alerts\route.ts
Get-Content src\components\alerts-panel.tsx
```

Expected:

```text
Existing alert route reads API Center analytics or local analytics endpoints.
Panel renders active alerts.
```

- [x] **Step 2: Add payment subscription alert conditions**

Alert conditions:

```text
payment shared-service error rate > 5% over 1h
payment subscription cancellation failures > 0 over 1h, if exposed by analytics
payment webhook invalid signature spikes over baseline
payment webhook processing failures > 0 over 1h
```

Current implementation note:

```text
API Center already emits a shared-service error-rate alert when payment exceeds
5% errors. Management now routes payment alerts to payment usage and payment
smoke actions. Dedicated webhook/cancellation counters still require API Center
analytics fields before separate alert types can be emitted.
```

- [x] **Step 3: Verify alert UI**

Run:

```powershell
npm run typecheck
npm run build
```

Expected:

```text
Build passes and alerts panel still renders current alert data.
```

### Task 12: Add Final Handoff Checklist

**Files:**
- Create: `C:\Codes\apic\api-center\docs\operations\payment-checkout-subscription-handoff.md`

- [x] **Step 1: Create handoff document**

Create:

```markdown
# Payment Checkout And Subscription Handoff

## Tribe Contract

Tribes call `@implementsprint/sdk`.
Tribes configure only `APICENTER_URL`, `APICENTER_TRIBE_ID`, and `APICENTER_TRIBE_SECRET`.
Tribes do not configure PayMongo keys, PayMongo webhooks, or provider mode.

## Platform Contract

API Center enforces auth, consumes policy, scopes, telemetry, and proxying.
The payment shared service owns PayMongo credentials, provider mode, webhook signature validation, and payment persistence.

## Test Evidence Checklist

- [ ] SDK tests passed; record command, timestamp, and result.
- [ ] SDK build passed; record command, timestamp, and result.
- [ ] Test SDK smoke passed; record subscription ID, provider, provider mode, and cancellation status.
- [ ] Test tribe full suite passed; record route, timestamp, and payment scenario result.
- [ ] Test webhook persistence passed; record provider event ID and database row timestamp.
- [ ] Test sanitized S3 export passed; record topic, S3 prefix, and object timestamp.
- [ ] Live checkout passed; record checkout ID and provider mode.
- [ ] Live subscription passed; record subscription ID, cancellation status, and rollback readiness.

## Rollback

Set `PAYMENT_SUBSCRIPTIONS_ENABLED=false` and restart only `payment-service`.
```

- [x] **Step 2: Link the handoff from the active plan**

Add a link in:

```text
C:\Codes\apic\api-center\docs\superpowers\plans\2026-05-17-stripe-like-paymongo-checkout-subscriptions.md
```

Expected:

```text
Future operators can find the final payment handoff from the original phased plan.
```

---

## Required Verification Commands

Run these before marking this next-phase plan complete.

From `C:\Codes\apic\api-shared-services`:

```powershell
npm run typecheck
npm run build
npx vitest run tests/TribeClient.test.ts tests/payment-subscription-smoke.test.ts --pool threads
npm run pack:check
npm run smoke:payment-subscription:sdk
```

From `C:\Codes\test tribe`:

```powershell
npm run typecheck
npm run test
npm run build
```

From `C:\Codes\apic\apicenter-management`:

```powershell
npm run typecheck
npm run build
```

From `C:\Codes\apic\api-center`:

```powershell
npm test -- src/shared-services/shared-service-event-sanitizer.spec.ts src/kafka/schemas/shared-service-export.schemas.spec.ts
npm run build
```

Kubernetes rollout checks:

```powershell
kubectl -n api-center-test rollout status deploy/payment-service --timeout=5m
kubectl -n api-center rollout status deploy/payment-service --timeout=5m
```

Runtime checks:

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/local/analytics/shared-service-usage?window=1h" | ConvertTo-Json -Depth 8
Invoke-WebRequest -Method Post -Uri https://api-center-test.itsandbox.site/api/v1/shared/payment/webhooks -ContentType 'application/json' -Body '{}'
```

---

## Done Criteria

- Published SDK package contains the payment subscription wrapper and smoke runner.
- Test tribe installs the published SDK from GitHub Packages, not a local file dependency.
- Test tribe full suite validates checkout and subscription through the SDK.
- Management console has explicit safe versus provider-impacting payment smoke behavior.
- Test provider webhook events persist in `shared_payment.payment_webhook_events`.
- Test subscription lifecycle state persists in `shared_payment.subscriptions`.
- Sanitized shared-service payment events reach Kafka/S3 without secrets.
- Production `PAYMENT_PROVIDER_MODE` is `live`, not `true`.
- Live subscription creation is enabled only after business, provider, webhook, and rollback gates pass.
- Rollback path disables new subscriptions without removing checkout support.
