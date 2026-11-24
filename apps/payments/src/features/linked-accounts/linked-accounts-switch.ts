import type { Pool } from 'pg';
import { PayMongoError } from '../../shared/payment-errors';
import type { Environment } from '../payouts/payout-store';

export interface LinkedAccountsSwitch {
  environmentEnabled(): boolean;
  projectEnabled(environment: Environment, projectId: string): Promise<boolean>;
  enabledFor(environment: Environment, projectId: string): Promise<boolean>;
  assertEnabledFor(environment: Environment, projectId: string): Promise<void>;
  setProject(environment: Environment, projectId: string, enabled: boolean, actor: string): Promise<void>;
}

export function createLinkedAccountsSwitch(pool?: Pick<Pool, 'query'>): LinkedAccountsSwitch {
  const memory = new Map<string, boolean>();
  const environmentEnabled = () => process.env.LINKED_ACCOUNTS_ENABLED === 'true';
  const projectEnabled = async (environment: Environment, projectId: string) => {
    if (!pool) return memory.get(`${environment}:${projectId}`) ?? false;
    const result = await pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM shared_payment.project_linked_account_settings WHERE environment = $1 AND project_id = $2`,
      [environment, projectId],
    );
    return result.rows[0]?.enabled ?? false;
  };
  const enabledFor = async (environment: Environment, projectId: string) =>
    environmentEnabled() && await projectEnabled(environment, projectId);
  return {
    environmentEnabled, projectEnabled, enabledFor,
    async assertEnabledFor(environment, projectId) {
      if (!await enabledFor(environment, projectId)) {
        throw new PayMongoError('Linked accounts are disabled for this project environment', 503, 'LINKED_ACCOUNTS_DISABLED');
      }
    },
    async setProject(environment, projectId, enabled, actor) {
      if (!pool) {
        memory.set(`${environment}:${projectId}`, enabled);
        return;
      }
      await pool.query(
        `INSERT INTO shared_payment.project_linked_account_settings (environment, project_id, enabled, updated_by)
        VALUES ($1, $2, $3, $4) ON CONFLICT (environment, project_id)
        DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [environment, projectId, enabled, actor],
      );
    },
  };
}
