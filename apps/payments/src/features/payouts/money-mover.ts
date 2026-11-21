// The port through which payouts move money. The executor only sees outcomes: accepted, rejected
// (nothing was sent) or unknown (it may have been sent). Adapters: PayMongo batch transfers, and a mock.

import type { Centavos } from './payout-ledger';
import type { MerchantAccount } from './merchant-accounts';

/** PayMongo's own institution code, used for a wallet as the source or a wallet-to-wallet destination. */
export const PAYMONGO_BIC = 'PAEYPHM2XXX';

export type PayoutDestination =
  | { type: 'instapay'; bic: string; accountNumber: string; accountName: string }
  | { type: 'provider_wallet'; accountNumber: string; accountName: string };

export type TransferRequest = {
  account: MerchantAccount;
  referenceNumber: string;
  amount: Centavos;
  destination: PayoutDestination;
  metadata: Record<string, string>;
  callbackUrl?: string;
};

export type SubmitResult =
  | { kind: 'accepted'; transferId: string; status: 'pending' | 'succeeded' | 'failed'; fee: Centavos | null }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'unknown'; reason: string };

export type LookupResult =
  | { found: false }
  | { found: true; transferId: string; status: 'pending' | 'succeeded' | 'failed'; fee: Centavos | null; failureCode: string | null };

export interface MoneyMover {
  submit(request: TransferRequest): Promise<SubmitResult>;
  lookup(account: MerchantAccount, key: { transferId: string } | { referenceNumber: string; since: Date }): Promise<LookupResult>;
  availableBalance(account: MerchantAccount): Promise<Centavos>;
}
