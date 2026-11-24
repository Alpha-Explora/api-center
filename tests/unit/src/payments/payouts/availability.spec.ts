import { payoutAvailability } from '../../../../../apps/payments/src/features/payouts/availability';

describe('payout availability', () => {
  const base = { walletConfigured: true, transfersEnabled: true, linkedAccountsEnabled: async () => false, payeeWalletsEnabled: false };

  it('reports project access and gives a pause precedence over the wallet', async () => {
    expect((await payoutAvailability({ ...base, environment: 'live', transfersEnabled: false })).transfers)
      .toEqual({ available: false, reason: 'not_enabled' });
    expect((await payoutAvailability({ ...base, environment: 'live' })).transfers).toEqual({ available: true, reason: null });
    expect((await payoutAvailability({
      ...base, environment: 'live', walletConfigured: false, paused: new Set(['payouts_sending']),
    })).transfers).toEqual({ available: false, reason: 'paused' });
  });

  it('offers payee wallets in test only, and child accounts only when switched on', async () => {
    expect((await payoutAvailability({ ...base, environment: 'live', payeeWalletsEnabled: true })).payeeWallets)
      .toEqual({ available: false, reason: 'test_only' });
    expect((await payoutAvailability({ ...base, environment: 'test', payeeWalletsEnabled: true })).payeeWallets.available).toBe(true);
    expect((await payoutAvailability({ ...base, environment: 'test', linkedAccountsEnabled: async () => true })).linkedAccounts.available).toBe(true);
  });
});
