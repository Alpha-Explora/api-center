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
import type { Environment, OpenAttempt, PayoutRecord, PayoutStore } from './payout-store';
import { sendingEnabled, type ProjectFeatureSwitches } from './project-features';
import { FeaturePausedError, type FeaturePauses } from './feature-pauses';

/** How long a transfer PayMongo has no record of stays unknown before an operator must look. */
export const UNKNOWN_DEADLINE_MS = 24 * 60 * 60 * 1000;
/** How far before submission a reference lookup searches. */
const LOOKUP_WINDOW_MS = 60 * 60 * 1000;
/** A transfer PayMongo still reports pending after this long goes to an operator (PESONet takes up to a banking day). */
export const PENDING_DEADLINE_MS = 72 * 60 * 60 * 1000;
/** A draft payout never submitted after this long was left by a crash; nothing was sent, so its shares are freed. */
export const DRAFT_GRACE_MS = 10 * 60 * 1000;

export type PayoutDeps = {
  store: PayoutStore;
  mover: MoneyMover;
  accounts: MerchantAccountResolver;
  now: () => Date;
  projectFeatures?: ProjectFeatureSwitches;
  pauses?: FeaturePauses;
  callbackUrl?: (token: string) => string;
};

export type RunReport = { paid: string[]; skipped: Array<{ payeeId: string; reason: string }>; floatLow: string[] };

/** Pays each due pool from the account holding its released allocations. */
export async function runPayouts(deps: PayoutDeps, environment: Environment, trigger: PayoutTrigger,
  scope?: { payeeId: string; projectId: string }): Promise<RunReport> {
  const paused = await deps.pauses?.isPaused(environment, 'payouts_sending') ?? false;
  if (scope && trigger.kind === 'cash_out') {
    if (paused) throw new FeaturePausedError('payouts_sending');
    if (!await sendingEnabled(deps.projectFeatures, environment, scope.projectId)) {
      throw new PayMongoError('Live payouts are disabled for this project', 409, 'PAYOUTS_LIVE_DISABLED');
    }
  }
  const now = deps.now();
  const accounts = await deps.accounts.listWithReleasedPools?.(environment)
    ?? [await deps.accounts.get('parent', environment)];
  const report: RunReport = { paid: [], skipped: [], floatLow: [] };
  const settings = new Map<string, PayoutPolicy>();
  const access = new Map<string, boolean>();
  for (const account of accounts) {
    await payAccountPools(deps, environment, account, trigger, now, settings, report, access, paused, scope);
  }
  return report;
}

async function payAccountPools(deps: PayoutDeps, environment: Environment, account: MerchantAccount,
  trigger: PayoutTrigger, now: Date, settings: Map<string, PayoutPolicy>, report: RunReport,
  access: Map<string, boolean>, paused: boolean,
  scope?: { payeeId: string; projectId: string }): Promise<void> {
  const pools = await deps.store.poolSummaries(environment, account.id, scope?.payeeId);
  let budget: Centavos | undefined;
  for (const pool of pools) {
    if (scope && pool.projectId !== scope.projectId) continue;
    if (paused || await deps.pauses?.isPaused(environment, 'payouts_sending')) {
      report.skipped.push({ payeeId: pool.payeeId, reason: 'paused' });
      continue;
    }
    if (!access.has(pool.projectId)) access.set(pool.projectId, await sendingEnabled(deps.projectFeatures, environment, pool.projectId));
    if (!access.get(pool.projectId)) {
      report.skipped.push({ payeeId: pool.payeeId, reason: 'project_not_enabled' });
      continue;
    }
    let policy = settings.get(pool.projectId);
    if (!policy) {
      policy = await deps.store.getSettings(environment, pool.projectId);
      settings.set(pool.projectId, policy);
    }
    if (policy.requirePayeeVerification && !pool.verified) {
      report.skipped.push({ payeeId: pool.payeeId, reason: 'payee_unverified' });
      continue;
    }
    if (pool.settling && pool.available <= 0) {
      report.skipped.push({ payeeId: pool.payeeId, reason: 'in_settlement' });
      continue;
    }
    let effectiveTrigger: PayoutTrigger = trigger.kind === 'cash_out'
      ? { kind: 'cash_out' as const, cashedOutToday: await deps.store.cashedOutToday(environment, pool.payeeId, now) }
      : trigger;
    let due = isDue(pool, policy, effectiveTrigger, now);
    if (trigger.kind === 'schedule' && !due.due && due.reason === 'not_scheduled' && (policy.immediate || policy.thresholdCentavos !== null)) {
      effectiveTrigger = { kind: 'release' };
      due = isDue(pool, policy, effectiveTrigger, now);
    }
    if (!due.due) {
      report.skipped.push({ payeeId: pool.payeeId, reason: due.reason });
      continue;
    }
    try {
      budget ??= await floatBudget(deps, account);
    } catch (error) {
      if (account.kind === 'parent') throw error;
      report.skipped.push({ payeeId: pool.payeeId, reason: 'wallet_unavailable' });
      console.warn(JSON.stringify({ type: 'apicenter_payout_balance_unavailable', environment, merchantAccountId: account.id }));
      return;
    }
    const available = budget;
    const fee = policy.transferFee;
    let spend = 0;
    const created = await deps.store.createPayout(environment, {
      payeeId: pool.payeeId,
      merchantAccountId: account.id,
      trigger: effectiveTrigger.kind,
      // The cash-out cap is checked again under the payee lock, so two cash-outs at once cannot both use it.
      ...(trigger.kind === 'cash_out' && policy.onDemand ? { dailyCap: policy.onDemand.dailyCap } : {}),
      compose: (entries, limits) => {
        const cap = Math.min(due.cap, limits.remainingDailyCap ?? Number.POSITIVE_INFINITY);
        const composed = composePayout({ ...entries, fee, feeBearer: due.feeBearer, minimumPayout: policy.minimumPayout, cap });
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
        if (!report.floatLow.includes(account.id)) report.floatLow.push(account.id);
        console.warn(JSON.stringify({ type: 'apicenter_payout_float_low', environment, merchantAccountId: account.id,
          payeeId: pool.payeeId, available }));
      }
      continue;
    }
    if (await deps.pauses?.isPaused(environment, 'payouts_sending')) {
      await deps.store.recordOutcome(environment, created.id, 'abandoned', { failureCode: 'not_submitted' });
      report.skipped.push({ payeeId: pool.payeeId, reason: 'paused' });
      continue;
    }
    budget -= spend;
    await submit(deps, environment, account, created);
    report.paid.push(created.id);
  }
}

async function floatBudget(deps: PayoutDeps, account: MerchantAccount): Promise<Centavos> {
  if (!account.wallet) {
    throw new PayMongoError('The payout wallet is not configured for this merchant account', 409, 'WALLET_NOT_CONFIGURED');
  }
  const balance = await deps.mover.availableBalance(account);
  return Math.max(0, balance - account.lowFloatAlert);
}

async function submit(deps: PayoutDeps, environment: Environment, account: MerchantAccount, payout: PayoutRecord): Promise<PayoutRecord> {
  // Always the destination stored with the payout, which passed the hold check under the payee lock.
  const destination = await deps.store.payoutDestination(environment, payout.id);
  const attempt = await deps.store.beginAttempt(environment, payout.id);
  const result = await deps.mover.submit({
    account,
    referenceNumber: attempt.referenceNumber,
    amount: payout.net,
    destination,
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

/**
 * Settles pending and unknown payouts by asking PayMongo, and frees drafts a crash left unsubmitted.
 * Never submits anything. One payout's failure is logged and counted; it never stops the others.
 */
export async function reconcileOpenAttempts(deps: PayoutDeps, environment: Environment,
  only?: { payoutId: string }): Promise<{ resolved: number; needsReview: number; errors: number }> {
  const now = deps.now();
  const tally = { resolved: 0, needsReview: 0, errors: 0 };
  if (!only) {
    for (const payoutId of await deps.store.staleDrafts(environment, new Date(now.getTime() - DRAFT_GRACE_MS))) {
      try {
        await deps.store.recordOutcome(environment, payoutId, 'abandoned', { failureCode: 'not_submitted' });
        tally.resolved += 1;
      } catch (error) {
        tally.errors += 1;
        logReconcileError(environment, payoutId, error);
      }
    }
  }
  for (const attempt of await deps.store.openAttempts(environment, now)) {
    if (only && attempt.payoutId !== only.payoutId) continue;
    try {
      const outcome = await reconcileAttempt(deps, environment, attempt, now);
      if (outcome === 'resolved') tally.resolved += 1;
      if (outcome === 'needs_review') tally.needsReview += 1;
    } catch (error) {
      // Typically a callback and this job settled the same payout at once; the next run sees the result.
      tally.errors += 1;
      logReconcileError(environment, attempt.payoutId, error);
    }
  }
  return tally;
}

function logReconcileError(environment: Environment, payoutId: string, error: unknown): void {
  console.error(JSON.stringify({ type: 'apicenter_payout_reconcile_failed', environment, payoutId,
    code: (error as { code?: string }).code, message: (error as Error).message }));
}

async function reconcileAttempt(deps: PayoutDeps, environment: Environment,
  attempt: OpenAttempt, now: Date): Promise<'resolved' | 'needs_review' | 'open'> {
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
  const age = now.getTime() - Date.parse(attempt.submittedAt);
  if (!found.found) {
    if (status === 'unknown' && age >= UNKNOWN_DEADLINE_MS) {
      await deps.store.recordOutcome(environment, attempt.payoutId, 'not_found_after_deadline');
      console.warn(JSON.stringify({ type: 'apicenter_payout_needs_review', environment, payoutId: attempt.payoutId }));
      return 'needs_review';
    }
    return 'open';
  }
  const detail = { transferId: found.transferId, providerStatus: found.status,
    ...(found.fee === null ? {} : { fee: found.fee }), ...(found.failureCode ? { failureCode: found.failureCode } : {}) };
  let event: PayoutEvent | undefined;
  if (found.status === 'succeeded') event = 'provider_succeeded';
  else if (found.status === 'failed') event = 'provider_failed';
  else if (status === 'unknown') event = 'accepted';
  else if (age >= PENDING_DEADLINE_MS) event = 'stalled';
  if (!event) return 'open';
  await deps.store.recordOutcome(environment, attempt.payoutId, event, detail);
  if (event === 'stalled') {
    console.warn(JSON.stringify({ type: 'apicenter_payout_needs_review', environment, payoutId: attempt.payoutId, reason: 'pending_too_long' }));
    return 'needs_review';
  }
  return event === 'accepted' ? 'open' : 'resolved';
}
