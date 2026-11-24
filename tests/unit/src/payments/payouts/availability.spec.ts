import { payoutAvailability } from '../../../../../apps/payments/src/features/payouts/availability';

describe('payout availability', () => {
  const saved = process.env.PAYOUTS_LIVE_ENABLED;
  afterEach(() => { if (saved === undefined) delete process.env.PAYOUTS_LIVE_ENABLED; else process.env.PAYOUTS_LIVE_ENABLED = saved; });
  const base = { walletConfigured: true, linkedAccountsEnabled: async () => false, payeeWalletsEnabled: false };

  it('keeps live payouts unavailable until PAYOUTS_LIVE_ENABLED is set', async () => {
    delete process.env.PAYOUTS_LIVE_ENABLED;
    expect((await payoutAvailability({ ...base, environment: 'live' })).transfers).toEqual({ available: false, reason: 'live_payouts_disabled' });
    process.env.PAYOUTS_LIVE_ENABLED = 'true';
    expect((await payoutAvailability({ ...base, environment: 'live' })).transfers).toEqual({ available: true, reason: null });
  });

  it('offers payee wallets in test only, and child accounts only when switched on', async () => {
    expect((await payoutAvailability({ ...base, environment: 'live', payeeWalletsEnabled: true })).payeeWallets)
      .toEqual({ available: false, reason: 'test_only' });
    expect((await payoutAvailability({ ...base, environment: 'test', payeeWalletsEnabled: true })).payeeWallets.available).toBe(true);
    expect((await payoutAvailability({ ...base, environment: 'test', linkedAccountsEnabled: async () => true })).linkedAccounts.available).toBe(true);
  });
});
