import type { Pool } from 'pg';
import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import type { Environment } from './payout-store';

export const pausableFeature = z.enum(['payouts_sending', 'payee_wallets', 'merchant_account']);
export type PausableFeature = z.infer<typeof pausableFeature>;
export type FeaturePause = { feature: PausableFeature; paused: boolean; reason: string | null; updatedBy: string | null; updatedAt: string | null };
export interface FeaturePauses {
  list(environment: Environment): Promise<FeaturePause[]>;
  isPaused(environment: Environment, feature: PausableFeature): Promise<boolean>;
  set(environment: Environment, feature: PausableFeature, paused: boolean, reason: string, actor: string): Promise<void>;
}

type PauseRow = { feature: PausableFeature; paused: boolean; reason: string; updated_by: string; updated_at: Date };
const pauseCodes = {
  payouts_sending: 'PAYOUTS_PAUSED', payee_wallets: 'PAYEE_ONBOARDING_PAUSED', merchant_account: 'MERCHANT_ACCOUNT_PAUSED',
} as const;

export class FeaturePausedError extends PayMongoError {
  constructor(feature: PausableFeature) {
    super('This payments feature is paused by APICenter', 409, pauseCodes[feature]);
  }
}

export function createFeaturePauses(pool?: Pick<Pool, 'query'>): FeaturePauses {
  return {
    async list(environment) {
      const result = await pool?.query<PauseRow>(
        'SELECT feature, paused, reason, updated_by, updated_at FROM shared_payment.feature_pauses WHERE environment = $1', [environment],
      );
      return pausableFeature.options.map((feature) => {
        const row = result?.rows.find((entry) => entry.feature === feature);
        return { feature, paused: row?.paused ?? false, reason: row?.reason ?? null,
          updatedBy: row?.updated_by ?? null, updatedAt: row?.updated_at.toISOString() ?? null };
      });
    },
    async isPaused(environment, feature) {
      const result = await pool?.query<{ paused: boolean }>(
        'SELECT paused FROM shared_payment.feature_pauses WHERE environment = $1 AND feature = $2', [environment, feature],
      );
      return result?.rows[0]?.paused ?? false;
    },
    async set(environment, feature, paused, reason, actor) {
      if (!pool) throw new PayMongoError('Feature pauses require persistent storage', 503, 'PAYMENT_STORAGE_REQUIRED');
      await pool.query(
        `INSERT INTO shared_payment.feature_pauses (environment, feature, paused, reason, updated_by)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (environment, feature)
        DO UPDATE SET paused = EXCLUDED.paused, reason = EXCLUDED.reason, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [environment, feature, paused, reason, actor],
      );
    },
  };
}
