// Pays due pools and settles transfers whose outcome is not yet known.
//
// Exactly once: a payout's allocations are pooled before any provider call, the attempt (with its
// reference number) is recorded before the call, and an outcome that does not prove the transfer was
// refused leaves the payout `unknown`. Unknown payouts are never submitted again; the reconciler looks
// them up by reference, and after a day without an answer hands them to an operator.

import { PayMongoError } from '../../shared/payment-errors';
import type { MerchantAccount, MerchantAccountResolver } from './merchant-accounts';
import type { MoneyMover } from './money-mover';
import { composePayout, type Centavos, type PayoutEvent } from './payout-ledger';
import { isDue, type PayoutPolicy, type PayoutTrigger } from './payout-policy';
import type { Environment, PayoutRecord, PayoutStore } from './payout-store';

/** How long a transfer PayMongo has no record of stays unknown before an operator must look. */
export const UNKNOWN_DEADLINE_MS = 24 * 60 * 60 * 1000;
/** How far before submission a reference lookup searches. */
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;

export type PayoutDeps = {
  store: PayoutStore;
  mover: MoneyMover;
  accounts: MerchantAccountResolver;
  now: () => Date;
  callbackUrl?: (token: string) => string;
};

export type RunReport = { paid: string[]; skipped: Array<{ payeeId: string; reason: string }>; floatLow: boolean };

export function assertLiveEnabled(environment: Environment): void {
  if (environment === 'live' && process.env.PAYOUTS_LIVE_ENABLED !== 'true') {
    throw new PayMongoError('Live payouts are disabled', 409, 'PAYOUTS_LIVE_DISABLED');
  }
}

/**
 * Pays every due pool in the environment, or one payee's pool. Runs per merchant account: today only
 * the parent account. `paid` lists the payouts submitted in this run.
 */
export async function runPayouts(deps: PayoutDeps, environment: Environment, trigger: PayoutTrigger,
  scope?: { payeeId: string; projectId: string }): Promise<RunReport> {
  assertLiveEnabled(environment);
  const now = deps.now();
  const account = scope
    ? await deps.accounts.resolve(scope.projectId, environment, now)
    : await deps.accounts.get('parent', environment);
  const report: RunReport = { paid: [], skipped: [], floatLow: false };
  const pools = await deps.store.poolSummaries(environment, account.id, scope?.payeeId);
  if (!pools.length) return report;

  const settings = new Map<string, PayoutPolicy>();
  let budget: Centavos | undefined;
  for (const pool of pools) {
    let policy = settings.get(pool.projectId);
    if (!policy) {
      policy = await deps.store.getSettings(environment, pool.projectId);
      settings.set(pool.projectId, policy);
    }
    const effectiveTrigger = trigger.kind === 'cash_out'
      ? { kind: 'cash_out' as const, cashedOutToday: await deps.store.cashedOutToday(environment, pool.payeeId, now) }
      : trigger;
    const due = isDue(pool, policy, effectiveTrigger, now);
    if (!due.due) {
      report.skipped.push({ payeeId: pool.payeeId, reason: due.reason });
      continue;
    }
    budget ??= await floatBudget(deps, account);
    const available = budget;
    const fee = policy.transferFee;
    let spend = 0;
    const created = await deps.store.createPayout(environment, {
      payeeId: pool.payeeId,
      merchantAccountId: account.id,
      trigger: trigger.kind,
      compose: (entries) => {
        const composed = composePayout({ ...entries, fee, feeBearer: due.feeBearer, minimumPayout: policy.minimumPayout, cap: due.cap });
        if ('skip' in composed) return composed;
        // The wallet pays the net amount and PayMongo's fee, whoever bears the fee.
        spend = composed.net + composed.fee;
        if (spend > available) return { skip: 'float_low' };
        return composed;
      },
    });
    if ('skipped' in created) {
      report.skipped.push({ payeeId: pool.payeeId, reason: created.skipped });
      if (created.skipped === 'float_low') {
        report.floatLow = true;
        console.warn(JSON.stringify({ type: 'apicenter_payout_float_low', environment, merchantAccountId: account.id,
          payeeId: pool.payeeId, available }));
      }
      continue;
    }
    budget -= spend;
    await submit(deps, environment, account, created);
    report.paid.push(created.id);
  }
  return report;
}

async function floatBudget(deps: PayoutDeps, account: MerchantAccount): Promise<Centavos> {
  if (!account.wallet) return 0;
  const balance = await deps.mover.availableBalance(account);
  return Math.max(0, balance - account.lowFloatAlert);
}

async function submit(deps: PayoutDeps, environment: Environment, account: MerchantAccount, payout: PayoutRecord): Promise<PayoutRecord> {
  const payee = await deps.store.getPayee(environment, payout.projectId, payout.payeeId);
  if (!payee?.destination) throw new Error(`Payout ${payout.id} has no destination`);
  const attempt = await deps.store.beginAttempt(environment, payout.id);
  const result = await deps.mover.submit({
    account,
    referenceNumber: attempt.referenceNumber,
    amount: payout.net,
    destination: payee.destination,
    metadata: { payoutId: payout.id, payeeId: payout.payeeId },
    ...(deps.callbackUrl ? { callbackUrl: deps.callbackUrl(attempt.callbackToken) } : {}),
  });
  if (result.kind === 'rejected') {
    return deps.store.recordOutcome(environment, payout.id, 'rejected', { failureCode: result.code });
  }
  if (result.kind === 'unknown') {
    console.warn(JSON.stringify({ type: 'apicenter_payout_outcome_unknown', environment, payoutId: payout.id, reason: result.reason }));
    return deps.store.recordOutcome(environment, payout.id, 'lost');
  }
  const accepted = await deps.store.recordOutcome(environment, payout.id, 'accepted', {
    transferId: result.transferId, providerStatus: result.status, ...(result.fee === null ? {} : { fee: result.fee }),
  });
  if (result.status === 'pending') return accepted;
  return deps.store.recordOutcome(environment, payout.id, result.status === 'succeeded' ? 'provider_succeeded' : 'provider_failed');
}

/** Settles pending and unknown payouts by asking PayMongo. Never submits anything. */
export async function reconcileOpenAttempts(deps: PayoutDeps, environment: Environment,
  only?: { payoutId: string }): Promise<{ resolved: number; needsReview: number }> {
  const now = deps.now();
  const tally = { resolved: 0, needsReview: 0 };
  for (const attempt of await deps.store.openAttempts(environment, now)) {
    if (only && attempt.payoutId !== only.payoutId) continue;
    let status = attempt.status;
    if (status === 'submitting') {
      await deps.store.recordOutcome(environment, attempt.payoutId, 'lost');
      status = 'unknown';
    }
    const account = await deps.accounts.get(attempt.merchantAccountId, environment);
    const found = attempt.transferId
      ? await deps.mover.lookup(account, { transferId: attempt.transferId })
      : await deps.mover.lookup(account, {
        referenceNumber: attempt.referenceNumber, since: new Date(Date.parse(attempt.submittedAt) - LOOKUP_WINDOW_MS),
      });
    if (!found.found) {
      if (status === 'unknown' && now.getTime() - Date.parse(attempt.submittedAt) >= UNKNOWN_DEADLINE_MS) {
        await deps.store.recordOutcome(environment, attempt.payoutId, 'not_found_after_deadline');
        tally.needsReview += 1;
        console.warn(JSON.stringify({ type: 'apicenter_payout_needs_review', environment, payoutId: attempt.payoutId }));
      }
      continue;
    }
    const detail = { transferId: found.transferId, providerStatus: found.status,
      ...(found.fee === null ? {} : { fee: found.fee }), ...(found.failureCode ? { failureCode: found.failureCode } : {}) };
    let event: PayoutEvent | undefined;
    if (found.status === 'succeeded') event = 'provider_succeeded';
    else if (found.status === 'failed') event = 'provider_failed';
    else if (status === 'unknown') event = 'accepted';
    if (!event) continue;
    await deps.store.recordOutcome(environment, attempt.payoutId, event, detail);
    if (event !== 'accepted') tally.resolved += 1;
  }
  return tally;
}
