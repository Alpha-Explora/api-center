import type { PoolClient } from 'pg';
import type { WalletAccount } from '../payouts/merchant-accounts';
import { DESTINATION_HOLD_MS, insertOutbox } from '../payouts/payout-store';
import type { LinkedAccountRecord } from './linked-account-store';

export async function recordConsumerStatus(query: PoolClient, record: LinkedAccountRecord, version: number) {
  const result = await query.query<{ external_ref: string }>(
    `SELECT external_ref FROM shared_payment.payees
      WHERE id = $1 AND environment = $2 AND project_id = $3 AND organization_id = $4`,
    [record.payeeId, record.environment, record.projectId, record.organizationId],
  );
  const referenceId = result.rows[0]?.external_ref;
  if (!referenceId || !record.onboardingApplicationId) return;
  await insertOutbox(query, record.environment, {
    eventType: 'payee.onboarding.updated', aggregateType: 'payee_onboarding', aggregateId: record.id,
    aggregateVersion: version, organizationId: record.organizationId, projectId: record.projectId,
    consumerServiceId: record.onboardingApplicationId, referenceId,
    payload: { payeeId: record.payeeId, onboardingId: record.id, status: record.status, attempts: record.attempts },
  });
}

export async function attachConsumerWallet(query: PoolClient, record: LinkedAccountRecord, wallet: WalletAccount) {
  const destination = { type: 'wallet', accountNumber: wallet.number, accountName: wallet.name };
  await query.query(
    `UPDATE shared_payment.payees AS p SET destination = $5::jsonb,
      destination_hold_until = now() + ($6::int * interval '1 millisecond'),
      linked_wallet_onboarding_id = $7, updated_at = now()
      FROM shared_payment.linked_accounts AS a
      WHERE a.id = $7 AND p.id = $1 AND p.environment = $2 AND p.project_id = $3 AND p.organization_id = $4
        AND p.status = 'active' AND p.destination IS DISTINCT FROM $5::jsonb
        AND (p.destination_hold_until IS NULL OR p.destination_hold_until <= a.created_at + ($6::int * interval '1 millisecond'))
        AND EXISTS (SELECT 1 FROM shared_payment.project_feature_settings s
          WHERE s.environment = p.environment AND s.project_id = p.project_id AND s.feature = 'payee_wallets' AND s.enabled)`,
    [record.payeeId, record.environment, record.projectId, record.organizationId, JSON.stringify(destination),
      DESTINATION_HOLD_MS, record.id],
  );
}

export async function detachConsumerWallet(query: PoolClient, record: LinkedAccountRecord) {
  await query.query(
    `UPDATE shared_payment.payees SET destination = NULL, destination_hold_until = NULL,
      linked_wallet_onboarding_id = NULL, updated_at = now()
      WHERE id = $1 AND environment = $2 AND project_id = $3 AND organization_id = $4
        AND linked_wallet_onboarding_id = $5`,
    [record.payeeId, record.environment, record.projectId, record.organizationId, record.id],
  );
}
