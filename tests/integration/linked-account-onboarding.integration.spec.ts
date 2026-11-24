import { Pool } from 'pg';
import { SANDBOX_MERCHANT_ID, type AccountEvent } from '../../apps/payments/src/features/linked-accounts/account-events';
import { LinkedAccountOnboarding } from '../../apps/payments/src/features/linked-accounts/linked-account-onboarding';
import { LinkedAccountStore } from '../../apps/payments/src/features/linked-accounts/linked-account-store';
import { FakeLinkedAccountsProvider, type LinkedAccountsProvider } from '../../apps/payments/src/features/linked-accounts/linked-accounts-provider';
import { createLinkedAccountsSwitch } from '../../apps/payments/src/features/linked-accounts/linked-accounts-switch';
import { createMerchantAccountResolver } from '../../apps/payments/src/features/payouts/merchant-accounts';
import { MockMoneyMover } from '../../apps/payments/src/features/payouts/mock-money-mover';
import { runPayouts } from '../../apps/payments/src/features/payouts/payout-executor';
import { createPayoutStore, payoutContext } from '../../apps/payments/src/features/payouts/payout-store';

const databaseUrl = process.env.LINKED_ACCOUNTS_TEST_DATABASE_URL;
const testDatabase = databaseUrl ? describe : describe.skip;
const details = { businessName: 'Test shop', tin: '111-111-111', expectedMonthlyVolume: 5_000,
  representative: { firstName: 'Test', lastName: 'Operator', email: 'operator@example.test' } };

testDatabase('linked account onboarding with Postgres', () => {
  const original = { ...process.env };
  let pool: Pool;
  let store: LinkedAccountStore;
  let switches: ReturnType<typeof createLinkedAccountsSwitch>;

  beforeAll(() => {
    if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('Use a disposable local database');
    pool = new Pool({ connectionString: databaseUrl });
    store = new LinkedAccountStore(pool);
    switches = createLinkedAccountsSwitch(pool);
  });
  beforeEach(() => { process.env.LINKED_ACCOUNTS_ENABLED = 'true'; });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ['LINKED_ACCOUNTS_ENABLED', 'PAYMENT_PROVIDER_MODE', 'PAYMONGO_TEST_SECRET_KEY', 'PAYOUTS_REQUIRE_PAYEE_VERIFICATION']) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });
  afterAll(async () => { await pool?.end(); });

  async function enable(projectId: string) {
    await switches.setProject('test', projectId, true, 'fixture');
    return { environment: 'test' as const, projectId, tribeId: 'org_review', consumerServiceId: 'console' };
  }

  it('reconciles the original provider create when the local result transaction rolls back', async () => {
    const context = await enable('review-create');
    const provider = new FakeLinkedAccountsProvider();
    const onboarding = new LinkedAccountOnboarding(store, switches, provider);
    const create = provider.create.bind(provider);
    const call = jest.spyOn(provider, 'create').mockImplementation(async (reference) => {
      expect(await store.current(context)).toMatchObject({ id: reference, status: 'draft', createStartedAt: expect.any(Date) });
      return create(reference);
    });
    const save = store.save.bind(store);
    let failPersistingResult = true;
    jest.spyOn(store, 'save').mockImplementation(async (record, query) => {
      await save(record, query);
      if (record.status === 'created' && failPersistingResult) {
        failPersistingResult = false;
        throw new Error('simulated write failure after provider create');
      }
    });
    await expect(onboarding.start(context, details)).rejects.toThrow('simulated write failure');
    const [reference] = call.mock.calls[0];
    await expect(onboarding.close(context, reference)).rejects.toMatchObject({ code: 'LINKED_ACCOUNT_OUTCOME_UNKNOWN' });
    await expect(onboarding.start(context, details)).resolves.toMatchObject({ id: reference, status: 'verification_pending' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('commits the provider ID and merchant details even if link issuance fails', async () => {
    const context = await enable('review-link-retry');
    const provider = new FakeLinkedAccountsProvider();
    const onboarding = new LinkedAccountOnboarding(store, switches, provider);
    const create = jest.spyOn(provider, 'create');
    const submit = jest.spyOn(provider, 'submitDetails');
    jest.spyOn(provider, 'issueVerificationLink').mockRejectedValueOnce(new Error('simulated link failure'));
    await expect(onboarding.start(context, details)).rejects.toThrow('simulated link failure');
    const [id] = create.mock.calls[0];
    await expect(onboarding.current(context)).resolves.toMatchObject({ id, status: 'details_submitted' });
    await expect(onboarding.start(context, details)).resolves.toMatchObject({ id, status: 'verification_pending' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('allows multiple sandbox projects and routes events by session', async () => {
    const first = await enable('review-sandbox-first');
    const second = await enable('review-sandbox-second');
    const provider: LinkedAccountsProvider = new FakeLinkedAccountsProvider();
    jest.spyOn(provider, 'create').mockResolvedValue({ kind: 'ok', value: { providerAccountId: SANDBOX_MERCHANT_ID } });
    const onboarding = new LinkedAccountOnboarding(store, switches, provider);
    const firstAccount = await onboarding.start(first, details);
    const secondAccount = await onboarding.start(second, details);
    expect(firstAccount.id).not.toBe(secondAccount.id);
    const firstRecord = (await store.current(first))!;
    const pass: AccountEvent = { providerEventId: 'evt_sandbox_first', providerAccountId: SANDBOX_MERCHANT_ID,
      sessionId: firstRecord.verificationSessionId!, event: { type: 'verification_passed' } };
    await expect(onboarding.applyProviderEvent('test', pass)).resolves.toBe('applied');
    await expect(onboarding.current(first)).resolves.toMatchObject({ status: 'activation_pending' });
    await expect(onboarding.current(second)).resolves.toMatchObject({ status: 'verification_pending' });

    await pool.query(`INSERT INTO shared_payment.linked_account_verification_sessions (linked_account_id, session_id)
      VALUES ($1,$2)`, [secondAccount.id, pass.sessionId]);
    await expect(onboarding.applyProviderEvent('test', { ...pass, providerEventId: 'evt_sandbox_shared' }))
      .resolves.toBe('unknown_account');
    await expect(onboarding.current(second)).resolves.toMatchObject({ status: 'verification_pending' });
    await expect(onboarding.applyProviderEvent('test', { providerEventId: 'evt_sandbox_unscoped',
      providerAccountId: SANDBOX_MERCHANT_ID, event: { type: 'declined', reason: 'fixture' } })).resolves.toBe('unknown_account');

    await expect(onboarding.advance(first, firstAccount.id)).resolves.toMatchObject({ status: 'active' });
    await expect(onboarding.moveProject(first, firstAccount.id, 'child')).rejects.toMatchObject({ code: 'INVALID_LINKED_ACCOUNT_STATE' });
  });

  it('looks up a missing wallet before moving and stops new collections when the child is declined', async () => {
    const context = await enable('review-wallet');
    const onboarding = new LinkedAccountOnboarding(store, switches, new FakeLinkedAccountsProvider(), undefined, () => true);
    const account = await onboarding.start(context, details);
    const providerAccountId = (await store.current(context))!.providerAccountId!;
    await onboarding.applyProviderEvent('test', { providerEventId: 'evt_wallet_active', providerAccountId,
      event: { type: 'activated', wallet: null } });

    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_review';
    const localWallet = { number: '123456789', name: 'Test wallet' };
    const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ data: [
      { merchant_id: providerAccountId, livemode: false, status: 'activated',
        account: { provider: 'paymongo', currency: 'PHP', account_number: localWallet.number, account_name: localWallet.name } },
    ] })));
    await onboarding.moveProject(context, account.id, 'child');
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/v2\/wallets\/$/),
      expect.objectContaining({ headers: expect.objectContaining({ 'Account-ID': providerAccountId }) }));
    const resolver = createMerchantAccountResolver(pool, switches);
    await expect(resolver.resolve(context.projectId, 'test', new Date())).resolves.toMatchObject({ id: providerAccountId, wallet: localWallet });

    process.env.LINKED_ACCOUNTS_ENABLED = 'false';
    process.env.PAYOUTS_REQUIRE_PAYEE_VERIFICATION = 'false';
    await expect(resolver.resolve(context.projectId, 'test', new Date())).resolves.toMatchObject({ id: 'parent' });
    const now = () => new Date('2026-11-27T12:05:00Z');
    const payouts = createPayoutStore(pool, now);
    const owner = payoutContext(context);
    const { payee } = await payouts.upsertPayee(owner, { externalRef: 'review-payee', legalName: 'Test payee' });
    await payouts.setPayeeDestination('test', context.projectId, payee.id, {
      type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Test payee',
    }, new Date('2026-11-01T00:00:00Z'));
    await payouts.insertAllocations(owner, [{ payeeId: payee.id, merchantAccountId: providerAccountId,
      resourceType: 'checkout', resourceId: 'chk_review', referenceId: 'review', paymentId: 'pay_review',
      template: false, amount: 30_000, grossAmount: 30_000, status: 'released', createdAt: '2026-11-26T00:00:00Z' }]);
    const mover = new MockMoneyMover();
    const report = await runPayouts({ store: payouts, accounts: resolver, mover, now }, 'test', { kind: 'schedule' });
    expect(report.paid).toHaveLength(1);
    expect(mover.submitted[0].account.id).toBe(providerAccountId);

    process.env.LINKED_ACCOUNTS_ENABLED = 'true';
    await onboarding.applyProviderEvent('test', { providerEventId: 'evt_wallet_declined', providerAccountId,
      event: { type: 'declined', reason: 'fixture' } });
    await expect(resolver.resolve(context.projectId, 'test', new Date())).resolves.toMatchObject({ id: 'parent' });
    await expect(resolver.get(providerAccountId, 'test')).resolves.toMatchObject({ wallet: localWallet });
  });
});
