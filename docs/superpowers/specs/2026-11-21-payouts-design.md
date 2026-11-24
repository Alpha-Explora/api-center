---
title: APICenter payouts and pooled payee earnings
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: [docs/adr/0008-project-payouts-through-resolved-merchant-accounts.md, apps/payments/src/shared/paymongo-client.ts, apps/payments/src/shared/payment-context.ts, docs/payments-platform-current.md]
---
# APICenter payouts and pooled payee earnings

Design status: approved by the user on 2026-11-21 and built on branch `feat/payouts` (runtime, events, public API, SDK, console). Not deployed; deployment and live money movement follow [the payouts runbook](../../operations/payouts-runbook.md). [ADR-0008](../../adr/0008-project-payouts-through-resolved-merchant-accounts.md) records the decision.

The linked-account follow-up adds sandbox onboarding, account-specific collections and payouts, and the payee verification record. Live onboarding and rollout conditions are tracked in [the linked accounts implementation plan](../plans/2026-11-24-linked-accounts.md).

## Intent

A project that runs a marketplace pays the people who deliver its service (payees) once its own completion signal fires, for example a finished job. APICenter provides this as a reusable capability:

- the project registers payees
- the project attaches each payee's share to a payment
- APICenter holds that share until the project releases it
- APICenter pays released earnings out in pooled transfers, so one transfer fee covers many jobs

Phase 1 uses the existing PayMongo account, its wallet and the transfer API. When PayMongo enables linked accounts, moving to child accounts must not change the public contract or the ledger.

Success means:

- a payee receives the right amount once, within the project's payout policy
- a failed transfer returns the money to the payee's pool
- a refund after payout is recovered from later earnings
- every peso reconciles to a PayMongo record

## Verified facts (2026-11-21)

**Dashboard**, account `org_L11kFMzx3XMU12VK2eCF7HB6`, a sole proprietor:

- Linked accounts are not enabled. There is no Linked Accounts page, and those routes return 404.
- The wallet is active, and the dashboard offers Send funds, Send to many and saved recipients.
- An earlier ₱480 send completed in two seconds.
- In 2025, settlements arrived in the wallet as "PayMongo Disbursements". A current payment says it settles to the bank account.

**API**, test key, read-only:

- `GET /v2/wallets/` returns 200 with an empty list. Test mode has no wallet, so transfers cannot be exercised end to end in test mode.
- `GET /v1/wallets/receiving_institutions?provider=instapay` returns 94 institutions. GCash is G-Xchange, Inc., BIC `GXCHPHM2XXX`.
- The guide's path `/v2/transfers/receiving_institutions` returns 404.

**PayMongo documentation**:

- Every transfer goes through `POST /v2/batch_transfers`. A single transfer is a batch of one.
- Each transfer has a source and a destination account (`number`, `name`, `bic`), an amount in centavos, `PHP`, and a `provider` of `instapay`, `pesonet` or `paymongo`.
- Each transfer also takes an optional `reference_number`, `callback_url` and `metadata`.
- Statuses are `pending`, `succeeded` and `failed`. An InstaPay transfer may stay pending for up to 20 minutes, and a pending transfer must not be retried.
- There is no idempotency key.
- InstaPay transfers are capped at ₱50,000.
- The transfer fee is stated as ₱10. One example shows ₱8, and one transfer per week is free.

## Phase 1 scope

In scope:

- payees and their destinations
- allocations held against payments
- release and cancel
- pooled payouts under a per-project policy
- the PayMongo transfer adapter and transfer reconciliation
- float checks
- payout events
- refund clawback
- the merchant-account resolver and per-account webhook secrets, with one parent account

Out of scope until PayMongo enables linked accounts: child accounts, split payments, payee consumer accounts and per-child webhooks.

Live money movement waits for the legal review and the PayMongo answers below.

## Model

All amounts are integer centavos in PHP ([ADR-0004](../../adr/0004-v1-php-only.md)). Every record carries `project_id`, `environment` and `merchant_account_id`.

- **Merchant account.** Either `parent` or `child(org_…)`. Each has a wallet, which is its float, and a set of webhook secrets. `project_merchant_accounts(project_id, environment, merchant_account_id, effective_from)` maps projects to accounts, and the resolver reads the row in effect when the money arrives.
- **Payee.** A project-scoped recipient with an external reference from the project, a verified legal name, a status (`pending_verification`, `active` or `suspended`) and one active destination.
- **Destination.** A closed union:
  - `instapay {bic, account_number, account_name}`, for GCash or a bank
  - `provider_wallet {account_number, account_name}`
  - later, `linked_consumer {org_id}`

  A destination change requires the project to confirm it with an OTP. Payouts to a new destination are held for 24 hours.
- **Allocation.** A payee's share of one payment:

  ```
  awaiting_payment → held → released → pooled → paid
                       ↘ cancelled          ↘ (transfer failed) → released
  ```

  - An allocation becomes `held` when the payment is confirmed. It is never `held` before that.
  - A refund before release cancels it.
  - A refund after payout creates a negative adjustment against the payee.
- **Adjustment.** A signed ledger entry against a payee: clawback, manual credit or fee. Adjustments net into the next payout.
- **Payout.** One pooled transfer to one payee from one merchant account. It covers a set of released allocations and adjustments. `net = Σ allocations + Σ adjustments − fee` when the payee bears the fee.

  ```
  draft → submitting → pending → paid
                     ↘ unknown → (reconciled) pending | paid | failed
                     ↘ failed
  ```

- **Transfer attempt.** One provider transfer for a payout, with our `reference_number`, PayMongo's `tr_…` ID, the provider status, the fee and the raw failure code. A payout has at most one attempt that is not failed.

## Pooling and payout policy

Pooling happens per payee and per merchant account. One transfer pays everything released and not yet paid, so the fee is paid once per payout rather than once per job.

Each project configures a policy:

| Policy | Trigger | Use |
|---|---|---|
| `immediate` | Each release | Large jobs, where the fee is small relative to the amount |
| `scheduled` | A weekly slot in Asia/Manila, default Friday 20:00 | Default: one fee per payee per week |
| `threshold` | The pool reaches an amount | Fewer transfers for low earners |
| `on_demand` | The project calls cash-out for a payee | "Cash out now" between weekly payouts, with a minimum and a daily cap |

Policies combine. The default is a weekly scheduled payout (Friday 20:00 Asia/Manila) plus on-demand cash-out with a ₱100 minimum and a ₱10,000 daily cap. Because PayMongo charges ₱10 per transfer with one free transfer per week per sending account, the platform bears the fee on scheduled payouts and the payee bears it on cash-outs by default.

The project also sets:

- the fee bearer, separately for scheduled payouts and cash-outs: `platform` or `payee`
- `minimum_payout`: at least the fee when the payee bears it

**Regulatory constraint.** Released money waiting in a pool is money held for a payee. Keep the pooling window bounded (at most a week, with cash-out available in between), and do not expose a stored-value balance product until legal review confirms it.

## Modules

The payouts feature lives in the payments runtime, next to the existing PayMongo adapter. Its parts are kept separate so the provider and the account model can change behind them.

| Module | Responsibility | Changes for child accounts |
|---|---|---|
| `payout-ledger` (pure) | Allocation, adjustment and payout state transitions and amount maths. It has no I/O. | No |
| `payout-policy` (pure) | Decides which payees are due and how much, given the pools and the policy. | No |
| `merchant-account-resolver` | Maps `(project, environment, at)` to a merchant account. | Data only |
| `money-mover` port | `submit(payout)`, `lookup(attempt)` and `balance(account)`. Adapters are `paymongo-batch-transfer` and `mock`; later a linked-account wallet adapter. | New adapter |
| `transfer-reconciler` | Confirms pending and unknown attempts by reading PayMongo. | No |
| `float-guard` | Checks the wallet balance before submitting, queues payouts when the balance is low, and alerts. | Per account |
| `provider-webhook-secrets` | Resolves the signing secret by merchant account or endpoint. | Data only |

`paymongoRequest` gains an optional merchant account, and sends `Account-ID` only for a child.

## Sending each payout exactly once

PayMongo has no idempotency key, so APICenter enforces exactly-once:

1. Each payout is created inside one database transaction that locks its allocations: they move from `released` to `pooled`, and the payout is created in `draft`.
2. Before any provider call, the payout moves to `submitting`. Its transfer attempt is stored with a deterministic `reference_number` derived from the payout ID.
3. The PayMongo call is made.
   - A response carrying `tr_…` moves the payout to `pending`.
   - A 4xx validation error moves it to `failed`.
   - A timeout, 5xx or lost response moves it to `unknown`.
4. An `unknown` payout is never resubmitted. The reconciler searches PayMongo for the attempt's `reference_number` (open question: by what endpoint) and resolves it to `pending`, `paid` or `failed`. If it cannot be resolved, the payout goes to an operator.
5. When a transfer fails, its allocations return to `released`. The next payout uses a new payout ID and therefore a new reference.
6. The `callback_url` carries an unguessable per-attempt token. Its body is treated only as a hint: APICenter always confirms the status with `GET /v2/transfers/{id}`. A polling job covers missed callbacks.

## Public contract sketch

The gateway's provider-neutral routes under `/api/v1/payouts/*`, plus a payment extension. Every mutation requires `Idempotency-Key`, as for payments today.

- `POST /payees`, `GET /payees/{id}`, `POST /payees/{id}/destination` (confirmed by OTP)
- `allocations: [{ payeeId, amount }]` on payment, checkout and link creation. The sum must not exceed the net amount.
- `POST /allocations/{id}/release`, `POST /allocations/{id}/cancel`
- `POST /payees/{id}/cash-out` (only when the policy allows on-demand)
- `GET /payees/{id}/earnings`, `GET /payouts`, `GET /payouts/{id}`
- Events: `allocation.held`, `allocation.released`, `payout.submitted`, `payout.paid`, `payout.failed`, `payee.adjusted`

## Moving a project to a child account

1. PayMongo enables linked accounts. We create the project's child account, verify its identity, activate it, and request GCash, cards and payouts.
2. Register the child's webhook and add its secret row.
3. Insert the project's mapping with `effective_from = now`. New payments then land in the child account.
4. Allocations collected under the parent account keep paying from the parent float until it is drained.
5. Move the project's remaining float to the child wallet with a `paymongo`-rail transfer.

Each project moves on its own. Rollback is a new mapping row back to the parent account.

All children are direct children of the Alphaexplora parent account. That includes project merchant accounts and, later, payee consumer accounts. PayMongo relationships link exactly two accounts and are not transitive, so a parent cannot operate on a grandchild, and APICenter does not receive keys for the children it creates. The project-to-payee hierarchy therefore lives in APICenter's payee records, not in PayMongo. A payee is then paid by a `paymongo`-rail transfer from the project's child wallet to the payee's sibling wallet.

## Open questions

**For PayMongo**:

- Will they enable Transfers API access on the live wallet?
- Can settlements go to the wallet instead of the bank, and how quickly?
- How can a transfer be looked up by `reference_number`?
- What are the callback signature and event names?
- What is the exact fee per rail?
- Is there a test-mode wallet?
- Will they enable linked accounts, and at what per-account price?
- Do we need to update our business profile? It declares software services and under ₱100,000 a month.

**For legal or accounting**:

- BSP treatment of collecting for payees and pooling earnings
- AMLA know-your-payee duties while payees have no PayMongo accounts
- BIR treatment of payee earnings and the platform fee
- Data Privacy Act handling of IDs and account numbers

**For the product**:

- Who verifies a payee's identity before their first payout: the project or APICenter

## Build slices

Each slice ends in a verifiable state.

1. The pure ledger and policy, with exhaustive state-transition tests, including double-submit and refund-after-payout cases.
2. Schema and migrations: merchant accounts, mappings, payees, destinations, allocations, adjustments, payouts, transfer attempts, webhook endpoints. The resolver returns the parent account.
3. The money-mover port with the mock and PayMongo adapters, the reconciler and the float guard. Exercised in mock mode, plus one approved ₱1 live transfer.
4. The public contract, gateway routes, OpenAPI, SDK and events.
5. A policy runner (a scheduled Cloud Run job) and on-demand cash-out.
6. Console views: payees, pools, payouts, float and failures.
