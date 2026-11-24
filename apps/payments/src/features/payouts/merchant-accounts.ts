// Which PayMongo merchant account acts for a project. Today every project resolves to the parent
// account; when PayMongo enables linked accounts, a project moves to its own child account by adding
// a project_merchant_accounts row with an effective time. This module is the only reader of that table.

import type { Pool } from 'pg';
import type { Centavos } from './payout-ledger';
import { createLinkedAccountsSwitch, type LinkedAccountsSwitch } from '../linked-accounts/linked-accounts-switch';

export type WalletAccount = { number: string; name: string };

export type MerchantAccount =
  | { id: 'parent'; kind: 'parent'; wallet: WalletAccount | null; lowFloatAlert: Centavos }
  | { id: `org_${string}`; kind: 'child'; wallet: WalletAccount | null; lowFloatAlert: Centavos };

export interface MerchantAccountResolver {
  resolve(projectId: string, environment: 'test' | 'live', at: Date): Promise<MerchantAccount>;
  get(id: string, environment: 'test' | 'live'): Promise<MerchantAccount>;
  listWithReleasedPools?(environment: 'test' | 'live'): Promise<MerchantAccount[]>;
  listProjectWallets?(environment: 'test' | 'live', projectId: string, since: Date): Promise<Array<{
    account: MerchantAccount;
    collectedCentavos: Centavos;
  }>>;
}

type AccountRow = {
  id: string;
  kind: string;
  wallet_account_number: string | null;
  wallet_account_name: string | null;
  low_float_alert_centavos: string | number;
  status?: 'active' | 'disabled';
};

export function createMerchantAccountResolver(pool?: Pick<Pool, 'query'>,
  switches: Pick<LinkedAccountsSwitch, 'enabledFor'> = createLinkedAccountsSwitch(pool)): MerchantAccountResolver {
  if (!pool) return memoryResolver();
  const read = async (id: string, environment: 'test' | 'live'): Promise<AccountRow> => {
    const result = await pool.query<AccountRow>(
      `SELECT id, kind, wallet_account_number, wallet_account_name, low_float_alert_centavos, status
         FROM shared_payment.merchant_accounts WHERE environment = $1 AND id = $2`,
      [environment, id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Merchant account ${id} is not configured for ${environment}`);
    return row;
  };
  const get = async (id: string, environment: 'test' | 'live') => toAccount(await read(id, environment));
  return {
    get,
    async resolve(projectId, environment, at) {
      if (!await switches.enabledFor(environment, projectId)) return get('parent', environment);
      const mapping = await pool.query<{ merchant_account_id: string }>(
        `SELECT merchant_account_id FROM shared_payment.project_merchant_accounts
          WHERE environment = $1 AND project_id = $2 AND effective_from <= $3
          ORDER BY effective_from DESC LIMIT 1`,
        [environment, projectId, at],
      );
      const row = await read(mapping.rows[0]?.merchant_account_id ?? 'parent', environment);
      return row.status === 'disabled' ? get('parent', environment) : toAccount(row);
    },
    async listWithReleasedPools(environment) {
      const result = await pool.query<AccountRow>(
        `SELECT id, kind, wallet_account_number, wallet_account_name, low_float_alert_centavos
          FROM shared_payment.merchant_accounts a WHERE environment = $1 AND
          (kind = 'parent' OR EXISTS (SELECT 1 FROM shared_payment.payout_allocations p
            WHERE p.environment = a.environment AND p.merchant_account_id = a.id AND p.status = 'released'))
          ORDER BY (kind = 'parent') DESC, id`, [environment],
      );
      return result.rows.map(toAccount);
    },
    async listProjectWallets(environment, projectId, since) {
      const result = await pool.query<AccountRow & { collected: string }>(
        `SELECT a.id, a.kind, a.wallet_account_number, a.wallet_account_name, a.low_float_alert_centavos,
                COALESCE(volume.collected, 0) AS collected
          FROM shared_payment.merchant_accounts a
          LEFT JOIN shared_payment.linked_accounts linked ON linked.environment = a.environment AND linked.id = a.linked_account_id
          LEFT JOIN (SELECT merchant_account_id, sum(amount_minor) AS collected FROM shared_payment.resource_owners
            WHERE environment = $1 AND project_id = $2 AND resource_type = 'payment'
              AND status = 'paid' AND currency = 'PHP' AND created_at >= $3 GROUP BY merchant_account_id) volume
            ON volume.merchant_account_id = a.id
          WHERE a.environment = $1 AND (a.kind = 'parent' OR linked.project_id = $2)
          ORDER BY (a.kind = 'parent') DESC, a.id`, [environment, projectId, since],
      );
      return result.rows.map((row) => ({ account: toAccount(row), collectedCentavos: Number(row.collected) }));
    },
  };
}

function memoryResolver(): MerchantAccountResolver {
  const parent = (): MerchantAccount => {
    const number = process.env.PAYOUT_WALLET_NUMBER;
    const name = process.env.PAYOUT_WALLET_NAME;
    return { id: 'parent', kind: 'parent', wallet: number && name ? { number, name } : null, lowFloatAlert: 0 };
  };
  return {
    async resolve() { return parent(); },
    async listWithReleasedPools() { return [parent()]; },
    async get(id) {
      if (id !== 'parent') throw new Error(`Merchant account ${id} is not configured`);
      return parent();
    },
  };
}

function toAccount(row: AccountRow): MerchantAccount {
  const wallet = row.wallet_account_number && row.wallet_account_name
    ? { number: row.wallet_account_number, name: row.wallet_account_name } : null;
  const lowFloatAlert = Number(row.low_float_alert_centavos);
  if (row.kind === 'parent') return { id: 'parent', kind: 'parent', wallet, lowFloatAlert };
  if (!row.id.startsWith('org_')) throw new Error(`Child merchant account ${row.id} has an invalid id`);
  return { id: row.id as `org_${string}`, kind: 'child', wallet, lowFloatAlert };
}
