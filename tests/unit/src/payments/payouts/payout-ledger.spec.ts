import {
  composePayout,
  PayoutStateError,
  refundEffect,
  refundShare,
  transitionAllocation,
  transitionPayout,
} from '../../../../../apps/payments/src/features/payouts/payout-ledger';

describe('allocation transitions', () => {
  it.each([
    ['awaiting_payment', 'payment_confirmed', 'held'], ['awaiting_payment', 'cancel', 'cancelled'],
    ['held', 'release', 'released'], ['held', 'cancel', 'cancelled'],
    ['released', 'pool', 'pooled'], ['released', 'cancel', 'cancelled'],
    ['pooled', 'payout_paid', 'paid'], ['pooled', 'payout_failed', 'released'],
  ])('%s + %s → %s', (from, event, to) => expect(transitionAllocation(from as any, event as any)).toBe(to));

  it.each([['awaiting_payment', 'release'], ['paid', 'cancel'], ['cancelled', 'release'], ['pooled', 'cancel']])(
    'rejects %s + %s', (from, event) => expect(() => transitionAllocation(from as any, event as any)).toThrow(PayoutStateError));
});

describe('payout transitions', () => {
  it.each([
    ['draft', 'submit', 'submitting'], ['submitting', 'accepted', 'pending'], ['submitting', 'rejected', 'failed'],
    ['submitting', 'lost', 'unknown'], ['unknown', 'accepted', 'pending'], ['unknown', 'provider_succeeded', 'paid'],
    ['unknown', 'provider_failed', 'failed'], ['unknown', 'not_found_after_deadline', 'needs_review'],
    ['pending', 'provider_succeeded', 'paid'], ['pending', 'provider_failed', 'failed'],
    ['needs_review', 'operator_paid', 'paid'], ['needs_review', 'operator_failed', 'failed'],
    ['draft', 'abandoned', 'failed'], ['pending', 'stalled', 'needs_review'],
  ])('%s + %s → %s', (from, event, to) => expect(transitionPayout(from as any, event as any)).toBe(to));

  it('never lets an unknown payout be submitted again', () =>
    expect(() => transitionPayout('unknown', 'submit')).toThrow(PayoutStateError));

  it('only needs_review accepts operator outcomes', () =>
    expect(() => transitionPayout('pending', 'operator_paid')).toThrow(PayoutStateError));
});

describe('refunds', () => {
  it('cancels unpaid shares and claws back shares that left', () => {
    expect(['awaiting_payment', 'held', 'released'].map((s) => refundEffect(s as any))).toEqual(['cancel', 'cancel', 'cancel']);
    expect(['pooled', 'paid'].map((s) => refundEffect(s as any))).toEqual(['clawback', 'clawback']);
    expect(refundEffect('cancelled')).toBe('none');
  });

  it('splits a partial refund pro rata, rounding down', () => expect(refundShare(42_500, 50_000, 10_000)).toBe(8_500));

  it('never claws back more than the allocation', () => expect(refundShare(42_500, 50_000, 60_000)).toBe(42_500));
});

describe('composePayout', () => {
  const a = (id: string, amount: number, createdAt = '2026-11-21T00:00:00Z') => ({ id, amount, createdAt });

  it('pools allocations and adjustments, payee bears fee', () =>
    expect(composePayout({ allocations: [a('al1', 42_500), a('al2', 30_000)], adjustments: [a('adj1', -5_000)],
      fee: 1_000, feeBearer: 'payee', minimumPayout: 10_000 }))
      .toEqual({ gross: 72_500, fee: 1_000, net: 66_500, allocationIds: ['al1', 'al2'], adjustmentIds: ['adj1'] }));

  it('platform-borne fee leaves net = gross', () =>
    expect(composePayout({ allocations: [a('al1', 5_000)], adjustments: [], fee: 1_000, feeBearer: 'platform', minimumPayout: 0 }))
      .toMatchObject({ gross: 5_000, net: 5_000 }));

  it('skips a pool whose clawbacks exceed earnings', () =>
    expect(composePayout({ allocations: [a('al1', 3_000)], adjustments: [a('adj1', -5_000)], fee: 1_000, feeBearer: 'payee', minimumPayout: 0 }))
      .toEqual({ skip: 'not_positive' }));

  it('skips below the minimum', () =>
    expect(composePayout({ allocations: [a('al1', 5_000)], adjustments: [], fee: 1_000, feeBearer: 'payee', minimumPayout: 10_000 }))
      .toEqual({ skip: 'below_minimum' }));

  it('takes whole allocations oldest first up to the cap', () =>
    expect(composePayout({ allocations: [a('new', 6_000, '2026-11-21T02:00:00Z'), a('old', 5_000, '2026-11-21T01:00:00Z')],
      adjustments: [], fee: 0, feeBearer: 'platform', minimumPayout: 0, cap: 10_000 }))
      .toMatchObject({ gross: 5_000, allocationIds: ['old'] }));

  it('skips a share that does not fit and still pays the ones that do', () =>
    expect(composePayout({ allocations: [a('big', 6_000_000, '2026-11-21T01:00:00Z'), a('small', 4_000, '2026-11-21T02:00:00Z')],
      adjustments: [], fee: 0, feeBearer: 'platform', minimumPayout: 0, cap: 5_000_000 }))
      .toMatchObject({ gross: 4_000, allocationIds: ['small'] }));

  it('rejects amounts that are not safe integers', () =>
    expect(() => composePayout({ allocations: [a('al1', 1.5)], adjustments: [], fee: 0, feeBearer: 'platform', minimumPayout: 0 }))
      .toThrow(RangeError));
});
