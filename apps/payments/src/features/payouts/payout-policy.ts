// When a payee's pool becomes a payout. A project's policy combines a weekly schedule, payouts on
// release (immediate or above a threshold) and on-demand cash-out. Pure: the runner, the routes and
// the console all ask isDue with the same inputs.

import { z } from 'zod';
import type { Centavos } from './payout-ledger';

/** InstaPay's per-transfer limit. A larger pool is paid across runs. */
export const INSTAPAY_CAP = 5_000_000;

// Asia/Manila is UTC+8 and has no daylight saving time.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A weekly slot in Asia/Manila. weekday 0 is Sunday. */
export type WeeklySchedule = { weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number };

export type PayoutPolicy = {
  schedule: WeeklySchedule | null;
  immediate: boolean;
  thresholdCentavos: Centavos | null;
  onDemand: { minimum: Centavos; dailyCap: Centavos } | null;
  feeBearer: { scheduled: 'platform' | 'payee'; cashOut: 'platform' | 'payee' };
  minimumPayout: Centavos;
  transferFee: Centavos;
};

export const DEFAULT_PAYOUT_POLICY: PayoutPolicy = {
  schedule: { weekday: 5, hour: 20 },
  immediate: false,
  thresholdCentavos: null,
  onDemand: { minimum: 10_000, dailyCap: 1_000_000 },
  feeBearer: { scheduled: 'platform', cashOut: 'payee' },
  minimumPayout: 0,
  transferFee: 1_000,
};

const centavos = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const bearer = z.enum(['platform', 'payee']);

export const payoutPolicySchema: z.ZodType<PayoutPolicy> = z.object({
  schedule: z.object({
    weekday: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    hour: z.number().int().min(0).max(23),
  }).nullable(),
  immediate: z.boolean(),
  thresholdCentavos: centavos.nullable(),
  onDemand: z.object({ minimum: centavos, dailyCap: centavos })
    .refine((value) => value.dailyCap >= value.minimum, { message: 'dailyCap must be at least minimum' })
    .nullable(),
  feeBearer: z.object({ scheduled: bearer, cashOut: bearer }),
  minimumPayout: centavos,
  transferFee: centavos,
}).strict();

export type PayoutTrigger = { kind: 'schedule' } | { kind: 'release' } | { kind: 'cash_out'; cashedOutToday: Centavos };

export type PoolSummary = {
  available: Centavos;
  destinationHoldUntil: string | null;
  hasDestination: boolean;
  /** When this payee's latest scheduled payout that did not fail was created. */
  lastScheduledPayoutAt: string | null;
};

export type Due = { due: true; cap: Centavos; feeBearer: 'platform' | 'payee' }
  | { due: false; reason: 'no_destination' | 'destination_hold' | 'not_scheduled' | 'below_threshold'
    | 'on_demand_disabled' | 'below_cash_out_minimum' | 'daily_cap_reached' };

/** The most recent weekly slot at or before `now`. */
export function latestScheduledSlot(schedule: WeeklySchedule, now: Date): Date {
  const manilaNow = now.getTime() + MANILA_OFFSET_MS;
  const manilaMidnight = manilaNow - (manilaNow % DAY_MS);
  const manilaWeekday = new Date(manilaMidnight).getUTCDay();
  const daysBack = (manilaWeekday - schedule.weekday + 7) % 7;
  let slot = manilaMidnight - daysBack * DAY_MS + schedule.hour * 60 * 60 * 1000;
  if (slot > manilaNow) slot -= 7 * DAY_MS;
  return new Date(slot - MANILA_OFFSET_MS);
}

/** The Asia/Manila calendar day containing `now`, as a UTC range. */
export function manilaDay(now: Date): { start: Date; end: Date } {
  const manilaNow = now.getTime() + MANILA_OFFSET_MS;
  const start = manilaNow - (manilaNow % DAY_MS) - MANILA_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

export function isDue(pool: PoolSummary, policy: PayoutPolicy, trigger: PayoutTrigger, now: Date): Due {
  if (!pool.hasDestination) return { due: false, reason: 'no_destination' };
  if (pool.destinationHoldUntil && now.getTime() < Date.parse(pool.destinationHoldUntil)) {
    return { due: false, reason: 'destination_hold' };
  }
  switch (trigger.kind) {
    case 'schedule': {
      if (!policy.schedule) return { due: false, reason: 'not_scheduled' };
      const slot = latestScheduledSlot(policy.schedule, now);
      if (pool.lastScheduledPayoutAt && Date.parse(pool.lastScheduledPayoutAt) >= slot.getTime()) {
        return { due: false, reason: 'not_scheduled' };
      }
      return { due: true, cap: INSTAPAY_CAP, feeBearer: policy.feeBearer.scheduled };
    }
    case 'release': {
      const overThreshold = policy.thresholdCentavos !== null && pool.available >= policy.thresholdCentavos;
      if (!policy.immediate && !overThreshold) return { due: false, reason: 'below_threshold' };
      return { due: true, cap: INSTAPAY_CAP, feeBearer: policy.feeBearer.scheduled };
    }
    case 'cash_out': {
      if (!policy.onDemand) return { due: false, reason: 'on_demand_disabled' };
      if (pool.available < policy.onDemand.minimum) return { due: false, reason: 'below_cash_out_minimum' };
      if (trigger.cashedOutToday >= policy.onDemand.dailyCap) return { due: false, reason: 'daily_cap_reached' };
      return {
        due: true,
        cap: Math.min(policy.onDemand.dailyCap - trigger.cashedOutToday, INSTAPAY_CAP),
        feeBearer: policy.feeBearer.cashOut,
      };
    }
  }
}
