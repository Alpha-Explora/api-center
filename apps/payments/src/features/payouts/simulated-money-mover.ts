// Payouts in the deployed test environment. The payment provider's test mode has no payout wallet, so test payouts
// are simulated: nothing reaches the provider, and every transfer succeeds at once. It is stateless, because test
// runtimes restart and scale: a transfer ID is derived from the payout's reference, so any instance can look it up.

import { createHash } from 'node:crypto';
import type { Centavos } from './payout-ledger';
import type { MerchantAccount, MerchantAccountResolver } from './merchant-accounts';
import type { LookupResult, MoneyMover, SubmitResult, TransferRequest } from './money-mover';

/** The wallet every test merchant account pays from when it has none of its own. */
export const SIMULATED_TEST_WALLET = { number: '000000000000', name: 'APICenter simulated test wallet' } as const;
/** What a simulated wallet always holds: ₱1,000,000. */
export const SIMULATED_BALANCE: Centavos = 100_000_000;
const SIMULATED_FEE: Centavos = 1_000;

function transferId(referenceNumber: string): string {
  return `tr_sim_${createHash('sha256').update(referenceNumber).digest('hex').slice(0, 24)}`;
}

export class SimulatedMoneyMover implements MoneyMover {
  async submit(request: TransferRequest): Promise<SubmitResult> {
    return { kind: 'accepted', transferId: transferId(request.referenceNumber), status: 'succeeded', fee: SIMULATED_FEE };
  }

  async lookup(_account: MerchantAccount, key: { transferId: string } | { referenceNumber: string; since: Date }): Promise<LookupResult> {
    const id = 'transferId' in key ? key.transferId : transferId(key.referenceNumber);
    if (!id.startsWith('tr_sim_')) return { found: false };
    return { found: true, transferId: id, status: 'succeeded', fee: SIMULATED_FEE, failureCode: null };
  }

  async availableBalance(): Promise<Centavos> {
    return SIMULATED_BALANCE;
  }
}

/** Gives test merchant accounts without a wallet the simulated one. Live accounts are returned unchanged. */
export function withSimulatedTestWallet(resolver: MerchantAccountResolver): MerchantAccountResolver {
  const fill = (account: MerchantAccount, environment: 'test' | 'live'): MerchantAccount =>
    environment === 'test' && !account.wallet ? { ...account, wallet: { ...SIMULATED_TEST_WALLET } } : account;
  return {
    resolve: async (projectId, environment, at) => fill(await resolver.resolve(projectId, environment, at), environment),
    get: async (id, environment) => fill(await resolver.get(id, environment), environment),
    ...(resolver.listWithReleasedPools ? {
      listWithReleasedPools: async (environment: 'test' | 'live') =>
        (await resolver.listWithReleasedPools!(environment)).map((account) => fill(account, environment)),
    } : {}),
    ...(resolver.listProjectWallets ? {
      listProjectWallets: async (environment: 'test' | 'live', projectId: string, since: Date) =>
        (await resolver.listProjectWallets!(environment, projectId, since))
          .map((entry) => ({ ...entry, account: fill(entry.account, environment) })),
    } : {}),
  };
}
