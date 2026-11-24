import express from 'express';
import type { Server } from 'node:http';
import { MockMoneyMover } from '../../../../../apps/payments/src/features/payouts/mock-money-mover';
import type { MerchantAccount } from '../../../../../apps/payments/src/features/payouts/merchant-accounts';
import { MemoryPayoutStore, type PayoutContext } from '../../../../../apps/payments/src/features/payouts/payout-store';
import { registerPayoutRoutes } from '../../../../../apps/payments/src/features/payouts/payouts.routes';

describe('runtime payout admin routes', () => {
  const now = new Date('2026-11-24T00:00:00Z'); // Monday 08:00 Manila
  const context: PayoutContext = { organizationId: 'org-1', projectId: 'project-1', consumerServiceId: 'console', environment: 'test' };
  let wallet: MerchantAccount;
  let store: MemoryPayoutStore;
  let mover: MockMoneyMover;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    wallet = { id: 'parent', kind: 'parent', wallet: { number: '1234', name: 'ALPHAEXPLORA' }, lowFloatAlert: 100_000 };
    store = new MemoryPayoutStore(() => now);
    mover = new MockMoneyMover();
    mover.setBalance(1_250_000);
    const app = express();
    app.use(express.json());
    registerPayoutRoutes(app, { store, mover, accounts: { resolve: async () => wallet, get: async () => wallet }, now: () => now }, {
      ok: (res, data, status = 200) => res.status(status).json({ success: true, data }),
      context: (req) => ({ tribeId: 'org-1', projectId: String(req.get('x-project') ?? 'project-1'), consumerServiceId: 'console', environment: 'test' }),
      handleError: (res, error: any) => res.status(error.statusCode ?? 500).json({ success: false, error: { code: error.code, message: error.message } }),
    });
    server = await new Promise<Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

  async function call(method: string, path: string, body?: unknown, project = 'project-1') {
    const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'content-type': 'application/json', 'x-project': project },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() as any };
  }

  async function payoutInReview() {
    const { payee } = await store.upsertPayee(context, { externalRef: 'ext-1', legalName: 'Juan' });
    await store.setPayeeDestination('test', 'project-1', payee.id,
      { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan' }, new Date('2026-11-01T00:00:00Z'));
    const [allocation] = await store.insertAllocations(context, [{ payeeId: payee.id, merchantAccountId: 'parent', resourceType: 'intent',
      resourceId: 'pi_1', referenceId: 'ORDER-1', template: false, paymentId: 'pay_1', amount: 42_500, grossAmount: 50_000, status: 'released' }]);
    const payout = await store.createPayout('test', { payeeId: payee.id, merchantAccountId: 'parent', trigger: 'schedule',
      compose: () => ({ gross: 42_500, fee: 1_000, net: 42_500, allocationIds: [allocation.id], adjustmentIds: [] }) });
    if ('skipped' in payout) throw new Error('expected a payout');
    await store.beginAttempt('test', payout.id);
    await store.recordOutcome('test', payout.id, 'lost');
    return { payoutId: payout.id, allocationId: allocation.id };
  }

  it('shows the wallet, the counts, the payouts needing review and the next weekly payout', async () => {
    const { payoutId } = await payoutInReview();
    await store.recordOutcome('test', payoutId, 'not_found_after_deadline');
    const overview = await call('GET', '/admin/payouts/overview');
    expect(overview.body.data).toMatchObject({
      wallet: { configured: true, available: 1_250_000, lowFloatAlert: 100_000 },
      counts: expect.objectContaining({ needs_review: 1, paid: 0 }),
      needsReview: [expect.objectContaining({ id: payoutId, status: 'needs_review' })],
      nextScheduledAt: '2026-11-27T12:00:00.000Z',
    });
  });

  it('reports an unconfigured wallet', async () => {
    wallet = { ...wallet, wallet: null };
    expect((await call('GET', '/admin/payouts/overview')).body.data.wallet).toEqual({ configured: false, available: null, lowFloatAlert: 100_000 });
  });

  it('only resolves a payout that needs review, and failing it frees the earnings', async () => {
    const { payoutId, allocationId } = await payoutInReview();
    const early = await call('POST', `/admin/payouts/${payoutId}/resolve`, { outcome: 'failed', note: 'Not in the dashboard', actor: 'ops@example.test' });
    expect(early).toMatchObject({ status: 409, body: { error: { code: 'INVALID_PAYOUT_STATE' } } });

    await store.recordOutcome('test', payoutId, 'not_found_after_deadline');
    expect((await call('POST', `/admin/payouts/${payoutId}/resolve`, { outcome: 'failed', note: '', actor: 'ops@example.test' })).status).toBe(400);
    expect((await call('POST', `/admin/payouts/${payoutId}/resolve`, { outcome: 'failed', note: 'x', actor: 'a' }, 'project-2')).status).toBe(404);
    const resolved = await call('POST', `/admin/payouts/${payoutId}/resolve`, { outcome: 'failed', note: 'Not in the dashboard', actor: 'ops@example.test' });
    expect(resolved.body.data).toMatchObject({ id: payoutId, status: 'failed' });
    expect(store.payouts.get(payoutId)).toMatchObject({ resolutionNote: 'Not in the dashboard', resolvedBy: 'ops@example.test' });
    expect(store.allocations.get(allocationId)).toMatchObject({ status: 'released', payoutId: null });
  });

  it('saves settings that pass the policy schema', async () => {
    const settings = { schedule: { weekday: 1, hour: 9 }, immediate: false, thresholdCentavos: null,
      onDemand: { minimum: 20_000, dailyCap: 500_000 }, feeBearer: { scheduled: 'platform', cashOut: 'platform' }, minimumPayout: 0, transferFee: 1_000 };
    expect((await call('POST', '/admin/payouts/settings', { ...settings, actor: 'ops@example.test' })).body.data).toEqual(settings);
    expect((await call('GET', '/admin/payouts/settings')).body.data).toEqual(settings);
    expect((await call('GET', '/admin/payouts/settings', undefined, 'project-2')).body.data.schedule).toEqual({ weekday: 5, hour: 20 });
    const invalid = await call('POST', '/admin/payouts/settings', { ...settings, schedule: { weekday: 1, hour: 24 }, actor: 'ops@example.test' });
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: 'INVALID_PAYOUT_SETTINGS' } } });
  });
});
