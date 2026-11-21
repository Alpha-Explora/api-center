import { MockMoneyMover } from '../../../../../apps/payments/src/features/payouts/mock-money-mover';
import type { MerchantAccount, MerchantAccountResolver } from '../../../../../apps/payments/src/features/payouts/merchant-accounts';
import { reconcileOpenAttempts, runPayouts, type PayoutDeps } from '../../../../../apps/payments/src/features/payouts/payout-executor';
import { MemoryPayoutStore, type PayoutContext } from '../../../../../apps/payments/src/features/payouts/payout-store';

const context: PayoutContext = { organizationId: 'org-1', projectId: 'project-1', consumerServiceId: 'app-1', environment: 'test' };
const wallet: MerchantAccount = { id: 'parent', kind: 'parent', wallet: { number: '1234', name: 'ALPHAEXPLORA' }, lowFloatAlert: 0 };
const accounts: MerchantAccountResolver = { resolve: async () => wallet, get: async () => wallet };

async function setup(amounts = [42_500, 30_000]) {
  let now = new Date('2026-11-27T12:05:00Z'); // Friday 20:05 Manila
  const clock = () => now;
  const store = new MemoryPayoutStore(clock);
  const mover = new MockMoneyMover();
  const { payee } = await store.upsertPayee(context, { externalRef: 'ext-1', legalName: 'Juan Dela Cruz' });
  await store.setPayeeDestination('test', 'project-1', payee.id,
    { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan Dela Cruz' }, new Date('2026-11-01T00:00:00Z'));
  const release = (amount: number, createdAt = '2026-11-26T00:00:00Z') => store.insertAllocations(context, [{
    payeeId: payee.id, merchantAccountId: 'parent', resourceType: 'intent', resourceId: `pi_${amount}_${createdAt}`, referenceId: 'order-1',
    template: false, paymentId: 'pay_1', amount, grossAmount: amount, status: 'released', createdAt,
  }]);
  for (const amount of amounts) await release(amount);
  const deps: PayoutDeps = { store, mover, accounts, now: clock };
  return { store, mover, payee, deps, release, setNow: (value: string) => { now = new Date(value); } };
}

const schedule = { kind: 'schedule' } as const;

describe('runPayouts', () => {
  it('pays a pool as one transfer', async () => {
    const { store, mover, deps } = await setup();
    const report = await runPayouts(deps, 'test', schedule);
    expect(report).toMatchObject({ floatLow: false });
    expect(report.paid).toHaveLength(1);
    expect(mover.submitted).toHaveLength(1);
    expect(mover.submitted[0]).toMatchObject({ amount: 72_500, destination: { bic: 'GXCHPHM2XXX' } });
    const payout = store.payouts.get(report.paid[0])!;
    expect(payout).toMatchObject({ status: 'pending', gross: 72_500, net: 72_500, fee: 1_000, trigger: 'schedule' });

    await expect(reconcileOpenAttempts(deps, 'test')).resolves.toEqual({ resolved: 1, needsReview: 0 });
    expect(store.payouts.get(payout.id)!.status).toBe('paid');
    expect([...store.allocations.values()].map((entry) => entry.status)).toEqual(['paid', 'paid']);
    expect(store.events.map((event) => event.eventType)).toEqual(['payment.payout.paid']);
    expect(store.events[0]).toMatchObject({ referenceId: 'ext-1', organizationId: 'org-1',
      payload: { payoutId: payout.id, net: 72_500, fee: 1_000, currency: 'PHP', trigger: 'schedule' } });
  });

  it('a second schedule run in the same week pays nothing', async () => {
    const { mover, deps, release, setNow } = await setup();
    await runPayouts(deps, 'test', schedule);
    await reconcileOpenAttempts(deps, 'test');
    await release(10_000, '2026-11-27T12:30:00Z');
    setNow('2026-11-27T13:05:00Z');
    const report = await runPayouts(deps, 'test', schedule);
    expect(report.paid).toEqual([]);
    expect(report.skipped).toEqual([expect.objectContaining({ reason: 'not_scheduled' })]);
    expect(mover.submitted).toHaveLength(1);
  });

  it('two concurrent runs create one payout', async () => {
    const { store, mover, deps } = await setup();
    const reports = await Promise.all([runPayouts(deps, 'test', schedule), runPayouts(deps, 'test', schedule)]);
    expect(reports.flatMap((report) => report.paid)).toHaveLength(1);
    expect(store.payouts.size).toBe(1);
    expect(mover.submitted).toHaveLength(1);
  });

  it('never resubmits an unknown payout', async () => {
    const { store, mover, deps, setNow } = await setup();
    mover.failNext('unknown');
    const [payoutId] = (await runPayouts(deps, 'test', schedule)).paid;
    expect(store.payouts.get(payoutId)!.status).toBe('unknown');

    setNow('2026-11-27T12:10:00Z');
    expect((await runPayouts(deps, 'test', { kind: 'cash_out', cashedOutToday: 0 })).paid).toEqual([]);
    expect(mover.submitted).toHaveLength(1);

    await reconcileOpenAttempts(deps, 'test');
    expect(store.payouts.get(payoutId)!.status).toBe('paid');
  });

  it('hands an unknown payout PayMongo has no record of to an operator after a day', async () => {
    const { store, mover, deps, setNow } = await setup();
    mover.failNext('unknown');
    const [payoutId] = (await runPayouts(deps, 'test', schedule)).paid;
    jest.spyOn(mover, 'lookup').mockResolvedValue({ found: false });

    setNow('2026-11-28T12:04:00Z');
    await expect(reconcileOpenAttempts(deps, 'test')).resolves.toEqual({ resolved: 0, needsReview: 0 });
    expect(store.payouts.get(payoutId)!.status).toBe('unknown');

    setNow('2026-11-28T12:06:00Z');
    await expect(reconcileOpenAttempts(deps, 'test')).resolves.toEqual({ resolved: 0, needsReview: 1 });
    expect(store.payouts.get(payoutId)!.status).toBe('needs_review');
    expect([...store.allocations.values()].every((entry) => entry.status === 'pooled')).toBe(true);
  });

  it('treats a payout stuck in submitting as unknown', async () => {
    const { store, deps, setNow } = await setup();
    const created = await store.createPayout('test', { payeeId: [...store.payees.keys()][0], merchantAccountId: 'parent', trigger: 'schedule',
      compose: () => ({ gross: 72_500, fee: 1_000, net: 72_500, allocationIds: [...store.allocations.keys()], adjustmentIds: [] }) });
    if ('skipped' in created) throw new Error('expected a payout');
    await store.beginAttempt('test', created.id);
    setNow('2026-11-27T12:08:00Z');
    await reconcileOpenAttempts(deps, 'test');
    // The mock has no record of a transfer that was never sent, so it stays unknown rather than being resent.
    expect(store.payouts.get(created.id)!.status).toBe('unknown');
  });

  it('a rejected transfer returns allocations to the pool', async () => {
    const { store, mover, deps, setNow } = await setup();
    mover.failNext('rejected');
    const [failedId] = (await runPayouts(deps, 'test', schedule)).paid;
    expect(store.payouts.get(failedId)).toMatchObject({ status: 'failed', failureCode: 'invalid_destination_account' });
    expect([...store.allocations.values()].map((entry) => [entry.status, entry.payoutId])).toEqual([['released', null], ['released', null]]);
    expect(store.events.map((event) => event.eventType)).toEqual(['payment.payout.failed']);

    setNow('2026-11-27T12:30:00Z');
    const [retryId] = (await runPayouts(deps, 'test', schedule)).paid;
    expect(retryId).toBeDefined();
    expect(retryId).not.toBe(failedId);
    const references = [...store.attempts.values()].map((attempt) => attempt.referenceNumber);
    expect(new Set(references).size).toBe(2);
  });

  it('skips payees when the float is too low and reports float_low', async () => {
    const { store, mover, deps } = await setup();
    mover.setBalance(50_000);
    const report = await runPayouts(deps, 'test', schedule);
    expect(report).toMatchObject({ paid: [], floatLow: true, skipped: [expect.objectContaining({ reason: 'float_low' })] });
    expect(store.payouts.size).toBe(0);
    expect([...store.allocations.values()].every((entry) => entry.status === 'released')).toBe(true);
  });

  it('refuses live submission unless enabled', async () => {
    const { mover, deps } = await setup();
    delete process.env.PAYOUTS_LIVE_ENABLED;
    await expect(runPayouts(deps, 'live', schedule)).rejects.toMatchObject({ code: 'PAYOUTS_LIVE_DISABLED' });
    expect(mover.submitted).toHaveLength(0);
  });

  it('splits a pool above the InstaPay cap across runs', async () => {
    const { store, deps } = await setup([3_000_000, 3_000_000]);
    const [payoutId] = (await runPayouts(deps, 'test', schedule)).paid;
    expect(store.payouts.get(payoutId)).toMatchObject({ gross: 3_000_000 });
    expect([...store.allocations.values()].map((entry) => entry.status).sort()).toEqual(['pooled', 'released']);
  });

  it('pays a cash-out with the payee bearing the fee', async () => {
    const { store, deps } = await setup();
    const [payoutId] = (await runPayouts(deps, 'test', { kind: 'cash_out', cashedOutToday: 0 },
      { payeeId: [...store.payees.keys()][0], projectId: 'project-1' })).paid;
    expect(store.payouts.get(payoutId)).toMatchObject({ trigger: 'cash_out', gross: 72_500, fee: 1_000, net: 71_500 });
  });
});
