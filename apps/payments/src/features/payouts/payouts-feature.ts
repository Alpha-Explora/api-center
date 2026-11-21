// Wires the payouts feature once per runtime: the store shares the payment database pool, the money
// mover follows the provider mode, and webhook effects run inside the payment webhook transaction.

import type { PaymentOwnerStore } from '../../shared/payment-owner-store';
import { payoutWebhookEffects } from './allocations';
import { createMerchantAccountResolver } from './merchant-accounts';
import { createMoneyMover } from './mock-money-mover';
import type { PayoutDeps } from './payout-executor';
import { createPayoutStore } from './payout-store';

export type PayoutsFeature = PayoutDeps;

export function createPayoutsFeature(owners: PaymentOwnerStore, options: { now?: () => Date } = {}): PayoutsFeature {
  const now = options.now ?? (() => new Date());
  const pool = owners.databasePool;
  const store = createPayoutStore(pool, now);
  owners.useWebhookEffects(payoutWebhookEffects(store));
  const base = process.env.APICENTER_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  const environment = process.env.PAYMENT_PROVIDER_MODE === 'live' ? 'live' : 'test';
  return {
    store,
    accounts: createMerchantAccountResolver(pool),
    mover: createMoneyMover(),
    now,
    ...(base ? { callbackUrl: (token: string) => `${base}/api/v1/shared/payment/payout-callbacks/${environment}/${token}` } : {}),
  };
}
