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

Payouts send payees' pooled earnings from the PayMongo wallet of the parent merchant account. The design is in [the payouts design](../superpowers/specs/2026-11-21-payouts-design.md), and the decision is in [ADR-0008](../adr/0008-project-payouts-through-resolved-merchant-accounts.md).

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
7. **Enable live money movement** only after legal sign-off: add `PAYOUTS_LIVE_ENABLED=true` to the live runtime and the live runner job. Until then, live runs fail with `PAYOUTS_LIVE_DISABLED`.

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
