// What the payouts area can do in one project environment right now. The console shows features that are not
// available yet as "coming soon" with this reason, instead of hiding them or failing when they are used.
import { assertLiveEnabled } from './payout-executor';
import type { Environment } from './payout-store';

export type FeatureAvailability = {
  available: boolean;
  /** Why the feature is not available yet; null when it is. */
  reason: 'wallet_not_configured' | 'live_payouts_disabled' | 'not_enabled' | 'test_only' | null;
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

function liveSubmissionsEnabled(environment: Environment): boolean {
  try {
    assertLiveEnabled(environment);
    return true;
  } catch {
    return false;
  }
}

export async function payoutAvailability(input: {
  environment: Environment;
  walletConfigured: boolean;
  linkedAccountsEnabled: () => Promise<boolean>;
  payeeWalletsEnabled: boolean;
}): Promise<PayoutAvailability> {
  const transfers: FeatureAvailability = !liveSubmissionsEnabled(input.environment)
    ? { available: false, reason: 'live_payouts_disabled' }
    : !input.walletConfigured ? { available: false, reason: 'wallet_not_configured' } : AVAILABLE;
  return {
    transfers,
    linkedAccounts: await input.linkedAccountsEnabled() ? AVAILABLE : { available: false, reason: 'not_enabled' },
    payeeWallets: input.environment !== 'test' ? { available: false, reason: 'test_only' }
      : input.payeeWalletsEnabled ? AVAILABLE : { available: false, reason: 'not_enabled' },
  };
}
