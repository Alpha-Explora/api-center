import { SimulatedConsumerProvider } from '../../../../../apps/payments/src/features/linked-accounts/linked-accounts-provider';
import type { MerchantAccount, MerchantAccountResolver } from '../../../../../apps/payments/src/features/payouts/merchant-accounts';
import {
  SIMULATED_BALANCE, SIMULATED_TEST_WALLET, SimulatedMoneyMover, withSimulatedTestWallet,
} from '../../../../../apps/payments/src/features/payouts/simulated-money-mover';

const parent: MerchantAccount = { id: 'parent', kind: 'parent', wallet: null, lowFloatAlert: 0 };
const request = { account: parent, referenceNumber: 'AB12', amount: 72_500, metadata: {},
  destination: { type: 'wallet' as const, accountNumber: '09171234567', accountName: 'Juan' } };

describe('simulated test payouts', () => {
  it('settles every transfer at once and finds it again from any instance', async () => {
    const submitted = await new SimulatedMoneyMover().submit(request);
    expect(submitted).toEqual({ kind: 'accepted', transferId: expect.stringMatching(/^tr_sim_[0-9a-f]{24}$/), status: 'succeeded', fee: 1_000 });
    const elsewhere = new SimulatedMoneyMover();
    const transferId = (submitted as { transferId: string }).transferId;
    await expect(elsewhere.lookup(parent, { transferId })).resolves.toMatchObject({ found: true, status: 'succeeded' });
    await expect(elsewhere.lookup(parent, { referenceNumber: 'AB12', since: new Date() })).resolves.toMatchObject({ transferId });
    await expect(elsewhere.lookup(parent, { transferId: 'tr_real_provider' })).resolves.toEqual({ found: false });
    await expect(elsewhere.availableBalance()).resolves.toBe(SIMULATED_BALANCE);
  });

  it('gives test accounts without a wallet the simulated one and leaves live and configured accounts alone', async () => {
    const own = { number: '123456789', name: 'Own wallet' };
    const resolver: MerchantAccountResolver = {
      resolve: async () => parent,
      get: async (id) => (id === 'org_child' ? { id: 'org_child', kind: 'child', wallet: own, lowFloatAlert: 0 } : parent),
      listWithReleasedPools: async () => [parent],
    };
    const simulated = withSimulatedTestWallet(resolver);
    expect((await simulated.resolve('prj_1', 'test', new Date())).wallet).toEqual(SIMULATED_TEST_WALLET);
    expect((await simulated.resolve('prj_1', 'live', new Date())).wallet).toBeNull();
    expect((await simulated.get('org_child', 'test')).wallet).toEqual(own);
    expect((await simulated.listWithReleasedPools!('test'))[0].wallet).toEqual(SIMULATED_TEST_WALLET);
    expect(simulated.listProjectWallets).toBeUndefined();
  });
});

describe('simulated payee identity check', () => {
  it('queues a passed check with each link and an activated wallet in the payee name', async () => {
    const provider = new SimulatedConsumerProvider();
    const { value: account } = await provider.create('lac_1');
    await expect(new SimulatedConsumerProvider().findByReference('lac_1')).resolves.toEqual({ kind: 'ok', value: account });
    await provider.submitDetails(account.providerAccountId, { firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.test' });
    const link = await provider.issueVerificationLink(account.providerAccountId, 'key-1');
    expect(provider.takeEvents()).toEqual([{ providerEventId: `sim_verified_${link.value.sessionId}`, providerAccountId: account.providerAccountId,
      accountKind: 'consumer', sessionId: link.value.sessionId, event: { type: 'verification_passed' } }]);
    expect(provider.takeEvents()).toEqual([]);
    await provider.activate(account.providerAccountId);
    const [activated] = provider.takeEvents();
    expect(activated).toMatchObject({ providerEventId: `sim_activated_${account.providerAccountId}`,
      event: { type: 'activated', wallet: { name: 'Juan Dela Cruz', number: expect.stringMatching(/^\d{12}$/) } } });
  });
});
