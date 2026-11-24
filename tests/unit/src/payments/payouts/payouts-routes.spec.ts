import type { Server } from 'node:http';

// Only Date is faked, so the HTTP server and fetch keep their real timers.
const REAL_TIMERS = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
  'setTimeout', 'clearTimeout'] as const;

describe('runtime payout routes', () => {
  let server: Server;
  let baseUrl: string;
  const saved = {
    mode: process.env.PAYMENT_PROVIDER_MODE,
    token: process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN,
    database: process.env.SHARED_SERVICES_DATABASE_URL,
    secret: process.env.PAYMONGO_TEST_WEBHOOK_SECRET,
  };

  beforeAll(async () => {
    jest.useFakeTimers({ doNotFake: [...REAL_TIMERS], now: new Date('2026-11-24T00:00:00Z') });
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = 'test-runtime-token';
    process.env.PAYMONGO_TEST_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.PAYOUT_WALLET_NUMBER = '1234567';
    process.env.PAYOUT_WALLET_NAME = 'ALPHAEXPLORA';
    delete process.env.SHARED_SERVICES_DATABASE_URL;
    const { app } = require('../../../../../apps/payments/src/server') as { app: { listen: (port: number, callback: () => void) => Server } };
    server = await new Promise<Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    jest.useRealTimers();
    delete process.env.PAYOUT_WALLET_NUMBER;
    delete process.env.PAYOUT_WALLET_NAME;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, name] of [['mode', 'PAYMENT_PROVIDER_MODE'], ['token', 'APICENTER_PAYMENTS_INTERNAL_TOKEN'],
      ['database', 'SHARED_SERVICES_DATABASE_URL'], ['secret', 'PAYMONGO_TEST_WEBHOOK_SECRET']] as const) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
  });

  const headers = (projectId: string) => ({
    authorization: 'Bearer test-runtime-token', 'content-type': 'application/json',
    'x-apicenter-owner-tribe-id': 'org-1', 'x-apicenter-project-id': projectId,
    'x-apicenter-consumer-service-id': 'app-1', 'x-apicenter-environment': 'test',
  });

  async function call(projectId: string, method: string, path: string, body?: unknown) {
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { ...headers(projectId), 'idempotency-key': `key-${Math.random()}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  const destination = { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan Dela Cruz' };

  async function payeeWithReleased(projectId: string, amount: number) {
    const payee = (await call(projectId, 'POST', '/payouts/payees', { externalRef: `ext-${projectId}`, legalName: 'Juan Dela Cruz' })).body.data;
    await call(projectId, 'PUT', `/payouts/payees/${payee.id}/destination`, destination);
    const intent = await call(projectId, 'POST', '/payment-intents', {
      amount, currency: 'PHP', referenceId: `order-${projectId}`, allocations: [{ payeeId: payee.id, amount }] });
    expect(intent.status).toBe(201);
    const allocationId = intent.body.data.allocations[0].id as string;
    // Confirm the payment the way its webhook would.
    const { PaymentOwnerStore } = require('../../../../../apps/payments/src/shared/payment-owner-store');
    await PaymentOwnerStore.getInstance().applyVerifiedWebhook({ providerEventId: `evt_${projectId}`, environment: 'test',
      eventType: 'payment.paid', payloadHash: projectId, receiptStatus: 'processed', updates: [],
      paidResource: { resourceType: 'intent', resourceId: intent.body.data.paymentIntentId, paymentId: `pay_${projectId}` } });
    expect((await call(projectId, 'POST', `/payouts/allocations/${allocationId}/release`)).status).toBe(200);
    return { payee, allocationId, intentId: intent.body.data.paymentIntentId as string };
  }

  it('creates payees idempotently by external reference', async () => {
    const first = await call('p-create', 'POST', '/payouts/payees', { externalRef: 'ext-1', legalName: 'Juan' });
    const again = await call('p-create', 'POST', '/payouts/payees', { externalRef: 'ext-1', legalName: 'Juan' });
    expect([first.status, again.status]).toEqual([201, 200]);
    expect(again.body.data.id).toBe(first.body.data.id);
    expect((await call('p-create', 'POST', '/payouts/payees', { externalRef: '' })).body.error.code).toBe('INVALID_PAYEE');
  });

  it('rejects an invalid destination', async () => {
    const payee = (await call('p-dest', 'POST', '/payouts/payees', { externalRef: 'ext-1', legalName: 'Juan' })).body.data;
    const response = await call('p-dest', 'PUT', `/payouts/payees/${payee.id}/destination`, { ...destination, accountNumber: '12' });
    expect(response).toMatchObject({ status: 400, body: { error: { code: 'INVALID_DESTINATION' } } });
  });

  it('accepts a wallet destination, and still the deprecated provider_wallet', async () => {
    const payee = (await call('p-wallet', 'POST', '/payouts/payees', { externalRef: 'ext-w', legalName: 'Maria' })).body.data;
    const path = `/payouts/payees/${payee.id}/destination`;
    const wallet = await call('p-wallet', 'PUT', path, { type: 'wallet', accountNumber: '09170000001', accountName: 'Maria' });
    expect(wallet.status).toBe(200);
    expect(wallet.body.data.destination).toMatchObject({ type: 'wallet', accountNumber: '09170000001' });
    const legacy = await call('p-wallet', 'PUT', path, { type: 'provider_wallet', accountNumber: '09170000002', accountName: 'Maria' });
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.destination).toMatchObject({ type: 'provider_wallet' });
  });

  it('records project-scoped payee verification and enforces it for cash-out only when required', async () => {
    const projectId = 'p-verification';
    const { payee } = await payeeWithReleased(projectId, 42_500);
    const path = `/payouts/payees/${payee.id}/verification`;
    const record = { method: 'third_party', verifiedAt: '2026-11-24T00:00:00Z', verifiedBy: 'operator-2', reference: 'verification-2' };
    const original = process.env.PAYOUTS_REQUIRE_PAYEE_VERIFICATION;
    process.env.PAYOUTS_REQUIRE_PAYEE_VERIFICATION = 'true';
    try {
      expect(await call(projectId, 'POST', `/payouts/payees/${payee.id}/cash-out`)).toMatchObject({
        status: 409, body: { error: { code: 'PAYEE_NOT_VERIFIED' } },
      });
      expect((await call(projectId, 'PUT', path, { method: 'third_party' })).status).toBe(400);
      expect((await call('other-project', 'PUT', path, record)).status).toBe(404);
      expect((await call(projectId, 'PUT', path, record)).status).toBe(200);
      expect((await call(projectId, 'GET', `/payouts/payees/${payee.id}`)).body.data.verification)
        .toEqual({ ...record, verifiedAt: '2026-11-24T00:00:00.000Z' });
    } finally {
      if (original === undefined) delete process.env.PAYOUTS_REQUIRE_PAYEE_VERIFICATION;
      else process.env.PAYOUTS_REQUIRE_PAYEE_VERIFICATION = original;
    }
  });

  it('rejects allocations for another project\'s payee before creating the payment', async () => {
    const other = (await call('p-other', 'POST', '/payouts/payees', { externalRef: 'ext-1', legalName: 'Maria' })).body.data;
    const response = await call('p-mine', 'POST', '/payment-intents', {
      amount: 50_000, currency: 'PHP', referenceId: 'order-x', allocations: [{ payeeId: other.id, amount: 100 }] });
    expect(response).toMatchObject({ status: 404, body: { error: { code: 'PAYEE_NOT_FOUND' } } });
    expect((await call('p-mine', 'GET', '/payouts')).body.data.records).toEqual([]);
  });

  it('destination change holds payouts for 24h', async () => {
    const { payee } = await payeeWithReleased('p-hold', 42_500);
    expect((await call('p-hold', 'POST', `/payouts/payees/${payee.id}/cash-out`)).body.error.code).toBe('DESTINATION_HOLD');
    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000));
    const cashOut = await call('p-hold', 'POST', `/payouts/payees/${payee.id}/cash-out`);
    expect(cashOut.status).toBe(202);
    expect(cashOut.body.data).toMatchObject({ gross: 42_500, fee: 1_000, net: 41_500, trigger: 'cash_out', status: 'pending' });
  });

  it('sending the same destination again does not restart the hold', async () => {
    const { payee } = await payeeWithReleased('p-same', 42_500);
    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000));
    await call('p-same', 'PUT', `/payouts/payees/${payee.id}/destination`, destination);
    expect((await call('p-same', 'POST', `/payouts/payees/${payee.id}/cash-out`)).status).toBe(202);
  });

  it('release is idempotent-safe', async () => {
    const { allocationId } = await payeeWithReleased('p-release', 20_000);
    const again = await call('p-release', 'POST', `/payouts/allocations/${allocationId}/release`);
    expect(again).toMatchObject({ status: 409, body: { error: { code: 'INVALID_ALLOCATION_STATE' } } });
  });

  it('cash-out respects the minimum and the daily cap', async () => {
    const small = await payeeWithReleased('p-small', 5_000);
    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000));
    expect((await call('p-small', 'POST', `/payouts/payees/${small.payee.id}/cash-out`)).body.error.code).toBe('BELOW_CASH_OUT_MINIMUM');

    const big = await payeeWithReleased('p-cap', 1_000_000);
    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000));
    expect((await call('p-cap', 'POST', `/payouts/payees/${big.payee.id}/cash-out`)).status).toBe(202);
    const second = await call('p-cap', 'POST', '/payment-intents', {
      amount: 20_000, currency: 'PHP', referenceId: 'order-cap-2', allocations: [{ payeeId: big.payee.id, amount: 20_000 }] });
    const { PaymentOwnerStore } = require('../../../../../apps/payments/src/shared/payment-owner-store');
    await PaymentOwnerStore.getInstance().applyVerifiedWebhook({ providerEventId: 'evt_cap_2', environment: 'test', eventType: 'payment.paid',
      payloadHash: 'cap2', receiptStatus: 'processed', updates: [],
      paidResource: { resourceType: 'intent', resourceId: second.body.data.paymentIntentId, paymentId: 'pay_cap_2' } });
    await call('p-cap', 'POST', `/payouts/allocations/${second.body.data.allocations[0].id}/release`);
    expect((await call('p-cap', 'POST', `/payouts/payees/${big.payee.id}/cash-out`)).body.error.code).toBe('DAILY_CAP_REACHED');
  });

  it('reports earnings that add up', async () => {
    const { payee } = await payeeWithReleased('p-earn', 30_000);
    const pending = await call('p-earn', 'POST', '/payment-intents', {
      amount: 10_000, currency: 'PHP', referenceId: 'order-earn-2', allocations: [{ payeeId: payee.id, amount: 7_000 }] });
    expect(pending.status).toBe(201);
    const detail = await call('p-earn', 'GET', `/payouts/payees/${payee.id}`);
    expect(detail.body.data.earnings).toEqual({ awaitingPayment: 7_000, held: 0, available: 30_000, inFlight: 0, paidThisWeek: 0 });
  });

  it('keeps every route inside its project', async () => {
    const { payee, allocationId } = await payeeWithReleased('p-iso', 30_000);
    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000));
    const payoutId = (await call('p-iso', 'POST', `/payouts/payees/${payee.id}/cash-out`)).body.data.id;
    for (const [method, path] of [['GET', `/payouts/payees/${payee.id}`], ['PUT', `/payouts/payees/${payee.id}/destination`],
      ['POST', `/payouts/payees/${payee.id}/cash-out`], ['POST', `/payouts/allocations/${allocationId}/cancel`], ['GET', `/payouts/${payoutId}`]]) {
      expect((await call('p-intruder', method, path, method === 'PUT' ? destination : undefined)).status).toBe(404);
    }
    expect((await call('p-intruder', 'GET', '/payouts/payees')).body.data.records).toEqual([]);
  });

  it('a transfer callback triggers a lookup instead of trusting its body', async () => {
    const response = await fetch(`${baseUrl}/payouts/callbacks/${'a'.repeat(43)}`, {
      method: 'POST',
      headers: { 'x-apicenter-internal-token': 'test-runtime-token', 'x-apicenter-environment': 'test', 'content-type': 'application/json' },
      body: JSON.stringify({ data: { status: 'succeeded' } }),
    });
    expect(response.status).toBe(204);
    const unauthorized = await fetch(`${baseUrl}/payouts/callbacks/${'a'.repeat(43)}`, { method: 'POST' });
    expect(unauthorized.status).toBe(401);
  });
});
