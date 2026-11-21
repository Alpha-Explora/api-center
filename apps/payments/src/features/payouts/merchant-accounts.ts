// Which PayMongo merchant account acts for a project. Today every project resolves to the parent
// account; when PayMongo enables linked accounts, a project moves to its own child account by adding
// a project_merchant_accounts row with an effective time. This module is the only reader of that table.

import type { Pool } from 'pg';
import type { Centavos } from './payout-ledger';

export type WalletAccount = { number: string; name: string };

export type MerchantAccount =
  | { id: 'parent'; kind: 'parent'; wallet: WalletAccount | null; lowFloatAlert: Centavos }
  | { id: `org_${string}`; kind: 'child'; wallet: WalletAccount | null; lowFloatAlert: Centavos };

export interface MerchantAccountResolver {
  resolve(projectId: string, environment: 'test' | 'live', at: Date): Promise<MerchantAccount>;
  get(id: string, environment: 'test' | 'live'): Promise<MerchantAccount>;
}

type AccountRow = {
  id: string;
  kind: string;
  wallet_account_number: string | null;
  wallet_account_name: string | null;
  low_float_alert_centavos: string | number;
};

export function createMerchantAccountResolver(pool?: Pick<Pool, 'query'>): MerchantAccountResolver {
  if (!pool) return memoryResolver();
  const get = async (id: string, environment: 'test' | 'live'): Promise<MerchantAccount> => {
    const result = await pool.query<AccountRow>(
      `SELECT id, kind, wallet_account_number, wallet_account_name, low_float_alert_centavos
         FROM shared_payment.merchant_accounts WHERE environment = $1 AND id = $2`,
      [environment, id],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Merchant account ${id} is not configured for ${environment}`);
    return toAccount(row);
  };
  return {
    get,
    async resolve(projectId, environment, at) {
      const mapping = await pool.query<{ merchant_account_id: string }>(
        `SELECT merchant_account_id FROM shared_payment.project_merchant_accounts
          WHERE environment = $1 AND project_id = $2 AND effective_from <= $3
          ORDER BY effective_from DESC LIMIT 1`,
        [environment, projectId, at],
      );
      return get(mapping.rows[0]?.merchant_account_id ?? 'parent', environment);
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
