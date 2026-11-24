---
title: "Payouts Runbook"
status: active
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "unverified"
verification: unverified
sources: ["apps/payments/src/features/payouts", "infra/gcp/cloud-run/payout-runner.test.yaml", "infra/gcp/cloud-run/payout-runner.live.yaml", "supabase/migrations/20261121001200_payouts.sql"]
---
# Payouts Runbook

Payouts send payees' pooled earnings from the wallet that holds each allocation. Initial rollout uses the parent account. The design is in [the payouts design](../superpowers/specs/2026-11-21-payouts-design.md), [ADR-0008](../adr/0008-project-payouts-through-resolved-merchant-accounts.md) and [ADR-0009](../adr/0009-project-child-accounts-through-hosted-id-check.md).

## Onboarding a project’s account

Apply migrations `20261124001300` through `20261124001600` after the payout migration and before updating the payments runtime. Schedule `20261124001300` during a low-traffic window because it holds an exclusive lock on `shared_payment.resource_owners` while rebuilding its provider-reference index. The migration gives up after 10 seconds if it cannot acquire the lock.

For sandbox work, enable the test project in **Payouts → Project merchant account** as a platform operator. Each project can keep its own onboarding record even when PayMongo returns a shared merchant ID. Use the local mock provider to exercise the full verification flow. The PayMongo sandbox returns a placeholder URL. Test and live each use their existing parent webhook secret. A signed test identity event may carry `livemode: true`.

An uncertain create keeps its original reference. Retry from the same onboarding record to attempt reconciliation before closing it or starting another onboarding. A successful callback can complete verification for an older recorded session. Only a failure from the current session counts toward the attempt limit. Migration `20261124001500` preserves the existing current session and records each new session from then on.

## Testing payee wallet onboarding

In **Payouts**, enable the project’s test payee wallet pilot as a platform operator. Use a database-backed runtime with mock payments to exercise signed identity and activation events and attach a test wallet. The PayMongo sandbox returns fixture account IDs and placeholder URLs. Only an unambiguous recorded session can identify a payee behind a shared sandbox ID.

Use the payee's `externalRef` and onboarding ID to correlate `payee.onboarding.updated` events with payout records. A signed decline removes the wallet attached by onboarding. An explicit destination change remains in effect. The existing payout hold and project verification setting still apply. Keep the feature disabled for live while the [provider rollout conditions](../superpowers/plans/2026-11-24-linked-accounts.md#phase-b-payee-consumer-wallets) are open.

## Moving and offboarding a project

Leave real project moves pending until the [rollout conditions](../superpowers/plans/2026-11-24-linked-accounts.md#blockers) pass. Register transaction webhooks on each child for its supported payment and refund events at `/api/v1/shared/payment/webhooks/{environment}/accounts/{accountId}`. Load the matching per-child signing secrets into the payments runtime through `PAYMONGO_CHILD_WEBHOOK_SECRETS`, a secret-backed JSON map from merchant account IDs to signing secrets. Test a signed delivery before changing routing. The gateway records child webhook receipts after the payments runtime accepts the delivery.

If an activation event omitted wallet details, the move checks PayMongo for an active PHP wallet owned by that child. An eligible wallet must be identifiable before routing changes. [PayMongo Wallet resource](https://docs.paymongo.com/reference/wallet-resource).

A move affects new payments. Existing payments, refunds, and payout allocations keep their original account. Before offboarding, move new collections back to the parent, expire open checkouts and archive the child's payment links. Drain outstanding allocations and verify the child balance in PayMongo. After APICenter closes the account, coordinate the wallet balance transfer and provider closure with PayMongo.

## Rotating the PayMongo secret key

Rotate the runtime’s parent secret with the matching environment in Secret Manager. That key acts for the parent and eligible child accounts. Restrict access to the payments runtime and payout runner service accounts that use it. Verify the new runtime key can read the parent wallet and the intended child account before revoking the old key. Child webhook signing secrets rotate separately.

## Requiring payee verification

In **Payouts → Payout settings**, select **Require a verification record before paying** for the project environment. The scheduled runner skips unverified payees and cash-out returns `409 PAYEE_NOT_VERIFIED`. Projects supply their verification records through the public payouts API.

## Before the first payout

1. **Apply migration `20261121001200`.** It creates the payout tables and seeds the `parent` merchant account for `test` and `live`.
2. **Record the wallet.** Read the wallet's account number and name with the matching environment's secret key. The call is read-only:

   ```bash
   curl -s -u "$PAYMONGO_SECRET_KEY:" "https://api.paymongo.com/v2/wallets/?fields=account"
   ```

   Then store them:

   ```sql
   UPDATE shared_payment.merchant_accounts
      SET wallet_account_number = '<account_number>', wallet_account_name = '<account_name>',
          low_float_alert_centavos = 100000, updated_at = now()
    WHERE environment = 'live' AND id = 'parent';
   ```

   Without a wallet, every payout run fails with `WALLET_NOT_CONFIGURED`.

   Test mode has no PayMongo wallet. Test runtimes run in mock mode, or with `PAYOUT_WALLET_NUMBER` and `PAYOUT_WALLET_NAME` set for the in-memory fallback.
3. **Set the callback base URL.** Set `APICENTER_PUBLIC_BASE_URL` (the gateway's public origin) on the payments runtimes and the runner jobs. PayMongo then calls `/api/v1/shared/payment/payout-callbacks/{environment}/{token}` when a transfer settles. Without it, the reconcile job still settles every transfer within five minutes.
4. **Create the runner jobs** from `infra/gcp/cloud-run/payout-runner.{test,live}.yaml`.
5. **Schedule two executions per environment** with Cloud Scheduler, time zone `Asia/Manila`:
   - `schedule`, hourly (`0 * * * *`). It pays every pool whose weekly slot has passed. Each project's policy decides the slot, and the default is Friday 20:00.
   - `reconcile`, every 5 minutes (`*/5 * * * *`). Override the container arguments to `dist/features/payouts/payout-runner.js reconcile`.
6. **Make one live ₱1 transfer, with approval.**
   1. Create a payee with a destination you control.
   2. Attach a ₱1 allocation to a ₱1 live payment, release it, and cash out.
   3. Confirm the money arrived and `payment.payout.paid` was delivered.
7. **Enable live sending for each approved project** in its **Payouts** page after legal sign-off. Cash-outs for a project without access return `PAYOUTS_LIVE_DISABLED`. Allow the configured settlement period before attempting the transfer.

## Pause payouts in an emergency

Open **Platform settings → Payout controls**, choose Test or Live, and pause **Sending payouts** with a reason. Use this during a provider incident or when new transfers need to stop for investigation. Scheduled runs skip eligible pools with reason `paused` and cash-out returns `PAYOUTS_PAUSED`. Collections, earnings, allocations and reconciliation of existing transfers continue. In-flight provider transfers can still settle.

The **Project merchant account** pause blocks onboarding actions while existing accounts keep collecting payments. The **Payee wallets** pause blocks the test onboarding pilot. Resume in the same environment with a reason to restore the existing project switches. Check the audit log and the affected project's payout status.

## The float

PayMongo settles collected payments 2–7 days after payment, but payouts can leave the wallet sooner. The wallet therefore needs a float. A rough size is a typical week of payouts plus fees.

The runner checks the balance before each payout. It skips any payee whose payout would take the balance below `low_float_alert_centavos`, and logs `apicenter_payout_float_low`. Skipped earnings stay released and are paid on a later run.

To top up, use the PayMongo dashboard: Wallets → Top up.

## Payouts that need a person

| Status | Meaning | Action |
| :--- | :--- | :--- |
| `unknown` | The submission's outcome was not received (timeout, 5xx, crash). It is never resubmitted. | None; the reconcile job looks it up by reference number. |
| `needs_review` | PayMongo has had no record of the reference for 24 hours, or has reported the transfer pending for 72 hours. | Search the PayMongo dashboard (Wallets → transactions) for the payout's reference number: the payout ID without `po_`, in upper case. Then resolve it in the console: Payouts → Needs review → Resolve. |

Only platform operators can resolve payouts or change payout settings; project members see them read-only. The reconcile job searches only PayMongo's most recent 100 batch transfers by reference, so an older transfer can reach `needs_review` although it exists: always search the dashboard before resolving.

A payout left in `draft` by a crash (created, never submitted) is failed automatically after 10 minutes with failure code `not_submitted`; nothing was sent, and its earnings return to the payee's balance.

When resolving a `needs_review` payout:
- If the transfer exists and succeeded, resolve it as **paid**.
- If no transfer exists, resolve it as **failed**. Its earnings return to the payee's balance for the next payout.

Never send the money by hand and then resolve the payout as failed. That pays the payee twice.

## Logs

| Log type | Meaning |
| :--- | :--- |
| `apicenter_payout_run` | Each runner execution, with the number of payouts made and skipped |
| `apicenter_payout_run_failed` | The runner failed; the code is included |
| `apicenter_payout_float_low` | A payee was skipped because the float was too low |
| `apicenter_payout_outcome_unknown` | A submission without a known outcome |
| `apicenter_payout_needs_review` | A payout handed to an operator |
| `apicenter_payout_reconcile_failed` | One payout could not be settled in this run; the others continue and the next run retries it |
| `apicenter_payout_callback_forward_failed` | The gateway could not forward a PayMongo callback; reconcile covers it |

## Fees

PayMongo charges ₱10 per InstaPay or PESONet transfer, with one free transfer per week per account. A payout records PayMongo's actual fee on its transfer attempt. The fee in a project's policy is the amount APICenter deducts when the payee bears the fee.
