// Payout ledger storage. Two implementations with one contract: Postgres for deployed runtimes and an
// in-memory store for mock mode and unit tests. Every state change goes through the ledger's transition
// tables, and pooling a payee's earnings into a payout is one transaction serialized on the payee row,
// so two concurrent runs can never pay the same allocation twice.

import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PayMongoError } from '../../shared/payment-errors';
import type { PaymentContext } from '../../shared/payment-owner-store';
import type { PayoutDestination } from './money-mover';
import {
  PayoutStateError,
  refundEffect,
  refundShare,
  transitionAllocation,
  transitionPayout,
  type AllocationEvent,
  type AllocationStatus,
  type Centavos,
  type ComposedPayout,
  type PayoutEvent,
  type PayoutStatus,
  type PoolEntry,
} from './payout-ledger';
import { DEFAULT_PAYOUT_POLICY, manilaDay, manilaWeekStart, type PayoutPolicy, type PayoutTrigger, type PoolSummary } from './payout-policy';

export type Environment = 'test' | 'live';

/** Who a payout request acts for. The signed context calls the organization `tribeId`; payouts do not. */
export type PayoutContext = { organizationId: string; projectId: string; consumerServiceId: string; environment: Environment };

export function payoutContext(context: PaymentContext): PayoutContext {
  return {
    organizationId: context.tribeId,
    projectId: context.projectId,
    consumerServiceId: context.consumerServiceId,
    environment: context.environment,
  };
}

export type Payee = {
  id: string;
  projectId: string;
  externalRef: string;
  legalName: string;
  status: 'active' | 'suspended';
  destination: PayoutDestination | null;
  destinationHoldUntil: string | null;
  createdAt: string;
};

export type AllocationRecord = {
  id: string;
  payeeId: string;
  projectId: string;
  merchantAccountId: string;
  resourceType: 'intent' | 'checkout' | 'payment_link';
  resourceId: string;
  referenceId: string;
  template: boolean;
  paymentId: string | null;
  amount: Centavos;
  grossAmount: Centavos;
  status: AllocationStatus;
  payoutId: string | null;
  createdAt: string;
};

export type NewAllocation = Omit<AllocationRecord, 'id' | 'projectId' | 'payoutId' | 'createdAt'> & { createdAt?: string };

export type PayoutRecord = {
  id: string;
  payeeId: string;
  projectId: string;
  merchantAccountId: string;
  gross: Centavos;
  fee: Centavos;
  net: Centavos;
  trigger: PayoutTrigger['kind'];
  status: PayoutStatus;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PayoutStoreEvent = {
  eventType: 'payment.allocation.held' | 'payment.payout.paid' | 'payment.payout.failed';
  aggregateType: 'allocation' | 'payout';
  aggregateId: string;
  organizationId: string;
  projectId: string;
  consumerServiceId: string;
  referenceId: string;
  payload: Record<string, unknown>;
};

export type OpenAttempt = {
  payoutId: string;
  merchantAccountId: string;
  referenceNumber: string;
  transferId: string | null;
  status: 'submitting' | 'pending' | 'unknown';
  submittedAt: string;
};

export type OutcomeDetail = Partial<{ transferId: string; providerStatus: 'pending' | 'succeeded' | 'failed'; fee: Centavos;
  failureCode: string; note: string; actor: string }>;

export type ComposeFn = (pool: { allocations: PoolEntry[]; adjustments: PoolEntry[] }) => ComposedPayout | { skip: string };

export type PageQuery = { cursor?: string; limit?: number };
export type Page<T> = { records: T[]; nextCursor?: string };
export type Earnings = { awaitingPayment: Centavos; held: Centavos; available: Centavos; inFlight: Centavos; paidThisWeek: Centavos };

const IN_FLIGHT: PayoutStatus[] = ['draft', 'submitting', 'pending', 'unknown', 'needs_review'];

export function encodeCursor(record: { createdAt: string; id: string }): string {
  return Buffer.from(JSON.stringify([record.createdAt, record.id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof createdAt === 'string' && typeof id === 'string' && !Number.isNaN(Date.parse(createdAt))) return { createdAt, id };
  } catch {
    // Reported below.
  }
  throw new PayMongoError('cursor is invalid', 400, 'INVALID_CURSOR');
}

function pageLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? 25), 1), 100);
}

/** Newest first, after the cursor. */
function pageOf<T extends { createdAt: string; id: string }>(rows: T[], query: PageQuery): Page<T> {
  const after = decodeCursor(query.cursor);
  const limit = pageLimit(query.limit);
  const sorted = [...rows].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .filter((row) => !after || row.createdAt < after.createdAt || (row.createdAt === after.createdAt && row.id < after.id));
  const records = sorted.slice(0, limit);
  return { records, ...(sorted.length > limit ? { nextCursor: encodeCursor(records[records.length - 1]) } : {}) };
}

function paged<T extends { createdAt: string; id: string }>(rows: T[], limit: number): Page<T> {
  const records = rows.slice(0, limit);
  return { records, ...(rows.length > limit ? { nextCursor: encodeCursor(records[records.length - 1]) } : {}) };
}

function invalidAllocationState(error: unknown): never {
  if (error instanceof PayoutStateError) {
    throw new PayMongoError(`An allocation that is ${error.from} cannot be ${error.event === 'release' ? 'released' : 'cancelled'}`,
      409, 'INVALID_ALLOCATION_STATE');
  }
  throw error;
}

/** A succeeded refund of a payment, as the payout ledger sees it. */
export type RefundFact = { paymentId: string; refundId: string; refunded: Centavos };

export interface PayoutStore {
  upsertPayee(context: PayoutContext, input: { externalRef: string; legalName: string }): Promise<{ payee: Payee; created: boolean }>;
  getPayee(environment: Environment, projectId: string, payeeId: string): Promise<Payee | null>;
  findPayees(environment: Environment, projectId: string, payeeIds: string[]): Promise<Payee[]>;
  /**
   * Holds the allocations of a resource that was just paid (copying a payment link's templates per
   * payment) and queues one allocation.held event each. Idempotent. `client` joins the webhook's transaction.
   */
  holdForPayment(environment: Environment, resource: { type: AllocationRecord['resourceType']; id: string }, paymentId: string,
    client?: PoolClient): Promise<AllocationRecord[]>;
  /** Cancels or claws back the shares of a refunded payment. Idempotent per refund. */
  applyRefund(environment: Environment, refund: RefundFact, client?: PoolClient): Promise<void>;
  setPayeeDestination(environment: Environment, projectId: string, payeeId: string, destination: PayoutDestination, now: Date): Promise<Payee | null>;
  insertAllocations(context: PayoutContext, rows: NewAllocation[]): Promise<AllocationRecord[]>;
  getSettings(environment: Environment, projectId: string): Promise<PayoutPolicy>;
  poolSummaries(environment: Environment, merchantAccountId: string, payeeId?: string): Promise<Array<PoolSummary & { payeeId: string; projectId: string }>>;
  cashedOutToday(environment: Environment, payeeId: string, now: Date): Promise<Centavos>;
  createPayout(environment: Environment, input: { payeeId: string; merchantAccountId: string; trigger: PayoutTrigger['kind']; compose: ComposeFn }):
    Promise<PayoutRecord | { skipped: string }>;
  beginAttempt(environment: Environment, payoutId: string): Promise<{ referenceNumber: string; callbackToken: string }>;
  recordOutcome(environment: Environment, payoutId: string, event: PayoutEvent, detail?: OutcomeDetail): Promise<PayoutRecord>;
  openAttempts(environment: Environment, now: Date): Promise<OpenAttempt[]>;
  attemptByCallbackToken(token: string): Promise<{ environment: Environment; payoutId: string } | null>;
  listPayees(environment: Environment, projectId: string, query: PageQuery): Promise<Page<Payee>>;
  /** Releases or cancels a project's allocation; 404 for another project's, 409 for an illegal change. */
  changeAllocation(environment: Environment, projectId: string, allocationId: string, event: 'release' | 'cancel'): Promise<AllocationRecord>;
  earnings(environment: Environment, payeeId: string, now: Date): Promise<Earnings>;
  listPayouts(environment: Environment, projectId: string, query: PageQuery & { payeeId?: string; status?: PayoutStatus }): Promise<Page<PayoutRecord>>;
  getPayout(environment: Environment, projectId: string, payoutId: string): Promise<PayoutRecord | null>;
}

/** A submitting payout whose outcome was never recorded (the process died mid-call) is unknown after this long. */
export const SUBMITTING_GRACE_MS = 2 * 60 * 1000;

export function newId(prefix: 'pye' | 'pal' | 'padj' | 'po' | 'pta'): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

/** PayMongo keeps only alphanumerics in a reference, so the payout id maps to its uppercase hex part. */
export function referenceNumberFor(payoutId: string): string {
  return payoutId.replace(/^po_/, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function heldEvent(allocation: AllocationRecord, owner: { organizationId: string; consumerServiceId: string }, now: string): PayoutStoreEvent {
  return {
    eventType: 'payment.allocation.held',
    aggregateType: 'allocation',
    aggregateId: allocation.id,
    organizationId: owner.organizationId,
    projectId: allocation.projectId,
    consumerServiceId: owner.consumerServiceId,
    referenceId: allocation.referenceId,
    payload: {
      status: 'held',
      allocationId: allocation.id,
      payeeId: allocation.payeeId,
      paymentId: allocation.paymentId,
      amount: allocation.amount,
      currency: 'PHP',
      occurredAt: now,
    },
  };
}

/**
 * What a refund does to one share: a full refund cancels a share that has not left; anything else
 * (a partial refund, or a share already pooled or paid) becomes a clawback against later earnings.
 */
function refundAction(allocation: Pick<AllocationRecord, 'status' | 'amount' | 'grossAmount'>, refunded: Centavos):
  { kind: 'cancel' } | { kind: 'clawback'; amount: Centavos } | { kind: 'none' } {
  const effect = refundEffect(allocation.status);
  if (effect === 'none') return { kind: 'none' };
  if (effect === 'cancel' && refunded >= allocation.grossAmount) return { kind: 'cancel' };
  const share = refundShare(allocation.amount, allocation.grossAmount, refunded);
  return share > 0 ? { kind: 'clawback', amount: share } : { kind: 'none' };
}

function payoutEvent(record: PayoutRecord, payee: { externalRef: string }, owner: { organizationId: string; consumerServiceId: string },
  status: 'paid' | 'failed', failureCode: string | null, now: string): PayoutStoreEvent {
  return {
    eventType: status === 'paid' ? 'payment.payout.paid' : 'payment.payout.failed',
    aggregateType: 'payout',
    aggregateId: record.id,
    organizationId: owner.organizationId,
    projectId: record.projectId,
    consumerServiceId: owner.consumerServiceId,
    referenceId: payee.externalRef,
    payload: {
      status,
      payoutId: record.id,
      payeeId: record.payeeId,
      net: record.net,
      fee: record.fee,
      currency: 'PHP',
      trigger: record.trigger,
      ...(status === 'failed' && failureCode ? { failureCode } : {}),
      occurredAt: now,
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------------------------------

type MemoryPayee = Payee & { environment: Environment; organizationId: string; consumerServiceId: string };
type MemoryAllocation = AllocationRecord & { environment: Environment; organizationId: string; consumerServiceId: string };
type MemoryAdjustment = { id: string; environment: Environment; projectId: string; merchantAccountId: string; payeeId: string;
  amount: Centavos; reason: 'clawback' | 'manual'; sourceAllocationId: string | null; sourceRefundId: string | null;
  payoutId: string | null; createdAt: string };
type MemoryPayout = PayoutRecord & { environment: Environment; organizationId: string; consumerServiceId: string;
  destination: PayoutDestination; resolutionNote: string | null; resolvedBy: string | null };
type MemoryAttempt = { id: string; environment: Environment; payoutId: string; referenceNumber: string; callbackToken: string;
  transferId: string | null; providerStatus: 'pending' | 'succeeded' | 'failed' | null; fee: Centavos | null;
  failureCode: string | null; submittedAt: string };

export class MemoryPayoutStore implements PayoutStore {
  readonly payees = new Map<string, MemoryPayee>();
  readonly allocations = new Map<string, MemoryAllocation>();
  readonly adjustments = new Map<string, MemoryAdjustment>();
  readonly payouts = new Map<string, MemoryPayout>();
  readonly attempts = new Map<string, MemoryAttempt>();
  readonly settings = new Map<string, PayoutPolicy>();
  readonly events: PayoutStoreEvent[] = [];
  private readonly eventKeys = new Set<string>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  queue(event: PayoutStoreEvent): void {
    const key = `${event.eventType}:${event.aggregateId}`;
    if (this.eventKeys.has(key)) return;
    this.eventKeys.add(key);
    this.events.push(event);
  }

  async upsertPayee(context: PayoutContext, input: { externalRef: string; legalName: string }) {
    const existing = [...this.payees.values()].find((payee) => payee.environment === context.environment
      && payee.projectId === context.projectId && payee.externalRef === input.externalRef);
    if (existing) return { payee: publicPayee(existing), created: false };
    const payee: MemoryPayee = {
      id: newId('pye'), environment: context.environment, organizationId: context.organizationId, projectId: context.projectId,
      consumerServiceId: context.consumerServiceId, externalRef: input.externalRef, legalName: input.legalName, status: 'active',
      destination: null, destinationHoldUntil: null, createdAt: this.clock().toISOString(),
    };
    this.payees.set(payee.id, payee);
    return { payee: publicPayee(payee), created: true };
  }

  async getPayee(environment: Environment, projectId: string, payeeId: string) {
    const payee = this.payees.get(payeeId);
    return payee && payee.environment === environment && payee.projectId === projectId ? publicPayee(payee) : null;
  }

  async findPayees(environment: Environment, projectId: string, payeeIds: string[]) {
    return payeeIds.map((id) => this.payees.get(id))
      .filter((payee): payee is MemoryPayee => Boolean(payee && payee.environment === environment && payee.projectId === projectId))
      .map(publicPayee);
  }

  async holdForPayment(environment: Environment, resource: { type: AllocationRecord['resourceType']; id: string }, paymentId: string) {
    const now = this.clock().toISOString();
    const held: AllocationRecord[] = [];
    const matching = [...this.allocations.values()].filter((entry) => entry.environment === environment
      && entry.resourceType === resource.type && entry.resourceId === resource.id);
    if (resource.type === 'payment_link') {
      for (const template of matching.filter((entry) => entry.template)) {
        if (matching.some((entry) => !entry.template && entry.paymentId === paymentId && entry.payeeId === template.payeeId)) continue;
        const copy: MemoryAllocation = { ...template, id: newId('pal'), template: false, paymentId, status: 'held', payoutId: null, createdAt: now };
        this.allocations.set(copy.id, copy);
        held.push(publicAllocation(copy));
        this.queue(heldEvent(publicAllocation(copy), copy, now));
      }
      return held;
    }
    for (const allocation of matching) {
      if (allocation.status !== 'awaiting_payment' || allocation.paymentId !== null) continue;
      allocation.status = transitionAllocation(allocation.status, 'payment_confirmed');
      allocation.paymentId = paymentId;
      held.push(publicAllocation(allocation));
      this.queue(heldEvent(publicAllocation(allocation), allocation, now));
    }
    return held;
  }

  async applyRefund(environment: Environment, refund: RefundFact) {
    for (const allocation of this.allocations.values()) {
      if (allocation.environment !== environment || allocation.paymentId !== refund.paymentId || allocation.template) continue;
      const action = refundAction(allocation, refund.refunded);
      if (action.kind === 'cancel') {
        allocation.status = transitionAllocation(allocation.status, 'cancel');
      } else if (action.kind === 'clawback') {
        const exists = [...this.adjustments.values()].some((entry) => entry.sourceAllocationId === allocation.id
          && entry.sourceRefundId === refund.refundId);
        if (exists) continue;
        const adjustment: MemoryAdjustment = { id: newId('padj'), environment, projectId: allocation.projectId,
          merchantAccountId: allocation.merchantAccountId, payeeId: allocation.payeeId, amount: -action.amount, reason: 'clawback',
          sourceAllocationId: allocation.id, sourceRefundId: refund.refundId, payoutId: null, createdAt: this.clock().toISOString() };
        this.adjustments.set(adjustment.id, adjustment);
      }
    }
  }

  async setPayeeDestination(environment: Environment, projectId: string, payeeId: string, destination: PayoutDestination, now: Date) {
    const payee = this.payees.get(payeeId);
    if (!payee || payee.environment !== environment || payee.projectId !== projectId) return null;
    if (!sameDestination(payee.destination, destination)) {
      payee.destination = normalizeDestination(destination);
      payee.destinationHoldUntil = new Date(now.getTime() + DESTINATION_HOLD_MS).toISOString();
    }
    return publicPayee(payee);
  }

  async insertAllocations(context: PayoutContext, rows: NewAllocation[]) {
    return rows.map((row) => {
      const allocation: MemoryAllocation = {
        ...row, id: newId('pal'), environment: context.environment, organizationId: context.organizationId,
        projectId: context.projectId, consumerServiceId: context.consumerServiceId, payoutId: null,
        createdAt: row.createdAt ?? this.clock().toISOString(),
      };
      this.allocations.set(allocation.id, allocation);
      return publicAllocation(allocation);
    });
  }

  async getSettings(environment: Environment, projectId: string) {
    return this.settings.get(`${environment}:${projectId}`) ?? DEFAULT_PAYOUT_POLICY;
  }

  async poolSummaries(environment: Environment, merchantAccountId: string, payeeId?: string) {
    const byPayee = new Map<string, number>();
    for (const allocation of this.allocations.values()) {
      if (allocation.environment !== environment || allocation.merchantAccountId !== merchantAccountId
        || allocation.status !== 'released' || (payeeId && allocation.payeeId !== payeeId)) continue;
      byPayee.set(allocation.payeeId, (byPayee.get(allocation.payeeId) ?? 0) + allocation.amount);
    }
    const summaries = [];
    for (const [id, released] of byPayee) {
      const payee = this.payees.get(id)!;
      if (payee.status !== 'active') continue;
      const adjustments = [...this.adjustments.values()]
        .filter((entry) => entry.payeeId === id && entry.merchantAccountId === merchantAccountId && entry.payoutId === null)
        .reduce((sum, entry) => sum + entry.amount, 0);
      const scheduled = [...this.payouts.values()]
        .filter((payout) => payout.payeeId === id && payout.trigger === 'schedule' && payout.status !== 'failed')
        .map((payout) => payout.createdAt).sort().at(-1) ?? null;
      summaries.push({
        payeeId: id, projectId: payee.projectId, available: released + adjustments, hasDestination: payee.destination !== null,
        destinationHoldUntil: payee.destinationHoldUntil, lastScheduledPayoutAt: scheduled,
      });
    }
    return summaries;
  }

  async cashedOutToday(environment: Environment, payeeId: string, now: Date) {
    const { start, end } = manilaDay(now);
    return [...this.payouts.values()]
      .filter((payout) => payout.environment === environment && payout.payeeId === payeeId && payout.trigger === 'cash_out'
        && payout.status !== 'failed' && Date.parse(payout.createdAt) >= start.getTime() && Date.parse(payout.createdAt) < end.getTime())
      .reduce((sum, payout) => sum + payout.gross, 0);
  }

  // No await between reading the pool and pooling it, so the in-memory version is atomic too.
  async createPayout(environment: Environment, input: { payeeId: string; merchantAccountId: string; trigger: PayoutTrigger['kind']; compose: ComposeFn }) {
    const payee = this.payees.get(input.payeeId);
    if (!payee || payee.environment !== environment) return { skipped: 'payee_not_found' };
    if (!payee.destination) return { skipped: 'no_destination' };
    const allocations = [...this.allocations.values()].filter((entry) => entry.environment === environment
      && entry.payeeId === input.payeeId && entry.merchantAccountId === input.merchantAccountId && entry.status === 'released');
    const adjustments = [...this.adjustments.values()].filter((entry) => entry.environment === environment
      && entry.payeeId === input.payeeId && entry.merchantAccountId === input.merchantAccountId && entry.payoutId === null);
    if (!allocations.length) return { skipped: 'nothing_released' };
    const composed = input.compose({
      allocations: allocations.map((entry) => ({ id: entry.id, amount: entry.amount, createdAt: entry.createdAt })),
      adjustments: adjustments.map((entry) => ({ id: entry.id, amount: entry.amount, createdAt: entry.createdAt })),
    });
    if ('skip' in composed) return { skipped: composed.skip };
    const now = this.clock().toISOString();
    const payout: MemoryPayout = {
      id: newId('po'), environment, organizationId: payee.organizationId, consumerServiceId: payee.consumerServiceId,
      projectId: payee.projectId, payeeId: payee.id, merchantAccountId: input.merchantAccountId, gross: composed.gross,
      fee: composed.fee, net: composed.net, trigger: input.trigger, status: 'draft', failureCode: null,
      destination: payee.destination, resolutionNote: null, resolvedBy: null, createdAt: now, updatedAt: now,
    };
    this.payouts.set(payout.id, payout);
    for (const id of composed.allocationIds) this.moveAllocation(id, 'pool', payout.id);
    for (const id of composed.adjustmentIds) this.adjustments.get(id)!.payoutId = payout.id;
    return publicPayout(payout);
  }

  async beginAttempt(environment: Environment, payoutId: string) {
    const payout = this.requirePayout(environment, payoutId);
    payout.status = transitionPayout(payout.status, 'submit');
    payout.updatedAt = this.clock().toISOString();
    const attempt: MemoryAttempt = {
      id: newId('pta'), environment, payoutId, referenceNumber: referenceNumberFor(payoutId),
      callbackToken: randomBytes(32).toString('base64url'), transferId: null, providerStatus: null, fee: null,
      failureCode: null, submittedAt: this.clock().toISOString(),
    };
    this.attempts.set(attempt.id, attempt);
    return { referenceNumber: attempt.referenceNumber, callbackToken: attempt.callbackToken };
  }

  async recordOutcome(environment: Environment, payoutId: string, event: PayoutEvent, detail: OutcomeDetail = {}) {
    const payout = this.requirePayout(environment, payoutId);
    const next = transitionPayout(payout.status, event);
    const attempt = [...this.attempts.values()].find((entry) => entry.payoutId === payoutId && entry.providerStatus !== 'failed');
    if (attempt) {
      if (detail.transferId) attempt.transferId = detail.transferId;
      if (detail.providerStatus) attempt.providerStatus = detail.providerStatus;
      if (detail.fee !== undefined) attempt.fee = detail.fee;
      if (detail.failureCode) attempt.failureCode = detail.failureCode;
      if (next === 'failed') attempt.providerStatus = 'failed';
    }
    payout.status = next;
    payout.updatedAt = this.clock().toISOString();
    if (detail.failureCode) payout.failureCode = detail.failureCode;
    if (detail.note) payout.resolutionNote = detail.note;
    if (detail.actor) payout.resolvedBy = detail.actor;
    if (next === 'paid' || next === 'failed') {
      for (const allocation of this.allocations.values()) {
        if (allocation.payoutId !== payoutId || allocation.status !== 'pooled') continue;
        this.moveAllocation(allocation.id, next === 'paid' ? 'payout_paid' : 'payout_failed', next === 'paid' ? payoutId : null);
      }
      if (next === 'failed') {
        for (const adjustment of this.adjustments.values()) if (adjustment.payoutId === payoutId) adjustment.payoutId = null;
      }
      const payee = this.payees.get(payout.payeeId)!;
      this.queue(payoutEvent(publicPayout(payout), payee, payout, next, payout.failureCode, payout.updatedAt));
    }
    return publicPayout(payout);
  }

  async openAttempts(environment: Environment, now: Date) {
    const open: OpenAttempt[] = [];
    for (const attempt of this.attempts.values()) {
      if (attempt.environment !== environment || attempt.providerStatus === 'failed') continue;
      const payout = this.payouts.get(attempt.payoutId)!;
      const stale = payout.status === 'submitting' && now.getTime() - Date.parse(attempt.submittedAt) >= SUBMITTING_GRACE_MS;
      if (payout.status !== 'pending' && payout.status !== 'unknown' && !stale) continue;
      open.push({ payoutId: payout.id, merchantAccountId: payout.merchantAccountId, referenceNumber: attempt.referenceNumber,
        transferId: attempt.transferId, status: payout.status as OpenAttempt['status'], submittedAt: attempt.submittedAt });
    }
    return open;
  }

  async attemptByCallbackToken(token: string) {
    const attempt = [...this.attempts.values()].find((entry) => entry.callbackToken === token);
    return attempt ? { environment: attempt.environment, payoutId: attempt.payoutId } : null;
  }

  async listPayees(environment: Environment, projectId: string, query: PageQuery) {
    return pageOf([...this.payees.values()].filter((payee) => payee.environment === environment && payee.projectId === projectId)
      .map(publicPayee), query);
  }

  async changeAllocation(environment: Environment, projectId: string, allocationId: string, event: 'release' | 'cancel') {
    const allocation = this.allocations.get(allocationId);
    if (!allocation || allocation.environment !== environment || allocation.projectId !== projectId || allocation.template) {
      throw new PayMongoError('Allocation not found', 404, 'ALLOCATION_NOT_FOUND');
    }
    try {
      return this.moveAllocation(allocationId, event);
    } catch (error) {
      return invalidAllocationState(error);
    }
  }

  async earnings(environment: Environment, payeeId: string, now: Date) {
    const allocations = [...this.allocations.values()].filter((entry) => entry.environment === environment
      && entry.payeeId === payeeId && !entry.template);
    const sum = (status: AllocationStatus) => allocations.filter((entry) => entry.status === status)
      .reduce((total, entry) => total + entry.amount, 0);
    const adjustments = [...this.adjustments.values()].filter((entry) => entry.payeeId === payeeId && entry.payoutId === null)
      .reduce((total, entry) => total + entry.amount, 0);
    const payouts = [...this.payouts.values()].filter((payout) => payout.environment === environment && payout.payeeId === payeeId);
    const weekStart = manilaWeekStart(now).getTime();
    return {
      awaitingPayment: sum('awaiting_payment'),
      held: sum('held'),
      available: sum('released') + adjustments,
      inFlight: payouts.filter((payout) => IN_FLIGHT.includes(payout.status)).reduce((total, payout) => total + payout.net, 0),
      paidThisWeek: payouts.filter((payout) => payout.status === 'paid' && Date.parse(payout.createdAt) >= weekStart)
        .reduce((total, payout) => total + payout.net, 0),
    };
  }

  async listPayouts(environment: Environment, projectId: string, query: PageQuery & { payeeId?: string; status?: PayoutStatus }) {
    return pageOf([...this.payouts.values()].filter((payout) => payout.environment === environment && payout.projectId === projectId
      && (!query.payeeId || payout.payeeId === query.payeeId) && (!query.status || payout.status === query.status))
      .map(publicPayout), query);
  }

  async getPayout(environment: Environment, projectId: string, payoutId: string) {
    const payout = this.payouts.get(payoutId);
    return payout && payout.environment === environment && payout.projectId === projectId ? publicPayout(payout) : null;
  }

  /** Changes one allocation's status through the ledger's transition table. */
  moveAllocation(id: string, event: AllocationEvent, payoutId?: string | null): AllocationRecord {
    const allocation = this.allocations.get(id);
    if (!allocation) throw new PayMongoError('Allocation not found', 404, 'ALLOCATION_NOT_FOUND');
    allocation.status = transitionAllocation(allocation.status, event);
    if (payoutId !== undefined) allocation.payoutId = payoutId;
    return publicAllocation(allocation);
  }

  private requirePayout(environment: Environment, payoutId: string): MemoryPayout {
    const payout = this.payouts.get(payoutId);
    if (!payout || payout.environment !== environment) throw new PayMongoError('Payout not found', 404, 'PAYOUT_NOT_FOUND');
    return payout;
  }
}

export const DESTINATION_HOLD_MS = 24 * 60 * 60 * 1000;

export function sameDestination(left: PayoutDestination | null, right: PayoutDestination | null): boolean {
  return JSON.stringify(normalizeDestination(left)) === JSON.stringify(normalizeDestination(right));
}

function normalizeDestination(destination: PayoutDestination | null) {
  if (!destination) return null;
  return destination.type === 'instapay'
    ? { type: destination.type, bic: destination.bic, accountNumber: destination.accountNumber, accountName: destination.accountName }
    : { type: destination.type, accountNumber: destination.accountNumber, accountName: destination.accountName };
}

function publicPayee(payee: MemoryPayee): Payee {
  return { id: payee.id, projectId: payee.projectId, externalRef: payee.externalRef, legalName: payee.legalName, status: payee.status,
    destination: payee.destination, destinationHoldUntil: payee.destinationHoldUntil, createdAt: payee.createdAt };
}

function publicAllocation(allocation: MemoryAllocation): AllocationRecord {
  const { environment: _environment, organizationId: _organizationId, consumerServiceId: _consumerServiceId, ...rest } = allocation;
  return { ...rest };
}

function publicPayout(payout: PayoutRecord): PayoutRecord {
  return { id: payout.id, payeeId: payout.payeeId, projectId: payout.projectId, merchantAccountId: payout.merchantAccountId,
    gross: payout.gross, fee: payout.fee, net: payout.net, trigger: payout.trigger, status: payout.status,
    failureCode: payout.failureCode, createdAt: payout.createdAt, updatedAt: payout.updatedAt };
}

// ---------------------------------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------------------------------

const PAYOUT_COLUMNS = `id, payee_id, project_id, merchant_account_id, gross, fee, net, trigger, status, failure_code, created_at, updated_at`;
const PAYEE_COLUMNS = `id, project_id, external_ref, legal_name, status, destination, destination_hold_until, created_at`;
const ALLOCATION_COLUMNS = `id, payee_id, project_id, merchant_account_id, resource_type, resource_id, reference_id, template,
  payment_id, amount, gross_amount, status, payout_id, created_at`;

export class PostgresPayoutStore implements PayoutStore {
  constructor(readonly pool: Pool, private readonly clock: () => Date = () => new Date()) {}

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertPayee(context: PayoutContext, input: { externalRef: string; legalName: string }) {
    const inserted = await this.pool.query(
      `INSERT INTO shared_payment.payees (id, environment, organization_id, project_id, consumer_service_id, external_ref, legal_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (environment, project_id, external_ref) DO NOTHING
       RETURNING ${PAYEE_COLUMNS}`,
      [newId('pye'), context.environment, context.organizationId, context.projectId, context.consumerServiceId,
        input.externalRef, input.legalName],
    );
    if (inserted.rows[0]) return { payee: payeeRow(inserted.rows[0]), created: true };
    const existing = await this.pool.query(
      `SELECT ${PAYEE_COLUMNS} FROM shared_payment.payees WHERE environment = $1 AND project_id = $2 AND external_ref = $3`,
      [context.environment, context.projectId, input.externalRef],
    );
    return { payee: payeeRow(existing.rows[0]), created: false };
  }

  async getPayee(environment: Environment, projectId: string, payeeId: string) {
    const result = await this.pool.query(
      `SELECT ${PAYEE_COLUMNS} FROM shared_payment.payees WHERE environment = $1 AND project_id = $2 AND id = $3`,
      [environment, projectId, payeeId],
    );
    return result.rows[0] ? payeeRow(result.rows[0]) : null;
  }

  async findPayees(environment: Environment, projectId: string, payeeIds: string[]) {
    if (!payeeIds.length) return [];
    const result = await this.pool.query(
      `SELECT ${PAYEE_COLUMNS} FROM shared_payment.payees WHERE environment = $1 AND project_id = $2 AND id = ANY($3::text[])`,
      [environment, projectId, payeeIds]);
    return result.rows.map(payeeRow);
  }

  async holdForPayment(environment: Environment, resource: { type: AllocationRecord['resourceType']; id: string }, paymentId: string,
    client?: PoolClient) {
    const work = async (target: PoolClient) => {
      const result = resource.type === 'payment_link'
        ? await target.query(
          `INSERT INTO shared_payment.payout_allocations (id, environment, organization_id, project_id, consumer_service_id,
             merchant_account_id, payee_id, resource_type, resource_id, reference_id, template, payment_id, amount, gross_amount, status)
           SELECT 'pal_' || encode(gen_random_bytes(12), 'hex'), environment, organization_id, project_id, consumer_service_id,
                  merchant_account_id, payee_id, resource_type, resource_id, reference_id, false, $3, amount, gross_amount, 'held'
             FROM shared_payment.payout_allocations
            WHERE environment = $1 AND resource_type = 'payment_link' AND resource_id = $2 AND template
           ON CONFLICT DO NOTHING
           RETURNING ${ALLOCATION_COLUMNS}, organization_id, consumer_service_id`,
          [environment, resource.id, paymentId])
        : await target.query(
          `UPDATE shared_payment.payout_allocations SET status = 'held', payment_id = $3, updated_at = now()
            WHERE environment = $1 AND resource_type = $4 AND resource_id = $2 AND status = 'awaiting_payment'
              AND payment_id IS NULL AND NOT template
           RETURNING ${ALLOCATION_COLUMNS}, organization_id, consumer_service_id`,
          [environment, resource.id, paymentId, resource.type]);
      const now = this.clock().toISOString();
      const held = result.rows.map(allocationRow);
      for (const [index, allocation] of held.entries()) {
        await insertOutbox(target, environment, heldEvent(allocation, {
          organizationId: result.rows[index].organization_id, consumerServiceId: result.rows[index].consumer_service_id }, now));
      }
      return held;
    };
    return client ? work(client) : this.transaction(work);
  }

  async applyRefund(environment: Environment, refund: RefundFact, client?: PoolClient) {
    const work = async (target: PoolClient) => {
      const allocations = await target.query(
        `SELECT ${ALLOCATION_COLUMNS} FROM shared_payment.payout_allocations
          WHERE environment = $1 AND payment_id = $2 AND NOT template FOR UPDATE`, [environment, refund.paymentId]);
      for (const allocation of allocations.rows.map(allocationRow)) {
        const action = refundAction(allocation, refund.refunded);
        if (action.kind === 'cancel') {
          await target.query(`UPDATE shared_payment.payout_allocations SET status = $2, updated_at = now() WHERE id = $1`,
            [allocation.id, transitionAllocation(allocation.status, 'cancel')]);
        } else if (action.kind === 'clawback') {
          await target.query(
            `INSERT INTO shared_payment.payee_adjustments (id, environment, project_id, merchant_account_id, payee_id, amount, reason,
               source_allocation_id, source_refund_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'clawback', $7, $8)
             ON CONFLICT DO NOTHING`,
            [newId('padj'), environment, allocation.projectId, allocation.merchantAccountId, allocation.payeeId, -action.amount,
              allocation.id, refund.refundId]);
        }
      }
    };
    return client ? work(client) : this.transaction(work);
  }

  async setPayeeDestination(environment: Environment, projectId: string, payeeId: string, destination: PayoutDestination, now: Date) {
    return this.transaction(async (client) => {
      const current = await client.query(
        `SELECT ${PAYEE_COLUMNS} FROM shared_payment.payees WHERE environment = $1 AND project_id = $2 AND id = $3 FOR UPDATE`,
        [environment, projectId, payeeId],
      );
      if (!current.rows[0]) return null;
      if (sameDestination(current.rows[0].destination, destination)) return payeeRow(current.rows[0]);
      const updated = await client.query(
        `UPDATE shared_payment.payees SET destination = $2::jsonb, destination_hold_until = $3, updated_at = now()
         WHERE id = $1 RETURNING ${PAYEE_COLUMNS}`,
        [payeeId, JSON.stringify(normalizeDestination(destination)), new Date(now.getTime() + DESTINATION_HOLD_MS)],
      );
      return payeeRow(updated.rows[0]);
    });
  }

  async insertAllocations(context: PayoutContext, rows: NewAllocation[], client?: PoolClient) {
    const target = client ?? this.pool;
    const created: AllocationRecord[] = [];
    for (const row of rows) {
      const result = await target.query(
        `INSERT INTO shared_payment.payout_allocations (id, environment, organization_id, project_id, consumer_service_id,
           merchant_account_id, payee_id, resource_type, resource_id, reference_id, template, payment_id, amount, gross_amount,
           status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16::timestamptz, now()))
         ON CONFLICT DO NOTHING
         RETURNING ${ALLOCATION_COLUMNS}`,
        [newId('pal'), context.environment, context.organizationId, context.projectId, context.consumerServiceId,
          row.merchantAccountId, row.payeeId, row.resourceType, row.resourceId, row.referenceId, row.template, row.paymentId,
          row.amount, row.grossAmount, row.status, row.createdAt ?? null],
      );
      if (result.rows[0]) created.push(allocationRow(result.rows[0]));
    }
    return created;
  }

  async getSettings(environment: Environment, projectId: string) {
    const result = await this.pool.query(
      `SELECT * FROM shared_payment.project_payout_settings WHERE environment = $1 AND project_id = $2`, [environment, projectId]);
    const row = result.rows[0];
    if (!row) return DEFAULT_PAYOUT_POLICY;
    return {
      schedule: row.schedule_weekday === null ? null : { weekday: row.schedule_weekday, hour: row.schedule_hour },
      immediate: row.immediate,
      thresholdCentavos: row.threshold_centavos === null ? null : Number(row.threshold_centavos),
      onDemand: row.on_demand_minimum === null ? null
        : { minimum: Number(row.on_demand_minimum), dailyCap: Number(row.on_demand_daily_cap) },
      feeBearer: { scheduled: row.scheduled_fee_bearer, cashOut: row.cash_out_fee_bearer },
      minimumPayout: Number(row.minimum_payout),
      transferFee: Number(row.transfer_fee),
    } satisfies PayoutPolicy;
  }

  async poolSummaries(environment: Environment, merchantAccountId: string, payeeId?: string) {
    const result = await this.pool.query(
      `SELECT p.id AS payee_id, p.project_id, p.destination IS NOT NULL AS has_destination, p.destination_hold_until,
              released.total + COALESCE(adjusted.total, 0) AS available, scheduled.last_at
         FROM (SELECT payee_id, sum(amount) AS total FROM shared_payment.payout_allocations
                WHERE environment = $1 AND merchant_account_id = $2 AND status = 'released' AND ($3::text IS NULL OR payee_id = $3)
                GROUP BY payee_id) released
         JOIN shared_payment.payees p ON p.id = released.payee_id AND p.status = 'active'
         LEFT JOIN (SELECT payee_id, sum(amount) AS total FROM shared_payment.payee_adjustments
                     WHERE environment = $1 AND merchant_account_id = $2 AND payout_id IS NULL GROUP BY payee_id) adjusted
           ON adjusted.payee_id = p.id
         LEFT JOIN (SELECT payee_id, max(created_at) AS last_at FROM shared_payment.payouts
                     WHERE environment = $1 AND trigger = 'schedule' AND status <> 'failed' GROUP BY payee_id) scheduled
           ON scheduled.payee_id = p.id`,
      [environment, merchantAccountId, payeeId ?? null],
    );
    return result.rows.map((row) => ({
      payeeId: row.payee_id,
      projectId: row.project_id,
      available: Number(row.available),
      hasDestination: row.has_destination,
      destinationHoldUntil: row.destination_hold_until ? new Date(row.destination_hold_until).toISOString() : null,
      lastScheduledPayoutAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    }));
  }

  async cashedOutToday(environment: Environment, payeeId: string, now: Date) {
    const { start, end } = manilaDay(now);
    const result = await this.pool.query(
      `SELECT COALESCE(sum(gross), 0) AS total FROM shared_payment.payouts
        WHERE environment = $1 AND payee_id = $2 AND trigger = 'cash_out' AND status <> 'failed'
          AND created_at >= $3 AND created_at < $4`,
      [environment, payeeId, start, end],
    );
    return Number(result.rows[0].total);
  }

  async createPayout(environment: Environment, input: { payeeId: string; merchantAccountId: string; trigger: PayoutTrigger['kind']; compose: ComposeFn }) {
    return this.transaction(async (client) => {
      // Serialize pooling per payee: a concurrent run waits here, then finds the allocations already pooled.
      const payee = await client.query(
        `SELECT id, organization_id, project_id, consumer_service_id, destination FROM shared_payment.payees
          WHERE environment = $1 AND id = $2 FOR UPDATE`, [environment, input.payeeId]);
      if (!payee.rows[0]) return { skipped: 'payee_not_found' };
      if (!payee.rows[0].destination) return { skipped: 'no_destination' };
      const allocations = await client.query(
        `SELECT id, amount, created_at FROM shared_payment.payout_allocations
          WHERE environment = $1 AND payee_id = $2 AND merchant_account_id = $3 AND status = 'released' FOR UPDATE`,
        [environment, input.payeeId, input.merchantAccountId]);
      if (!allocations.rows.length) return { skipped: 'nothing_released' };
      const adjustments = await client.query(
        `SELECT id, amount, created_at FROM shared_payment.payee_adjustments
          WHERE environment = $1 AND payee_id = $2 AND merchant_account_id = $3 AND payout_id IS NULL FOR UPDATE`,
        [environment, input.payeeId, input.merchantAccountId]);
      const composed = input.compose({ allocations: allocations.rows.map(entryRow), adjustments: adjustments.rows.map(entryRow) });
      if ('skip' in composed) return { skipped: composed.skip };
      const owner = payee.rows[0];
      const created = await client.query(
        `INSERT INTO shared_payment.payouts (id, environment, organization_id, project_id, consumer_service_id, merchant_account_id,
           payee_id, gross, fee, net, trigger, status, destination)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', $12::jsonb) RETURNING ${PAYOUT_COLUMNS}`,
        [newId('po'), environment, owner.organization_id, owner.project_id, owner.consumer_service_id, input.merchantAccountId,
          input.payeeId, composed.gross, composed.fee, composed.net, input.trigger, JSON.stringify(owner.destination)]);
      const payout = payoutRow(created.rows[0]);
      await client.query(
        `UPDATE shared_payment.payout_allocations SET status = 'pooled', payout_id = $2, updated_at = now()
          WHERE id = ANY($1::text[]) AND status = 'released'`, [composed.allocationIds, payout.id]);
      if (composed.adjustmentIds.length) {
        await client.query(`UPDATE shared_payment.payee_adjustments SET payout_id = $2, updated_at = now() WHERE id = ANY($1::text[])`,
          [composed.adjustmentIds, payout.id]);
      }
      return payout;
    });
  }

  async beginAttempt(environment: Environment, payoutId: string) {
    return this.transaction(async (client) => {
      const payout = await this.lockPayout(client, environment, payoutId);
      const next = transitionPayout(payout.status, 'submit');
      await client.query(`UPDATE shared_payment.payouts SET status = $2, updated_at = now() WHERE id = $1`, [payoutId, next]);
      const attempt = { referenceNumber: referenceNumberFor(payoutId), callbackToken: randomBytes(32).toString('base64url') };
      await client.query(
        `INSERT INTO shared_payment.payout_transfer_attempts (id, environment, payout_id, reference_number, callback_token, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newId('pta'), environment, payoutId, attempt.referenceNumber, attempt.callbackToken, this.clock()]);
      return attempt;
    });
  }

  async recordOutcome(environment: Environment, payoutId: string, event: PayoutEvent, detail: OutcomeDetail = {}) {
    return this.transaction(async (client) => {
      const current = await this.lockPayout(client, environment, payoutId);
      const next = transitionPayout(current.status, event);
      await client.query(
        `UPDATE shared_payment.payout_transfer_attempts
            SET provider_transfer_id = COALESCE($2, provider_transfer_id),
                provider_status = CASE WHEN $6 THEN 'failed' ELSE COALESCE($3, provider_status) END,
                fee = COALESCE($4, fee), failure_code = COALESCE($5, failure_code), last_checked_at = now(), updated_at = now()
          WHERE payout_id = $1 AND provider_status IS DISTINCT FROM 'failed'`,
        [payoutId, detail.transferId ?? null, detail.providerStatus ?? null, detail.fee ?? null, detail.failureCode ?? null, next === 'failed']);
      const updated = await client.query(
        `UPDATE shared_payment.payouts SET status = $2, failure_code = COALESCE($3, failure_code),
                resolution_note = COALESCE($4, resolution_note), resolved_by = COALESCE($5, resolved_by), updated_at = now()
          WHERE id = $1 RETURNING ${PAYOUT_COLUMNS}, organization_id, consumer_service_id`,
        [payoutId, next, detail.failureCode ?? null, detail.note ?? null, detail.actor ?? null]);
      const payout = payoutRow(updated.rows[0]);
      if (next === 'paid' || next === 'failed') {
        const target = transitionAllocation('pooled', next === 'paid' ? 'payout_paid' : 'payout_failed');
        await client.query(
          `UPDATE shared_payment.payout_allocations SET status = $2, payout_id = CASE WHEN $2 = 'released' THEN NULL ELSE payout_id END,
                  updated_at = now()
            WHERE payout_id = $1 AND status = 'pooled'`, [payoutId, target]);
        if (next === 'failed') {
          await client.query(`UPDATE shared_payment.payee_adjustments SET payout_id = NULL, updated_at = now() WHERE payout_id = $1`, [payoutId]);
        }
        const payee = await client.query(`SELECT external_ref FROM shared_payment.payees WHERE id = $1`, [payout.payeeId]);
        await insertOutbox(client, environment, payoutEvent(payout, { externalRef: payee.rows[0].external_ref },
          { organizationId: updated.rows[0].organization_id, consumerServiceId: updated.rows[0].consumer_service_id },
          next, payout.failureCode, this.clock().toISOString()));
      }
      return payout;
    });
  }

  async openAttempts(environment: Environment, now: Date) {
    const result = await this.pool.query(
      `SELECT p.id, p.merchant_account_id, p.status, a.reference_number, a.provider_transfer_id, a.submitted_at
         FROM shared_payment.payouts p
         JOIN shared_payment.payout_transfer_attempts a ON a.payout_id = p.id AND a.provider_status IS DISTINCT FROM 'failed'
        WHERE p.environment = $1
          AND (p.status IN ('pending', 'unknown') OR (p.status = 'submitting' AND a.submitted_at <= $2))
        ORDER BY a.submitted_at`,
      [environment, new Date(now.getTime() - SUBMITTING_GRACE_MS)]);
    return result.rows.map((row) => ({
      payoutId: row.id, merchantAccountId: row.merchant_account_id, referenceNumber: row.reference_number,
      transferId: row.provider_transfer_id, status: row.status, submittedAt: new Date(row.submitted_at).toISOString(),
    }));
  }

  async attemptByCallbackToken(token: string) {
    const result = await this.pool.query(
      `SELECT environment, payout_id FROM shared_payment.payout_transfer_attempts WHERE callback_token = $1`, [token]);
    return result.rows[0] ? { environment: result.rows[0].environment, payoutId: result.rows[0].payout_id } : null;
  }

  async listPayees(environment: Environment, projectId: string, query: PageQuery) {
    const after = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const result = await this.pool.query(
      `SELECT ${PAYEE_COLUMNS} FROM shared_payment.payees
        WHERE environment = $1 AND project_id = $2 AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::text))
        ORDER BY created_at DESC, id DESC LIMIT $5`,
      [environment, projectId, after?.createdAt ?? null, after?.id ?? null, limit + 1]);
    return paged(result.rows.map(payeeRow), limit);
  }

  async changeAllocation(environment: Environment, projectId: string, allocationId: string, event: 'release' | 'cancel') {
    return this.transaction(async (client) => {
      const current = await client.query(
        `SELECT status FROM shared_payment.payout_allocations
          WHERE environment = $1 AND project_id = $2 AND id = $3 AND NOT template FOR UPDATE`, [environment, projectId, allocationId]);
      if (!current.rows[0]) throw new PayMongoError('Allocation not found', 404, 'ALLOCATION_NOT_FOUND');
      let next: AllocationStatus;
      try {
        next = transitionAllocation(current.rows[0].status, event);
      } catch (error) {
        return invalidAllocationState(error);
      }
      const updated = await client.query(
        `UPDATE shared_payment.payout_allocations SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${ALLOCATION_COLUMNS}`,
        [allocationId, next]);
      return allocationRow(updated.rows[0]);
    });
  }

  async earnings(environment: Environment, payeeId: string, now: Date) {
    const result = await this.pool.query(
      `SELECT
         (SELECT COALESCE(sum(amount) FILTER (WHERE status = 'awaiting_payment'), 0) FROM shared_payment.payout_allocations
           WHERE environment = $1 AND payee_id = $2 AND NOT template) AS awaiting,
         (SELECT COALESCE(sum(amount) FILTER (WHERE status = 'held'), 0) FROM shared_payment.payout_allocations
           WHERE environment = $1 AND payee_id = $2 AND NOT template) AS held,
         (SELECT COALESCE(sum(amount) FILTER (WHERE status = 'released'), 0) FROM shared_payment.payout_allocations
           WHERE environment = $1 AND payee_id = $2 AND NOT template)
           + (SELECT COALESCE(sum(amount), 0) FROM shared_payment.payee_adjustments
               WHERE environment = $1 AND payee_id = $2 AND payout_id IS NULL) AS available,
         (SELECT COALESCE(sum(net), 0) FROM shared_payment.payouts
           WHERE environment = $1 AND payee_id = $2 AND status = ANY($3::text[])) AS in_flight,
         (SELECT COALESCE(sum(net), 0) FROM shared_payment.payouts
           WHERE environment = $1 AND payee_id = $2 AND status = 'paid' AND created_at >= $4) AS paid_week`,
      [environment, payeeId, IN_FLIGHT, manilaWeekStart(now)]);
    const row = result.rows[0];
    return { awaitingPayment: Number(row.awaiting), held: Number(row.held), available: Number(row.available),
      inFlight: Number(row.in_flight), paidThisWeek: Number(row.paid_week) };
  }

  async listPayouts(environment: Environment, projectId: string, query: PageQuery & { payeeId?: string; status?: PayoutStatus }) {
    const after = decodeCursor(query.cursor);
    const limit = pageLimit(query.limit);
    const result = await this.pool.query(
      `SELECT ${PAYOUT_COLUMNS} FROM shared_payment.payouts
        WHERE environment = $1 AND project_id = $2 AND ($3::text IS NULL OR payee_id = $3) AND ($4::text IS NULL OR status = $4)
          AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::text))
        ORDER BY created_at DESC, id DESC LIMIT $7`,
      [environment, projectId, query.payeeId ?? null, query.status ?? null, after?.createdAt ?? null, after?.id ?? null, limit + 1]);
    return paged(result.rows.map(payoutRow), limit);
  }

  async getPayout(environment: Environment, projectId: string, payoutId: string) {
    const result = await this.pool.query(
      `SELECT ${PAYOUT_COLUMNS} FROM shared_payment.payouts WHERE environment = $1 AND project_id = $2 AND id = $3`,
      [environment, projectId, payoutId]);
    return result.rows[0] ? payoutRow(result.rows[0]) : null;
  }

  private async lockPayout(client: PoolClient, environment: Environment, payoutId: string): Promise<{ status: PayoutStatus }> {
    const result = await client.query(
      `SELECT status FROM shared_payment.payouts WHERE environment = $1 AND id = $2 FOR UPDATE`, [environment, payoutId]);
    if (!result.rows[0]) throw new PayMongoError('Payout not found', 404, 'PAYOUT_NOT_FOUND');
    return result.rows[0];
  }
}

/** Queues a payout-feature event in the payment event outbox, keyed so each event is queued once. */
export async function insertOutbox(client: Pick<PoolClient, 'query'>, environment: Environment, event: PayoutStoreEvent): Promise<void> {
  await client.query(
    `INSERT INTO shared_payment.payment_event_outbox
       (environment, provider, provider_event_id, event_type, aggregate_type, aggregate_id, aggregate_version, payload,
        owner_tribe_id, project_id, consumer_service_id, reference_id)
     VALUES ($1, 'apicenter', $2, $3, $4, $5, 1, $6::jsonb, $7, $8, $9, $10)
     ON CONFLICT (environment, provider, provider_event_id) DO NOTHING`,
    [environment, `${event.eventType}:${event.aggregateId}`, event.eventType, event.aggregateType, event.aggregateId,
      JSON.stringify({ ...event.payload, referenceId: event.referenceId, ownerTribeId: event.organizationId,
        ownerProjectId: event.projectId, consumerServiceId: event.consumerServiceId }),
      event.organizationId, event.projectId, event.consumerServiceId, event.referenceId],
  );
}

function entryRow(row: { id: string; amount: string | number; created_at: Date | string }): PoolEntry {
  return { id: row.id, amount: Number(row.amount), createdAt: new Date(row.created_at).toISOString() };
}

export function payeeRow(row: any): Payee {
  return {
    id: row.id, projectId: row.project_id, externalRef: row.external_ref, legalName: row.legal_name, status: row.status,
    destination: row.destination ?? null,
    destinationHoldUntil: row.destination_hold_until ? new Date(row.destination_hold_until).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function allocationRow(row: any): AllocationRecord {
  return {
    id: row.id, payeeId: row.payee_id, projectId: row.project_id, merchantAccountId: row.merchant_account_id,
    resourceType: row.resource_type, resourceId: row.resource_id, referenceId: row.reference_id, template: row.template,
    paymentId: row.payment_id, amount: Number(row.amount), grossAmount: Number(row.gross_amount), status: row.status,
    payoutId: row.payout_id, createdAt: new Date(row.created_at).toISOString(),
  };
}

export function payoutRow(row: any): PayoutRecord {
  return {
    id: row.id, payeeId: row.payee_id, projectId: row.project_id, merchantAccountId: row.merchant_account_id,
    gross: Number(row.gross), fee: Number(row.fee), net: Number(row.net), trigger: row.trigger, status: row.status,
    failureCode: row.failure_code ?? null, createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function createPayoutStore(pool?: Pool, clock?: () => Date): PayoutStore {
  return pool ? new PostgresPayoutStore(pool, clock) : new MemoryPayoutStore(clock);
}
