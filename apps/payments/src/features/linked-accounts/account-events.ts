import { z } from 'zod';
import type { LifecycleEvent, ProviderAccountId } from './linked-account-lifecycle';

export const SANDBOX_MERCHANT_ID = 'org_test_merchant';
export const SANDBOX_CONSUMER_ID = 'org_test_consumer';

export function isSandboxAccountId(value: unknown): boolean {
  return value === SANDBOX_MERCHANT_ID || value === SANDBOX_CONSUMER_ID;
}

export function isProviderAccountId(value: unknown): value is ProviderAccountId {
  return typeof value === 'string' && (isSandboxAccountId(value) || /^org_[A-Za-z0-9]+$/.test(value));
}

export type AccountEvent = {
  providerEventId: string;
  providerAccountId: ProviderAccountId;
  event: LifecycleEvent;
  sessionId?: string;
  accountKind?: 'merchant' | 'consumer';
};

const webhook = z.object({ data: z.object({
  id: z.string().min(1).max(200),
  attributes: z.object({ type: z.string(), data: z.looseObject({
    id: z.string().optional(),
    account_id: z.string().optional(),
    merchant_id: z.string().optional(),
    consumer_id: z.string().optional(),
  }) }),
}) });
const walletDetails = z.object({
  account: z.object({ legal_name: z.string().trim().min(1).max(200) }),
  wallet: z.object({ account_number: z.string().regex(/^\d{6,20}$/), status: z.literal('activated') }),
});
const consumerWalletDetails = z.object({
  account: z.object({ first_name: z.string().trim().min(1).max(100), last_name: z.string().trim().min(1).max(99) }),
  wallet: z.object({ account_number: z.string().regex(/^\d{6,20}$/), status: z.literal('activated'),
    type: z.literal('fully_verified_standard') }),
});

export function parseAccountEvent(payload: unknown): AccountEvent | null {
  const parsed = webhook.safeParse(payload);
  if (!parsed.success) return null;
  const { id: providerEventId, attributes: { type, data } } = parsed.data.data;
  if (type === 'account.identity_verification.passed' || type === 'account.identity_verification.failed') {
    if (!isProviderAccountId(data.account_id) || !data.id) return null;
    return { providerEventId, providerAccountId: data.account_id, sessionId: data.id,
      event: type.endsWith('.passed') ? { type: 'verification_passed' }
        : { type: 'verification_failed', reason: 'PayMongo could not verify the representative' } };
  }
  if (type === 'consumer.activated' || type === 'consumer.declined') {
    if (!isProviderAccountId(data.consumer_id)) return null;
    const parsedWallet = consumerWalletDetails.safeParse(data);
    const wallet = parsedWallet.success ? { number: parsedWallet.data.wallet.account_number,
      name: `${parsedWallet.data.account.first_name} ${parsedWallet.data.account.last_name}` } : null;
    return { providerEventId, providerAccountId: data.consumer_id, accountKind: 'consumer',
      event: type === 'consumer.activated' ? { type: 'activated', wallet }
        : { type: 'declined', reason: 'PayMongo declined this consumer account' } };
  }
  if (!isProviderAccountId(data.merchant_id)) return null;
  if (type === 'merchant.declined') {
    return { providerEventId, providerAccountId: data.merchant_id, accountKind: 'merchant',
      event: { type: 'declined', reason: 'PayMongo declined this merchant account' } };
  }
  if (type === 'merchant.activated') {
    const details = walletDetails.safeParse(data);
    const wallet = details.success ? { number: details.data.wallet.account_number, name: details.data.account.legal_name } : null;
    return { providerEventId, providerAccountId: data.merchant_id, accountKind: 'merchant', event: { type: 'activated', wallet } };
  }
  return null;
}
