import { z } from 'zod';
import { paymongoRequest } from '../../shared/paymongo-client';
import type { PaymentContext } from '../../shared/payment-owner-store';
import type { WalletAccount } from '../payouts/merchant-accounts';
import type { ProviderAccountId } from './linked-account-lifecycle';

const wallet = z.object({
  merchant_id: z.string(),
  livemode: z.boolean(),
  status: z.literal('activated'),
  is_default: z.boolean().optional(),
  account: z.object({
    provider: z.literal('paymongo'),
    currency: z.literal('PHP'),
    account_number: z.string().regex(/^\d{6,20}$/),
    account_name: z.string().trim().min(1).max(200),
  }),
});

export async function lookupChildWallet(id: ProviderAccountId, environment: PaymentContext['environment'],
  request = paymongoRequest): Promise<WalletAccount | null> {
  const response = z.object({ data: z.array(z.unknown()), has_more: z.literal(false).optional() }).safeParse(
    await request('/v2/wallets/', { account: { id, kind: 'child' } }),
  );
  if (!response.success) return null;
  const active = response.data.data.flatMap((entry) => {
    const parsed = wallet.safeParse(entry);
    return parsed.success && parsed.data.merchant_id === id && parsed.data.livemode === (environment === 'live') ? [parsed.data] : [];
  });
  const defaults = active.filter((entry) => entry.is_default);
  const selected = defaults.length === 1 ? defaults[0] : active.length === 1 ? active[0] : undefined;
  return selected ? { number: selected.account.account_number, name: selected.account.account_name } : null;
}
