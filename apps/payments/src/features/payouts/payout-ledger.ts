// The payout ledger's rules: which state changes are legal for an allocation (a payee's share of one
// payment) and for a payout (one pooled transfer), what a refund does to a share, and how a payee's
// pool becomes one payout. Pure: no I/O, so the store and the executor share one definition.

export type Centavos = number;

export type AllocationStatus = 'awaiting_payment' | 'held' | 'released' | 'pooled' | 'paid' | 'cancelled';
export type AllocationEvent = 'payment_confirmed' | 'release' | 'cancel' | 'pool' | 'payout_paid' | 'payout_failed';

export type PayoutStatus = 'draft' | 'submitting' | 'pending' | 'unknown' | 'paid' | 'failed' | 'needs_review';
export type PayoutEvent = 'submit' | 'accepted' | 'rejected' | 'lost' | 'provider_succeeded' | 'provider_failed'
  | 'not_found_after_deadline' | 'operator_paid' | 'operator_failed';

export class PayoutStateError extends Error {
  constructor(readonly from: string, readonly event: string) {
    super(`Cannot apply ${event} to ${from}`);
    this.name = 'PayoutStateError';
  }
}

const ALLOCATION_TRANSITIONS: Record<AllocationStatus, Partial<Record<AllocationEvent, AllocationStatus>>> = {
  awaiting_payment: { payment_confirmed: 'held', cancel: 'cancelled' },
  held: { release: 'released', cancel: 'cancelled' },
  released: { pool: 'pooled', cancel: 'cancelled' },
  pooled: { payout_paid: 'paid', payout_failed: 'released' },
  paid: {},
  cancelled: {},
};

// An unknown payout may have reached PayMongo, so it is never submitted again: only the provider's
// answer (via lookup) or an operator who checked the PayMongo dashboard can settle it.
const PAYOUT_TRANSITIONS: Record<PayoutStatus, Partial<Record<PayoutEvent, PayoutStatus>>> = {
  draft: { submit: 'submitting' },
  submitting: { accepted: 'pending', rejected: 'failed', lost: 'unknown' },
  unknown: { accepted: 'pending', provider_succeeded: 'paid', provider_failed: 'failed', not_found_after_deadline: 'needs_review' },
  pending: { provider_succeeded: 'paid', provider_failed: 'failed' },
  needs_review: { operator_paid: 'paid', operator_failed: 'failed' },
  paid: {},
  failed: {},
};

export function transitionAllocation(from: AllocationStatus, event: AllocationEvent): AllocationStatus {
  const to = ALLOCATION_TRANSITIONS[from]?.[event];
  if (!to) throw new PayoutStateError(from, event);
  return to;
}

export function transitionPayout(from: PayoutStatus, event: PayoutEvent): PayoutStatus {
  const to = PAYOUT_TRANSITIONS[from]?.[event];
  if (!to) throw new PayoutStateError(from, event);
  return to;
}

/** A refund cancels a share that has not left; a share already pooled or paid is recovered from later earnings. */
export function refundEffect(status: AllocationStatus): 'cancel' | 'clawback' | 'none' {
  if (status === 'awaiting_payment' || status === 'held' || status === 'released') return 'cancel';
  if (status === 'pooled' || status === 'paid') return 'clawback';
  return 'none';
}

/** The payee's part of a refund: the allocation's proportion of the refunded amount, rounded down. */
export function refundShare(allocation: Centavos, gross: Centavos, refunded: Centavos): Centavos {
  assertCentavos(allocation, gross, refunded);
  if (gross <= 0) throw new RangeError('gross must be positive');
  return Math.min(allocation, Math.floor((allocation * refunded) / gross));
}

export type PoolEntry = { id: string; amount: Centavos; createdAt: string };

export type ComposeInput = {
  allocations: PoolEntry[];
  adjustments: PoolEntry[];
  fee: Centavos;
  feeBearer: 'platform' | 'payee';
  minimumPayout: Centavos;
  /** Most the allocations may add up to; whole allocations only, oldest first. */
  cap?: Centavos;
};

export type ComposedPayout = { gross: Centavos; fee: Centavos; net: Centavos; allocationIds: string[]; adjustmentIds: string[] };

/**
 * Turns a payee's pool into one payout. `gross` is the allocations taken; every adjustment is always
 * included so clawbacks are never deferred; the fee comes out of `net` only when the payee bears it.
 */
export function composePayout(input: ComposeInput): ComposedPayout | { skip: 'below_minimum' | 'not_positive' } {
  assertCentavos(input.fee, input.minimumPayout, ...input.allocations.map((entry) => entry.amount),
    ...input.adjustments.map((entry) => entry.amount), ...(input.cap === undefined ? [] : [input.cap]));
  const cap = input.cap ?? Number.POSITIVE_INFINITY;
  const oldestFirst = [...input.allocations].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const taken: PoolEntry[] = [];
  let gross = 0;
  for (const allocation of oldestFirst) {
    if (gross + allocation.amount > cap) break;
    taken.push(allocation);
    gross += allocation.amount;
  }
  const adjustments = input.adjustments.reduce((sum, entry) => sum + entry.amount, 0);
  const net = gross + adjustments - (input.feeBearer === 'payee' ? input.fee : 0);
  if (net <= 0) return { skip: 'not_positive' };
  if (net < input.minimumPayout) return { skip: 'below_minimum' };
  return {
    gross,
    fee: input.fee,
    net,
    allocationIds: taken.map((entry) => entry.id),
    adjustmentIds: input.adjustments.map((entry) => entry.id),
  };
}

function assertCentavos(...amounts: number[]): void {
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount)) throw new RangeError(`Amount ${amount} is not a whole number of centavos`);
  }
}
