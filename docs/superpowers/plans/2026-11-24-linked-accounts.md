---
title: Linked accounts implementation plan
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: [docs/superpowers/specs/2026-11-21-payouts-design.md, docs/adr/0008-project-payouts-through-resolved-merchant-accounts.md, apps/payments/src/features/payouts/merchant-accounts.ts, apps/payments/src/features/payouts/payout-executor.ts, apps/payments/src/shared/paymongo-client.ts, apps/payments/src/features/webhooks/webhooks.service.ts, apps/gateway/src/domains/control-plane/control-plane-admin.service.ts, supabase/migrations/20261121001200_payouts.sql]
---
# Linked Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a project its own PayMongo child (merchant) account, onboarded through PayMongo's hosted ID check, so the project becomes the merchant of record and APICenter stays the middleman. Route a moved project's payments into that account, and pay out from whichever account holds the money. Let projects record how they verified each payee. Everything new is off by default.

**Architecture:** A new `apps/payments/src/features/linked-accounts/` feature in the payments runtime. It has five parts:
- a pure lifecycle module (states, events, next action)
- a Postgres store with an in-memory fallback
- a `LinkedAccountsProvider` port, with a fake adapter and a PayMongo adapter
- an idempotent onboarding service, advanced by calls and by account webhooks
- console routes in the gateway that forward to the runtime with a signed context and write audit entries

The payouts plan's merchant-account resolver stays the only reader of `project_merchant_accounts`. Payment creation and the payout executor take their account from it, so moving a project is a data change.

**Tech Stack:** Same as the [payouts plan](2026-11-21-payouts.md): TypeScript on Node 24, Express 5, `pg`, zod and Jest 30 in the runtime; NestJS in the gateway; Next.js 16 in the console; OpenAPI 3.2 and AsyncAPI 3.1; Supabase Postgres migrations.

**Spec:** [Payouts design → Moving a project to a child account](../specs/2026-11-21-payouts-design.md#moving-a-project-to-a-child-account), [ADR-0008](../../adr/0008-project-payouts-through-resolved-merchant-accounts.md), and this plan's Responsibilities and Global Constraints. Branch `feat/linked-accounts` from `feat/payouts`. This plan continues the payouts task numbers but is a separate plan.

**Phases:**
- **Phase A (Tasks 15 to 25):** account lifecycle, sandbox provider, console, webhook ingress, collection routing, multi-account payouts and the payee verification record are implemented on `feat/linked-accounts`. Live onboarding and capability provisioning remain open. Both linked-account switches default off.
- **Phase B (held):** payee (consumer) child accounts as an optional destination type. Not planned in detail until PayMongo answers the questions in [Phase B](#phase-b-held-payee-consumer-accounts).

## Responsibilities

APICenter is the organization's shared payments API. It owns the mechanism and the safety of the money. Each product owns the rules about its own users, and APICenter never encodes one product's rules.

**Products own** (APICenter provides the listed mechanism and nothing more):

| Concern | APICenter provides |
|---|---|
| Who is paid, how much, and when a share is released | Allocations, release and cancel |
| Payout day, hour, cash-out minimum, daily cap, fee bearer | Per-project payout settings |
| Verifying who their payees are | The payee verification record (Task 24) |
| Eligibility rules, such as age | PayMongo's rejection reason, passed through |
| A person who works for two products | Nothing: each project's payee stands alone |
| Telling their users about checks, links and payouts | Events |
| Screens for their users | The API and SDK |
| Payee taxes, disputes with their customers, payee offboarding | Earnings reads, refunds with clawback, payee suspension |
| Retrying when the provider is busy | `429` with `Retry-After`; retrying with the same idempotency key is safe |

**APICenter owns:**
- Money correctness: exactly-once payouts, payments landing in and refunded through the right account, and project isolation.
- The PayMongo relationship: the parent account is Alpha Explora's, so pricing, settlement, chargeback liability and enabling features are APICenter's questions.
- Keys: the secret key and every `Account-ID` header.
- Which projects may have a child account, decided by platform admins, because Alpha Explora answers to PayMongo for every child it creates.
- Audit entries for console actions, and runbooks for moving and offboarding a project.
- The legal floor. If the lawyer requires verified payees before live payouts, APICenter enforces it for every project. Products may be stricter on their side.

APICenter does not invoice projects for its fee. It reports each project's volume; billing belongs to the organization's finance process.

## Probe result (2026-11-24, test key, read-only)

| Call | Result |
|---|---|
| `GET /v2/accounts` | 404 `The requested route does not exist` |
| `GET /v1/accounts` | 200 `{"has_more":false,"data":[]}` |
| `GET /v2/accounts/org_doesnotexist000` | 404 `Account not found` (the route exists and the key is allowed) |
| `GET /v2/accounts/{id}/identity_verification` | 404 route (expected: it is a `POST`) |

With plan approval, the test-mode create returned `201` and the shared ID `org_test_merchant`. The list stayed empty. GET, empty and synthetic business PATCH, hosted verification and activation each returned `200` with the test key. The verification response used `data.url` and a numeric `data.expired_at`, and the URL pointed at `example.com`. See the [redacted contract fixture](../../../tests/fixtures/paymongo/linked-accounts/sandbox-contract.json).

PayMongo documents that its test Accounts API returns mock responses without persisting an account. An empty PATCH succeeded and activation returned a mock response, so these checks did not establish the live activation fields or idempotency guarantees. There was no usable hosted session or delivered account webhook to capture. The runtime supports the documented parent account event payloads and the test signature/livemode exception. Capability requests and live onboarding require further verification. [PayMongo sandbox testing](https://docs.paymongo.com/docs/onboarding-aas-testing)

### Implementation status

| Tasks | State |
|---|---|
| 15 | Test endpoint and response shape captured. Live activation requirements, idempotency, a working hosted session, capability request and end-to-end webhook delivery are open. |
| 16–18 | Lifecycle, migrations, environment and project switches, and merchant-account resolver implemented. |
| 19–21 | Mock and PayMongo sandbox adapters, onboarding storage and verified lifecycle callbacks implemented. A lost create remains pending if its account cannot be proved. Live provider onboarding and capability provisioning remain open. |
| 22–23 | Collections and retries retain the originally selected account. Reads and refunds use ownership records. Payout pools and reporting are split by account. Child delivery uses its own account-scoped signing secret. |
| 24 | Projects can record payee verification through the API and SDK. Optional payout enforcement defaults off. |
| 25 | Console state, write permissions, audit, wallet overview, and operator runbook implemented. The test account cannot route collections because it has no verified wallet. |

The public payee verification route uses the existing payments API namespace, `PUT /api/v1/payments/payees/{payeeId}/verification`. One-account cash-out keeps the existing response. Additional payouts for the same cash-out appear in `additionalPayouts`.

## Global Constraints

**Switches**
- `LINKED_ACCOUNTS_ENABLED` is off unless it equals `'true'`. It is read per runtime, so test and live switch separately.
- A project may also need its own switch: `shared_payment.project_linked_account_settings.enabled`, set only by platform admins. Onboarding and moving need both switches on.
- While either switch is off for a project:
  - Its onboarding and move routes return `503` with code `LINKED_ACCOUNTS_DISABLED`, and make no PayMongo call.
  - `MerchantAccountResolver.resolve` returns `parent` for it.
- `MerchantAccountResolver.get` is never gated. Money already in a child wallet stays payable and refundable.
- Account webhooks are always verified and recorded, so an account mid-onboarding when a switch flips keeps its true state.

**Identity**
- PayMongo's hosted ID page only (`POST /v2/accounts/{id}/identity_verification`, link valid 72 hours). ID images and selfies never reach APICenter.
- The hosted URL is returned once and never stored. Only `verification_expires_at` is stored. A lost link is reissued.
- Details forwarded to PayMongo (business name, TIN, expected volume, the representative's name and email) are not persisted.
- After 3 failed checks an account is `manual_review` and `wallet_only` (PayMongo reviews it in 7 to 14 days). APICenter does not issue a fourth link.

**Accounts**
- Every child is a direct child of the Alphaexplora parent.
- Project merchant accounts are onboarded from the console only.
- Activation never moves a project. Moving is an explicit console action that inserts a `project_merchant_accounts` row with `effective_from = now()`.
- `Account-ID` is built only from a `shared_payment.merchant_accounts` row. No route accepts a PayMongo account id from a caller.
- Payment intents, checkout sessions and payment links (and their refunds) follow the resolver. Customers, catalog, subscriptions and invoices stay on the parent account.

**Transfers**
- A payout is the same ledger record and the same public event whether it comes from the parent or a child. The only differences are `merchant_account_id`, the source wallet and the `Account-ID` header.

**Retention**
- `linked_accounts` and `linked_account_events` hold no personal details and are kept 5 years after an account closes (AMLA record keeping).

**Conventions** are those of the payouts plan: integer centavos, `'PHP'`, single-transaction migrations with RLS for `payments_runtime`, `IdempotencyKey` and `409 IdempotencyConflict` on every mutation, no `paymongo_` in public contracts, `contractVersion: '2.0'` events. Releases: SDK 3.4.0 and contracts 1.3.0, recorded in `CHANGELOG.md` under Unreleased → Added.

## Blockers

**Before any project moves to a child account (ask PayMongo):**
1. Can child-account payments carry an Alpha Explora platform fee or split? If not, the fee is billed from APICenter's volume reports.
2. Do child-account payments settle into the child's wallet, and how fast? If they settle only to the project's bank, payouts cannot run from a child account, and projects stay on the parent.
3. Is the parent liable for a child's chargebacks and negative balance?
4. Where are a child's payment and account webhooks delivered, and with which secret?
5. Will PayMongo enable linked accounts on live, at what price per account?
6. One approved ₱1 live transfer from a child account succeeds.

**Before live payouts at all (lawyer):** whether payees must be verified, and by whom. Task 24 builds the record and an off-by-default enforcement switch; the lawyer decides whether to turn it on. Also the Data Privacy Act review of the details forwarded to PayMongo.

## Review Focus

1. **A duplicate child account after a timeout.** An `unknown` create is retried with the same idempotency key after searching the account list by our reference. Pinned in Task 19 (`retries an unknown create with the same key`) and Task 20 (`an unknown create never creates a second account`).
2. **A switch strands or reroutes money.** With a switch off, new payments go to the parent, while released allocations held under a child still pay from that child. Pinned in Task 18 (`resolve returns parent while off, get still returns the child`) and Task 23 (`child pools still pay with the switch off`).
3. **Webhooks replayed or out of order.** A duplicate changes nothing. `failed` after `passed` is ignored. `activated` before `passed` still activates. Pinned in Task 16 (`applyEvent` cases) and Task 21 (`a replayed event is applied once`).
4. **A refund or read against the wrong account.** A payment created under a child is read and refunded through that child, even after the project moves back. Pinned in Task 22 (`refund uses the account the payment landed in`).
5. **A declined account keeps receiving money.** A merchant declined after activation receives no new payments. Pinned in Task 20 (`declined after active disables the account`) and Task 18 (`a disabled child resolves to parent`).

---

## Phase A

### Task 15: Capture PayMongo's merchant account contract (test mode)

**Files:**
- Create: `tests/fixtures/paymongo/linked-accounts/*.json` (redacted responses)
- Modify: this plan's Probe result section

- [x] **Step 1: Obtain approval** for the test-mode writes. The responses represented PayMongo’s static sandbox merchant.
- [ ] **Step 2: Run, with the test key from Secret Manager `apicenter-payments-test-secret-key`:**
  - `POST /v2/accounts` for a merchant with an `Idempotency-Key`, then the same call with the same key, to learn whether PayMongo replays it.
  - `PATCH /v2/accounts/{id}` with an empty body (the 422 lists required fields), then a valid PATCH.
  - `POST /v2/accounts/{id}/identity_verification`, to get `hosted_url` and its expiry.
  - `GET /v2/accounts/{id}` and `GET /v1/accounts`.
  - The activation and payment-method request routes from the PayMongo docs, once each.
- [ ] **Step 3: Complete the hosted ID check in test mode** if PayMongo offers test IDs. Record the payloads of `account.identity_verification.passed|failed` and `merchant.activated|declined`, and which endpoint and secret received them.
- [ ] **Step 4: Save each response** as a fixture with names, emails, TINs and URLs replaced by fixed fakes. Record the routes, required fields and idempotency behavior in the Probe result section.
- [ ] **Step 5: Commit:** `git commit -m "docs(linked-accounts): record PayMongo merchant account contract from test mode"`

Tasks 16, 17, 18, 20, 21 (with the fake's payloads), 22, 23 and 24 do not wait for this task. Task 19's PayMongo adapter and Task 21's payload parser do.

### Task 16: Account lifecycle (pure)

**Files:**
- Create: `apps/payments/src/features/linked-accounts/linked-account-lifecycle.ts`
- Test: `tests/unit/src/payments/linked-accounts/linked-account-lifecycle.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LinkedAccountStatus = 'draft' | 'created' | 'details_submitted' | 'verification_pending'
    | 'verification_failed' | 'manual_review' | 'activation_pending' | 'active' | 'declined';
  export type LifecycleEvent =
    | { type: 'created'; providerAccountId: `org_${string}` } | { type: 'details_submitted' }
    | { type: 'verification_link_issued'; expiresAt: Date } | { type: 'verification_passed' }
    | { type: 'verification_failed'; reason: string } | { type: 'activation_requested' }
    | { type: 'activated'; wallet: { number: string; name: string } | null }
    | { type: 'declined'; reason: string } | { type: 'payment_methods_requested' };
  export type LinkedAccountState = { status: LinkedAccountStatus; providerAccountId: `org_${string}` | null;
    attempts: number; verificationExpiresAt: Date | null; walletOnly: boolean; declineReason: string | null;
    paymentMethodsRequested: boolean };
  export type NextAction = 'create' | 'submit_details' | 'issue_verification_link' | 'await_verification'
    | 'reissue_verification_link' | 'activate' | 'await_activation' | 'request_payment_methods'
    | 'await_manual_review' | 'none';
  export const MAX_VERIFICATION_ATTEMPTS = 3;
  export function initialState(): LinkedAccountState;
  export function applyEvent(state: LinkedAccountState, event: LifecycleEvent): LinkedAccountState; // never throws
  export function nextAction(state: LinkedAccountState, now: Date): NextAction;
  ```

- [ ] **Step 1: Write the failing tests:**
  - The happy path `draft → created → details_submitted → verification_pending → activation_pending → active` gives next actions `create, submit_details, issue_verification_link, await_verification, activate, await_activation, request_payment_methods`, then `none` once payment methods are requested.
  - `verification_failed` increments `attempts`, and the next action is `reissue_verification_link`. The third failure gives `manual_review`, `walletOnly: true` and `await_manual_review`.
  - In `verification_pending` at `now >= verificationExpiresAt`, the next action is `reissue_verification_link`.
  - Applying the same event twice gives the same state as once.
  - `verification_failed` after `verification_passed` is ignored. `activated` in `verification_pending` moves to `active`.
  - `declined` from any state, including `active`, gives `declined` with the reason and next action `none`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/linked-accounts/linked-account-lifecycle.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** An event not valid in the current state returns the state unchanged.
- [ ] **Step 4: Run** the spec. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): add account lifecycle"`

### Task 17: Schema migration

**Files:**
- Create: `supabase/migrations/20261124001300_linked_accounts.sql`
- Test: `tests/integration/linked-accounts-schema.integration.spec.ts`

**Tables and columns:**
- `shared_payment.linked_accounts`:
  - `id text PRIMARY KEY CHECK (id ~ '^lac_[A-Za-z0-9]+$')`, `environment`, `organization_id`, `project_id`
  - `provider_account_id text NULL CHECK (provider_account_id ~ '^org_[A-Za-z0-9]+$')`, unique per `environment`
  - `status` (the Task 16 values), `verification_attempts int NOT NULL DEFAULT 0`, `verification_expires_at timestamptz`, `wallet_only boolean NOT NULL DEFAULT false`, `decline_reason text`, `payment_methods_requested boolean NOT NULL DEFAULT false`, `closed_at timestamptz`, `created_at`, `updated_at`
  - A unique partial index on `(environment, project_id)` where `status <> 'declined' AND closed_at IS NULL`.
- `shared_payment.linked_account_events (environment, provider_event_id, linked_account_id, type, received_at)`, primary key `(environment, provider_event_id)`.
- `shared_payment.project_linked_account_settings (environment, project_id, enabled boolean NOT NULL DEFAULT false, updated_by text NOT NULL, updated_at)`, primary key `(environment, project_id)`.
- `shared_payment.merchant_accounts`: add `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled'))` and `linked_account_id text NULL REFERENCES shared_payment.linked_accounts(id)`.
- `shared_payment.resource_owners`: add `merchant_account_id text NOT NULL DEFAULT 'parent'`.

- [ ] **Step 1: Write the failing test:** a second open onboarding for one project is rejected; a declined or closed one does not block a new one; existing `resource_owners` rows read `merchant_account_id = 'parent'`; a project with no settings row reads as disabled.
- [ ] **Step 2: Run** `npm run test:integration -- linked-accounts-schema`. Expected: FAIL.
- [ ] **Step 3: Write the migration** following `20261121001200_payouts.sql` (RLS, grants, the `payments_runtime` policy, and `COMMENT ON TABLE` stating "no ID images, no secrets, no forwarded personal details").
- [ ] **Step 4: Run** the integration test again. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): add linked account tables"`

### Task 18: Switches and the resolver

**Files:**
- Create: `apps/payments/src/features/linked-accounts/linked-accounts-switch.ts`
- Modify: `apps/payments/src/features/payouts/merchant-accounts.ts`
- Test: `tests/unit/src/payments/payouts/merchant-accounts.spec.ts` and `tests/unit/src/payments/linked-accounts/linked-accounts-switch.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface LinkedAccountsSwitch {
    enabledFor(environment: Environment, projectId: string): Promise<boolean>; // env switch AND project row
    assertEnabledFor(environment: Environment, projectId: string): Promise<void>; // 503 LINKED_ACCOUNTS_DISABLED
    setProject(environment: Environment, projectId: string, enabled: boolean, actor: string): Promise<void>;
  }
  export function createLinkedAccountsSwitch(pool?: Pool): LinkedAccountsSwitch;
  ```
- `MerchantAccountResolver` takes the switch, and gains `listWithReleasedPools(environment): Promise<MerchantAccount[]>` (parent first).
- `resolve` returns `parent` when the switch is off for the project, or when the mapped account's `status` is `disabled`.

- [ ] **Step 1: Write the failing tests:** `resolve returns parent while off, get still returns the child`; env on but project off resolves to `parent`; both on resolves to the mapped child; `a disabled child resolves to parent`; `listWithReleasedPools` lists a child holding released allocations with the switch off; `assertEnabledFor` throws 503 `LINKED_ACCOUNTS_DISABLED`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/payouts/merchant-accounts.spec.ts tests/unit/src/payments/linked-accounts/linked-accounts-switch.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the specs and `npx jest tests/unit/src/payments`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): gate the resolver behind environment and project switches"`

### Task 19: Provider port, fake and PayMongo adapter

**Files:**
- Create: `apps/payments/src/features/linked-accounts/linked-accounts-provider.ts`, `fake-linked-accounts-provider.ts` and `paymongo-linked-accounts-provider.ts`
- Test: `tests/unit/src/payments/linked-accounts/paymongo-linked-accounts-provider.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ProviderResult<T> = { kind: 'ok'; value: T } | { kind: 'rejected'; code: string; message: string }
    | { kind: 'unknown'; reason: string };
  export type MerchantDetails = { businessName: string; tin: string; expectedMonthlyVolume: Centavos;
    representative: { email: string; firstName: string; lastName: string } };
  export type ProviderAccountSnapshot = { providerAccountId: `org_${string}`; status: LinkedAccountStatus;
    wallet: { number: string; name: string } | null };
  export interface LinkedAccountsProvider {
    create(reference: string): Promise<ProviderResult<{ providerAccountId: `org_${string}` }>>;
    findByReference(reference: string): Promise<ProviderResult<{ providerAccountId: `org_${string}` } | null>>;
    submitDetails(id: `org_${string}`, details: MerchantDetails): Promise<ProviderResult<void>>;
    issueVerificationLink(id: `org_${string}`): Promise<ProviderResult<{ url: string; expiresAt: Date }>>;
    activate(id: `org_${string}`): Promise<ProviderResult<void>>;
    requestPaymentMethods(id: `org_${string}`, methods: Array<'gcash' | 'card' | 'payouts'>): Promise<ProviderResult<void>>;
    get(id: `org_${string}`): Promise<ProviderResult<ProviderAccountSnapshot>>;
  }
  export function createLinkedAccountsProvider(): LinkedAccountsProvider; // fake when isMockMode(), else PayMongo
  ```
- `MerchantDetails` field names are final only after Task 15; rename to match PayMongo's required fields then.
- The fake keeps a `Map` and exposes `pass(id)`, `fail(id, reason)`, `activateNow(id)`, `decline(id, reason)` and `failNext(kind)`. The first four return the webhook payload the fixtures show, for Task 21's tests.
- The `reference` is the APICenter `lac_` id, sent as the idempotency key (`<lac_id>:create`) and as metadata, so `findByReference` can search `GET /v1/accounts`.

- [ ] **Step 1: Write the failing tests** against Task 15's fixtures, mocking `global.fetch`:
  - Each method calls the route and body Task 15 confirmed, with `Idempotency-Key` on every write.
  - Outcomes map as in the money mover: 2xx → `ok`, 4xx → `rejected` with PayMongo's code (429 → `rate_limited`), 5xx or `PROVIDER_UNREACHABLE` → `unknown`.
  - `retries an unknown create with the same key`.
  - `findByReference` matches our reference in `GET /v1/accounts` and follows `has_more`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/linked-accounts/paymongo-linked-accounts-provider.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both adapters.** Send only fields Task 15 confirmed.
- [ ] **Step 4: Run** the spec. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): add PayMongo linked accounts provider"`

### Task 20: Onboarding service and store

**Files:**
- Create: `apps/payments/src/features/linked-accounts/linked-account-store.ts` and `linked-account-onboarding.ts`
- Test: `tests/unit/src/payments/linked-accounts/linked-account-onboarding.spec.ts`

**Interfaces:**
- Consumes: Tasks 16 to 19.
- Produces:
  ```ts
  export type OnboardingView = { id: string; status: LinkedAccountStatus; nextAction: NextAction; attempts: number;
    walletOnly: boolean; declineReason: string | null;
    verification: { url: string; expiresAt: string } | null }; // url only in the response that issued it
  export interface LinkedAccountOnboarding {
    start(context: PaymentContext, details: MerchantDetails): Promise<OnboardingView>;
    reissueVerificationLink(context: PaymentContext, id: string): Promise<OnboardingView>;
    current(context: PaymentContext): Promise<OnboardingView | null>;
    advance(environment: Environment, id: string): Promise<OnboardingView>;
    applyProviderEvent(environment: Environment, event: AccountEvent): Promise<'applied' | 'duplicate' | 'unknown_account'>;
    moveProject(context: PaymentContext, id: string): Promise<void>;
    close(context: PaymentContext, id: string): Promise<void>;
  }
  ```
- `start`, `reissueVerificationLink` and `moveProject` begin with `switch.assertEnabledFor`. `current`, `close`, `advance` and `applyProviderEvent` are not gated.
- `advance` runs `nextAction` until an `await_*` or `none` action, or a provider result that is `rejected` or `unknown`. Each step stores its event before the next call. A `rate_limited` rejection surfaces as `429 PROVIDER_RATE_LIMITED` with `Retry-After`.
- Activation upserts a `merchant_accounts` row (`kind 'child'`, id = provider id, wallet from `get`, `linked_account_id`). A decline after activation sets that row's `status` to `disabled`.
- `moveProject` needs an `active` account of the caller's project, and inserts the mapping row. `close` needs no released allocations left under the account; it moves the project back to `parent` if mapped, sets `closed_at`, and disables the `merchant_accounts` row.

- [ ] **Step 1: Write the failing tests**, with the fake provider and the memory store:
  - `start` runs create, details and link in one call, and returns the URL and `nextAction: 'await_verification'`. `current` afterwards returns `verification: null`.
  - `an unknown create never creates a second account`: `failNext('unknown')` on create, then `advance` finds the account by reference and continues.
  - A second `start` for the same project returns the existing onboarding.
  - Reissuing in `manual_review` gives 409 `VERIFICATION_ATTEMPTS_EXHAUSTED`.
  - `start` with either switch off gives 503 `LINKED_ACCOUNTS_DISABLED` without a provider call.
  - `declined after active disables the account`.
  - `moveProject` on a non-active account gives 409 `INVALID_LINKED_ACCOUNT_STATE`; on another project's account gives 404.
  - `close` with released allocations left gives 409 `ACCOUNT_HAS_BALANCE`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/linked-accounts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The Postgres store follows `payout-store.ts`; state changes use `UPDATE … WHERE id = $1 AND updated_at = $2` and retry once on a lost race.
- [ ] **Step 4: Run** the specs. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): add project account onboarding"`

### Task 21: Account webhooks

**Files:**
- Create: `apps/payments/src/features/linked-accounts/account-events.ts`
- Modify: `apps/payments/src/features/webhooks/webhooks.service.ts`
- Test: `tests/unit/src/payments/linked-accounts/account-events.spec.ts` and an extension of `tests/unit/src/payments/payment-webhook-ownership.spec.ts`

**Interfaces:**
- Produces: `export type AccountEvent = { providerEventId: string; providerAccountId: \`org_${string}\`; event: LifecycleEvent }` and `export function parseAccountEvent(payload: unknown): AccountEvent | null`.
- `processWebhook` hands `account.identity_verification.passed|failed` and `merchant.activated|declined` to `onboarding.applyProviderEvent` after the signature and livemode checks, before payment handling. Other types are unchanged.

- [ ] **Step 1: Write the failing tests** with Task 15's fixtures (the fake's payloads until then): each type parses to its `LifecycleEvent`; an unknown type parses to `null`; `a replayed event is applied once`; an event for an unknown account returns 200 and changes nothing; a bad signature still returns 401.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/linked-accounts/account-events.spec.ts tests/unit/src/payments/payment-webhook-ownership.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** If Task 15 or PayMongo shows child events arrive with a different secret, add `PAYMONGO_<ENV>_ACCOUNT_WEBHOOK_SECRET` and try it after the existing one.
- [ ] **Step 4: Run** the specs. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): apply PayMongo account webhooks"`

### Task 22: Collect into the resolved account

**Files:**
- Modify: `apps/payments/src/features/payment-intents/payment-intents.service.ts`, `checkout/checkout.service.ts`, `payment-links/payment-links.service.ts`, `refunds/refunds.service.ts`, `payouts/allocations.ts` and `shared/payment-owner-store.ts`
- Test: `tests/unit/src/payments/linked-accounts/collection-routing.spec.ts`

**Interfaces:**
- `OwnerRecord` gains `merchantAccountId: string`.
- On create, each service calls `accounts.resolve(projectId, environment, now)`, passes `account` to `paymongoRequest`, and saves `merchantAccountId`. Every later call for that resource (read, expire, refund) uses `accounts.get(record.merchantAccountId)`.
- `allocations.ts` takes the account from the payment's owner record instead of resolving again.
- Projects report volume per account: the admin overview (Task 23) shows each account's collected total for the last 30 days.

- [ ] **Step 1: Write the failing tests:**
  - With no mapping rows, every PayMongo call is identical to today's: no `Account-ID`, and records say `parent`.
  - With a child mapping and both switches on, a checkout is created with `Account-ID: org_x`.
  - `refund uses the account the payment landed in`, even after a later mapping row moves the project back.
  - An allocation on a child-account payment records the child's `merchant_account_id`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/linked-accounts/collection-routing.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx jest tests/unit/src/payments` and `npm run test:integration -- checkout-reconciliation`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): collect payments into the resolved merchant account"`

### Task 23: Pay out from every account

**Files:**
- Modify: `apps/payments/src/features/payouts/payout-executor.ts` and `payouts.routes.ts` (overview)
- Test: `tests/unit/src/payments/payouts/payout-executor.spec.ts` and `tests/unit/src/payments/payouts/payouts-routes.spec.ts`

**Interfaces:**
- A scheduled run iterates `accounts.listWithReleasedPools(environment)`, each with its own float budget. `RunReport.floatLow` becomes `string[]`, the ids of the low accounts.
- A cash-out pays the payee's pool in each account that holds part of it, as one payout per account.
- The admin overview lists one wallet entry per account, with its 30-day collected volume.

- [ ] **Step 1: Write the failing tests:**
  - `the same payout from parent and child is the same record`: identical ledger rows and `payout.*` events except `merchant_account_id`, the source wallet and the `Account-ID` header.
  - `child pools still pay with the switch off`.
  - A low float in a child does not stop the parent's payouts.
  - A cash-out across two accounts creates two payouts, each within its own account's float.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/payouts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the specs. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): pay out from every merchant account"`

### Task 24: Payee verification record

The project verifies its payees; APICenter records what the project says and can require it. This applies to every payout, with or without child accounts, and can ship before the rest of Phase A.

**Files:**
- Create: `supabase/migrations/20261124001400_payee_verification.sql`
- Modify: `apps/payments/src/features/payouts/payouts.routes.ts`, `payout-store.ts`, `payout-executor.ts`, the gateway payouts public operations, `contracts/` OpenAPI, the SDK payouts client, the payouts guide, and the console payee sheet
- Test: `tests/unit/src/payments/payouts/payee-verification.spec.ts`, and the existing gateway, contract and SDK payout specs, extended

**Interfaces:**
- `shared_payment.payees` gains `verified_by text`, `verified_at timestamptz`, `verification_method text CHECK (verification_method IN ('government_id','in_person','third_party','other'))` and `verification_reference text CHECK (length(verification_reference) <= 120)`, all nullable, set together or not at all.
- `Payee` gains `verification: { verifiedBy: string; verifiedAt: string; method: 'government_id' | 'in_person' | 'third_party' | 'other'; reference: string | null } | null`. `reference` is the project's own record id, never an ID number; the guide says so.
- Public operation `PUT /api/v1/payouts/payees/{payeeId}/verification` (idempotent, `payments:payouts:write`). SDK `api.payments.payees.recordVerification(payeeId, verification)`.
- `PAYOUTS_REQUIRE_PAYEE_VERIFICATION` is off unless `'true'`. When on, a scheduled run skips unverified payees with skip reason `payee_unverified`, and a cash-out returns 409 `PAYEE_NOT_VERIFIED`.

- [ ] **Step 1: Write the failing tests:** recording and reading a verification round-trips; a body with `method` but no `verifiedAt` is rejected 400; another project's payee gives 404; with the switch on, an unverified payee is skipped with `payee_unverified` and its cash-out gives 409 `PAYEE_NOT_VERIFIED`; with it off, nothing changes; the contract has no `paymongo_`.
- [ ] **Step 2: Run** `npx jest tests/unit/src/payments/payouts/payee-verification.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and bump the SDK to 3.4.0 and contracts to 1.3.0.
- [ ] **Step 4: Update docs:** the payouts guide gets "Recording how you verified a payee", stating that verifying is the project's job and that live payouts may require it; `CHANGELOG.md`. Run `npm run typecheck && npm run lint && npm test && npm run check:documentation`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(payouts): record how a project verified each payee"`

### Task 25: Console project account panel

**Files:**
- Modify: `apps/payments/src/features/payouts/payouts.routes.ts` (admin routes), `apps/gateway/src/domains/control-plane/payouts-console.controller.ts`, and the console payouts feature (`model`, `data`, `view-models`, `views/payouts/payouts-page.tsx`)
- Create: `apps/management/src/features/control-plane/views/payouts/linked-account-panel.tsx`
- Test: `tests/unit/src/control-plane/payouts-console.controller.spec.ts` and `apps/management/tests/unit/src/features/control-plane/linked-account-panel.test.tsx`

**Console API** (under the existing `…/environments/:environment/payouts` controller):

| Method | Route | Access | Audit action |
|---|---|---|---|
| `GET` | `linked-account` | `environment.read` | none |
| `PUT` | `linked-account/enabled` | platform admin | `linked_account.project_enabled` / `.project_disabled` |
| `POST` | `linked-account` (`MerchantDetails`) | `environment.write` | `linked_account.onboarding_started` |
| `POST` | `linked-account/verification-link` | `environment.write` | `linked_account.link_reissued` |
| `POST` | `linked-account/move` | `environment.write` | `linked_account.project_moved` |
| `POST` | `linked-account/close` | platform admin | `linked_account.closed` |

- `GET` returns `{ environmentEnabled, projectEnabled, onboarding: OnboardingView | null }`.
- Audit entries go through `AuditEventsService`, as `control-plane-admin.service.ts` does, with resource type `linked_account`. Details never include the business details or the URL.

**Panel**, inside the Payouts page:
- Environment switch off: "Linked accounts are switched off in this environment", not an empty state. Project switch off: the same, with the platform admin's toggle when the actor may use it.
- No account: a form for the details Task 15 confirmed.
- After a link is issued: the URL shown once, with copy and expiry, and the text "This link is shown once. Reissue it if it is lost."
- Status and next action; `manual_review` explains PayMongo's 7 to 14 day review; `declined` shows the reason.
- Active: "Move project to this account", a `ConfirmDialog` stating that new payments go to the project's account and money already collected keeps paying from the main account. Live is marked in red.

- [ ] **Step 1: Write the failing tests:** the gateway refuses a project the actor cannot read; writes need `environment.write`; `enabled` and `close` need a platform admin; each write records its audit action; the panel renders both off states, the one-time URL, the `declined` reason and the move confirmation; an API failure renders `ErrorPanel` with its code.
- [ ] **Step 2: Run** `npx jest tests/unit/src/control-plane/payouts-console.controller.spec.ts` and `npm run test --workspace @apicenter/management -- linked-account`. Expected: FAIL.
- [ ] **Step 3: Implement**, following `apps/management/DESIGN.md`.
- [ ] **Step 4: Update docs:**
  - The payouts runbook gets three sections:
    - "Onboarding a project's account".
    - "Moving and offboarding a project": move back to the parent, let held earnings pay out, send the leftover from the PayMongo dashboard to the project's bank, close in the console, then ask PayMongo to close the account.
    - "Rotating the PayMongo secret key": the key acts for every child; only the payments runtime's service account may read `apicenter-payments-*-secret-key`.
  - ADR-0009 "Project child accounts through the hosted ID check", including the Responsibilities split.
  - `docs/log.md`, `docs/superpowers/plans/README.md` and the payouts spec's status.

  Run `npm run typecheck && npm run lint && npm test && npm run check:documentation && npm run test:documentation`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(linked-accounts): add console project account panel"`

## After Phase A

Deployment needs the user's approval. In order:
1. Apply migrations `20261124001300` and `20261124001400` (after `20261121001200`).
2. Deploy with `LINKED_ACCOUNTS_ENABLED` and `PAYOUTS_REQUIRE_PAYEE_VERIFICATION` unset. Nothing changes.
3. In the test runtime only: turn on `LINKED_ACCOUNTS_ENABLED`, enable one project, and onboard it end to end.
4. Live, only after the PayMongo blockers clear: enable Serbizio alone, make the approved ₱1 transfer from its child account, then move it.
5. Turn on `PAYOUTS_REQUIRE_PAYEE_VERIFICATION` in live only if the lawyer requires it.

## Phase B (held): payee consumer accounts

Not planned in detail. A payee consumer account would be an optional destination type a project chooses: APICenter creates a sibling consumer account under the parent, the payee passes the hosted ID check, and payouts go by `paymongo`-rail transfer to its wallet.

Start Phase B only when PayMongo has answered:
- Can a consumer withdraw from their wallet themselves, or must APICenter build the withdrawal?
- What does each hop cost (parent or child wallet to consumer wallet, then wallet to bank or GCash)?
- What are the wallet's balance and monthly limits, including for wallet-only accounts?
- Can one person's ID verify more than one consumer account?

What Phase B would add: the consumer kind in the lifecycle and schema (one open account per payee), `consumer.activated|declined` webhooks, a `provider_wallet` destination set on activation (with the 24-hour hold), the public `/payees/{payeeId}/onboarding` operations with a `payee.onboarding.updated` event, and SDK methods. Age and eligibility stay the project's rules; APICenter passes PayMongo's reason through.
