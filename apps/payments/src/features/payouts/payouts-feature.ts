// Wires the payouts feature once per runtime: the store shares the payment database pool, the money
// mover follows the provider mode, and webhook effects run inside the payment webhook transaction.

import type { OwnerRecord, PaymentOwnerStore } from '../../shared/payment-owner-store';
import type { LinkedAccountsSwitch } from '../linked-accounts/linked-accounts-switch';
import { payoutWebhookEffects } from './allocations';
import { createMerchantAccountResolver } from './merchant-accounts';
import { withSimulatedTestWallet } from './simulated-money-mover';
import { simulatesTestWallets } from '../../shared/paymongo-client';
import { createMoneyMover } from './mock-money-mover';
import type { PayoutDeps } from './payout-executor';
import { createPayoutStore } from './payout-store';
import { createProjectFeatureSwitches, type ProjectFeatureSwitches } from './project-features';
import { createFeaturePauses, type FeaturePauses } from './feature-pauses';

export type PayoutsFeature = PayoutDeps & { projectFeatures: ProjectFeatureSwitches; pauses: FeaturePauses };

function succeededRefund(record: OwnerRecord, paymentId: string) {
  const status = String(record.status ?? record.snapshot.status ?? '').toLowerCase();
  const refunded = Number(record.amountMinor ?? record.snapshot.amount);
  return status === 'succeeded' && Number.isSafeInteger(refunded) && refunded > 0
    ? [{ paymentId, refundId: record.resourceId, refunded }] : [];
}

export function createPayoutsFeature(owners: PaymentOwnerStore, options: {
  now?: () => Date; linkedAccountsSwitch?: LinkedAccountsSwitch;
} = {}): PayoutsFeature {
  const now = options.now ?? (() => new Date());
  const pool = owners.databasePool;
  const store = createPayoutStore(pool, now);
  owners.useWebhookEffects(payoutWebhookEffects(store, async (paymentId, environment) =>
    (await owners.findWebhookRefundsByPaymentId(paymentId, environment)).flatMap((record) => succeededRefund(record, paymentId))));
  const base = process.env.APICENTER_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  const environment = process.env.PAYMENT_PROVIDER_MODE === 'live' ? 'live' : 'test';
  return {
    store,
    accounts: simulatesTestWallets() ? withSimulatedTestWallet(createMerchantAccountResolver(pool, options.linkedAccountsSwitch))
      : createMerchantAccountResolver(pool, options.linkedAccountsSwitch),
    mover: createMoneyMover(),
    now,
    projectFeatures: createProjectFeatureSwitches(pool),
    pauses: createFeaturePauses(pool),
    ...(base ? { callbackUrl: (token: string) => `${base}/api/v1/shared/payment/payout-callbacks/${environment}/${token}` } : {}),
  };
}
