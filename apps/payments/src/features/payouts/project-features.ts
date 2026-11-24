import type { Pool } from 'pg';
import { z } from 'zod';
import { PayMongoError } from '../../shared/payment-errors';
import type { Environment } from './payout-store';

export const projectFeature = z.enum(['payouts_sending', 'payee_wallets']);
export type ProjectFeature = z.infer<typeof projectFeature>;
export interface ProjectFeatureSwitches {
  enabled(environment: Environment, projectId: string, feature: ProjectFeature): Promise<boolean>;
  set(environment: Environment, projectId: string, feature: ProjectFeature, enabled: boolean, actor: string): Promise<void>;
}

export function createProjectFeatureSwitches(pool?: Pick<Pool, 'query'>): ProjectFeatureSwitches {
  return {
    async enabled(environment, projectId, feature) {
      const result = await pool?.query<{ enabled: boolean }>(
        'SELECT enabled FROM shared_payment.project_feature_settings WHERE environment = $1 AND project_id = $2 AND feature = $3',
        [environment, projectId, feature],
      );
      return result?.rows[0]?.enabled ?? false;
    },
    async set(environment, projectId, feature, enabled, actor) {
      if (feature === 'payee_wallets' && environment !== 'test') {
        throw new PayMongoError('Payee wallet onboarding is only available in test', 409, 'PAYEE_ONBOARDING_DISABLED');
      }
      if (!pool) throw new PayMongoError('Feature settings require persistent storage', 503, 'PAYMENT_STORAGE_REQUIRED');
      await pool.query(
        `INSERT INTO shared_payment.project_feature_settings (environment, project_id, feature, enabled, updated_by)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (environment, project_id, feature)
        DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [environment, projectId, feature, enabled, actor],
      );
    },
  };
}

export async function sendingEnabled(switches: ProjectFeatureSwitches | undefined, environment: Environment, projectId: string) {
  return environment === 'test' || await switches?.enabled(environment, projectId, 'payouts_sending') === true;
}
