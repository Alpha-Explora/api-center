import { z } from 'zod';
import type { LifecycleEvent, ProviderAccountId } from './linked-account-lifecycle';

export const SANDBOX_MERCHANT_ID = 'org_test_merchant';

export function isProviderAccountId(value: unknown): value is ProviderAccountId {
  return typeof value === 'string' && (value === SANDBOX_MERCHANT_ID || /^org_[A-Za-z0-9]+$/.test(value));
}

export type AccountEvent = {
  providerEventId: string;
  providerAccountId: ProviderAccountId;
  event: LifecycleEvent;
  sessionId?: string;
};

const webhook = z.object({ data: z.object({
  id: z.string().min(1).max(200),
  attributes: z.object({ type: z.string(), data: z.looseObject({
    id: z.string().optional(),
    account_id: z.string().optional(),
    merchant_id: z.string().optional(),
  }) }),
}) });
const walletDetails = z.object({
  account: z.object({ legal_name: z.string().trim().min(1).max(200) }),
  wallet: z.object({ account_number: z.string().regex(/^\d{6,20}$/), status: z.literal('activated') }),
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
  if (!isProviderAccountId(data.merchant_id)) return null;
  if (type === 'merchant.declined') {
    return { providerEventId, providerAccountId: data.merchant_id,
      event: { type: 'declined', reason: 'PayMongo declined this merchant account' } };
  }
  if (type === 'merchant.activated') {
    const details = walletDetails.safeParse(data);
    const wallet = details.success ? { number: details.data.wallet.account_number, name: details.data.account.legal_name } : null;
    return { providerEventId, providerAccountId: data.merchant_id, event: { type: 'activated', wallet } };
  }
  return null;
}
