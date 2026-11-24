// What the payouts area can do in one project environment right now. The console shows features that are not
// available yet as "coming soon" with this reason, instead of hiding them or failing when they are used.
import type { PausableFeature } from './feature-pauses';
import type { Environment } from './payout-store';

export type FeatureAvailability = {
  available: boolean;
  /** Why the feature is not available yet; null when it is. */
  reason: 'wallet_not_configured' | 'not_enabled' | 'test_only' | 'paused' | 'provider_unavailable' | null;
};

export type PayoutAvailability = {
  /** Sending payouts: scheduled payouts and cash-outs. Payees, shares and earnings work either way. */
  transfers: FeatureAvailability;
  /** A dedicated payment-provider merchant account for the project. */
  linkedAccounts: FeatureAvailability;
  /** Payee wallet onboarding with a hosted identity check. */
  payeeWallets: FeatureAvailability;
};

const AVAILABLE: FeatureAvailability = { available: true, reason: null };

export async function payoutAvailability(input: {
  environment: Environment;
  walletConfigured: boolean;
  transfersEnabled: boolean;
  linkedAccountsEnabled: () => Promise<boolean>;
  payeeWalletsEnabled: boolean;
  /** Whether this runtime can run payee wallet onboarding at all (today: local mock payments only). */
  payeeWalletsSupported?: boolean;
  paused?: ReadonlySet<PausableFeature>;
}): Promise<PayoutAvailability> {
  const paused: FeatureAvailability = { available: false, reason: 'paused' };
  const disabled: FeatureAvailability = { available: false, reason: 'not_enabled' };
  const transfers: FeatureAvailability = input.paused?.has('payouts_sending') ? paused : !input.transfersEnabled
    ? disabled
    : !input.walletConfigured ? { available: false, reason: 'wallet_not_configured' } : AVAILABLE;
  return {
    transfers,
    linkedAccounts: input.paused?.has('merchant_account') ? paused : await input.linkedAccountsEnabled() ? AVAILABLE : disabled,
    payeeWallets: input.environment !== 'test' ? { available: false, reason: 'test_only' }
      : input.paused?.has('payee_wallets') ? paused
        : input.payeeWalletsSupported === false ? { available: false, reason: 'provider_unavailable' }
          : input.payeeWalletsEnabled ? AVAILABLE : disabled,
  };
}
