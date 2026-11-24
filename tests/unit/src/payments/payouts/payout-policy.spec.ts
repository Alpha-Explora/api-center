import {
  DEFAULT_PAYOUT_POLICY,
  INSTAPAY_CAP,
  isDue,
  latestScheduledSlot,
  payoutPolicySchema,
  type PayoutPolicy,
  type PoolSummary,
} from '../../../../../apps/payments/src/features/payouts/payout-policy';

const now = new Date('2026-11-27T12:05:00Z'); // Friday 20:05 Manila
const pool = (overrides: Partial<PoolSummary> = {}): PoolSummary => ({
  available: 72_500, destinationHoldUntil: null, hasDestination: true, lastScheduledPayoutAt: null, ...overrides,
});
const policy = (overrides: Partial<PayoutPolicy> = {}): PayoutPolicy => ({ ...DEFAULT_PAYOUT_POLICY, ...overrides });

describe('default policy', () => {
  it('pays weekly on Friday 20:00 Manila with cash-out, platform paying the scheduled fee', () =>
    expect(DEFAULT_PAYOUT_POLICY).toEqual({
      schedule: { weekday: 5, hour: 20 }, immediate: false, thresholdCentavos: null,
      onDemand: { minimum: 10_000, dailyCap: 1_000_000 }, feeBearer: { scheduled: 'platform', cashOut: 'payee' },
      minimumPayout: 0, transferFee: 1_000, settlementHoldDays: 7, requirePayeeVerification: false,
    }));
});

describe('destination checks', () => {
  it('holds payouts until the destination hold ends', () => {
    const holdUntil = '2026-11-27T12:05:00.000Z';
    expect(isDue(pool({ destinationHoldUntil: holdUntil }), policy(), { kind: 'schedule' }, new Date('2026-11-27T12:04:59.999Z')))
      .toEqual({ due: false, reason: 'destination_hold' });
    expect(isDue(pool({ destinationHoldUntil: holdUntil }), policy(), { kind: 'schedule' }, new Date('2026-11-27T12:05:00.001Z')))
      .toMatchObject({ due: true });
  });

  it.each([{ kind: 'schedule' }, { kind: 'release' }, { kind: 'cash_out', cashedOutToday: 0 }] as const)(
    'never pays a payee without a destination (%o)', (trigger) =>
      expect(isDue(pool({ hasDestination: false }), policy({ immediate: true }), trigger, now))
        .toEqual({ due: false, reason: 'no_destination' }));
});

describe('weekly schedule', () => {
  it('finds the most recent slot in Manila time', () => {
    expect(latestScheduledSlot({ weekday: 5, hour: 20 }, new Date('2026-11-27T12:30:00Z'))).toEqual(new Date('2026-11-27T12:00:00Z'));
    expect(latestScheduledSlot({ weekday: 5, hour: 20 }, new Date('2026-11-27T11:59:00Z'))).toEqual(new Date('2026-11-20T12:00:00Z'));
  });

  it('handles a slot that falls on the previous UTC day', () =>
    expect(latestScheduledSlot({ weekday: 1, hour: 2 }, new Date('2026-11-23T00:00:00Z'))).toEqual(new Date('2026-11-22T18:00:00Z')));

  it('is due once per weekly slot', () => {
    expect(isDue(pool(), policy(), { kind: 'schedule' }, now)).toEqual({ due: true, cap: INSTAPAY_CAP, feeBearer: 'platform' });
    expect(isDue(pool({ lastScheduledPayoutAt: '2026-11-20T12:10:00Z' }), policy(), { kind: 'schedule' }, now))
      .toMatchObject({ due: true });
    expect(isDue(pool({ lastScheduledPayoutAt: '2026-11-27T12:00:00Z' }), policy(), { kind: 'schedule' }, now))
      .toEqual({ due: false, reason: 'not_scheduled' });
  });

  it('never pays on schedule when the schedule is off', () =>
    expect(isDue(pool(), policy({ schedule: null }), { kind: 'schedule' }, now)).toEqual({ due: false, reason: 'not_scheduled' }));
});

describe('release trigger', () => {
  it('pays on release when immediate or over the threshold', () => {
    expect(isDue(pool(), policy({ immediate: true }), { kind: 'release' }, now))
      .toEqual({ due: true, cap: INSTAPAY_CAP, feeBearer: 'platform' });
    expect(isDue(pool({ available: 50_000 }), policy({ thresholdCentavos: 50_000 }), { kind: 'release' }, now)).toMatchObject({ due: true });
    expect(isDue(pool({ available: 49_999 }), policy({ thresholdCentavos: 50_000 }), { kind: 'release' }, now))
      .toEqual({ due: false, reason: 'below_threshold' });
    expect(isDue(pool(), policy(), { kind: 'release' }, now)).toEqual({ due: false, reason: 'below_threshold' });
  });
});

describe('cash-out trigger', () => {
  it('requires cash-out to be enabled', () =>
    expect(isDue(pool(), policy({ onDemand: null }), { kind: 'cash_out', cashedOutToday: 0 }, now))
      .toEqual({ due: false, reason: 'on_demand_disabled' }));

  it('requires the minimum', () =>
    expect(isDue(pool({ available: 5_000 }), policy(), { kind: 'cash_out', cashedOutToday: 0 }, now))
      .toEqual({ due: false, reason: 'below_cash_out_minimum' }));

  it('stops at the daily cap', () =>
    expect(isDue(pool(), policy(), { kind: 'cash_out', cashedOutToday: 1_000_000 }, now))
      .toEqual({ due: false, reason: 'daily_cap_reached' }));

  it('caps the cash-out at what is left of the daily cap, payee paying the fee', () =>
    expect(isDue(pool(), policy(), { kind: 'cash_out', cashedOutToday: 400_000 }, now))
      .toEqual({ due: true, cap: 600_000, feeBearer: 'payee' }));
});

describe('policy schema', () => {
  it('accepts the default', () => expect(payoutPolicySchema.parse(DEFAULT_PAYOUT_POLICY)).toEqual(DEFAULT_PAYOUT_POLICY));
  it('rejects an hour past 23', () =>
    expect(payoutPolicySchema.safeParse(policy({ schedule: { weekday: 5, hour: 24 } })).success).toBe(false));
  it('rejects a daily cap below the minimum', () =>
    expect(payoutPolicySchema.safeParse(policy({ onDemand: { minimum: 20_000, dailyCap: 10_000 } })).success).toBe(false));
});
