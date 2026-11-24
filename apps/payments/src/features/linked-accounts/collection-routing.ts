import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { PayMongoError } from '../../shared/payment-errors';
import type { OwnerRecord, PaymentContext } from '../../shared/payment-owner-store';
import type { PayMongoAccount } from '../../shared/paymongo-client';
import type { MerchantAccountResolver } from '../payouts/merchant-accounts';

export function createCollectionRouting(accounts: MerchantAccountResolver, pool?: Pick<Pool, 'query'>) {
  const memory = new Map<string, string>();
  return {
    async forCreate(context: PaymentContext, operation: string, idempotencyKey: string | undefined): Promise<PayMongoAccount> {
      const { environment, projectId, consumerServiceId } = context;
      const account = await accounts.resolve(projectId, environment, new Date());
      if (!idempotencyKey) {
        if (account.kind === 'child') {
          throw new PayMongoError('Idempotency-Key is required for linked-account collections', 400, 'IDEMPOTENCY_KEY_REQUIRED');
        }
        return account;
      }
      const key = createHash('sha256').update(JSON.stringify([operation, idempotencyKey])).digest('hex');
      let id: string;
      if (pool) {
        const result = await pool.query<{ merchant_account_id: string }>(
          `INSERT INTO shared_payment.collection_account_routes AS route
            (environment, project_id, application_id, request_key, merchant_account_id)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (environment, project_id, application_id, request_key)
            DO UPDATE SET merchant_account_id = route.merchant_account_id RETURNING merchant_account_id`,
          [environment, projectId, consumerServiceId, key, account.id],
        );
        id = result.rows[0].merchant_account_id;
      } else {
        const scoped = JSON.stringify([environment, projectId, consumerServiceId, key]);
        id = memory.get(scoped) ?? account.id;
        memory.set(scoped, id);
      }
      return id === account.id ? account : accounts.get(id, environment);
    },
    forOwner(owner: OwnerRecord): Promise<PayMongoAccount> {
      return accounts.get(owner.merchantAccountId ?? 'parent', owner.environment);
    },
  };
}
