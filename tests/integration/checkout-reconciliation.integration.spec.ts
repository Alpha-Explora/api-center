import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import crypto from 'node:crypto';

describe('checkout reconciliation through the payment runtime', () => {
  const originalFetch = global.fetch;
  const envKeys = ['NODE_ENV', 'PAYMENT_PROVIDER_MODE', 'PAYMONGO_TEST_SECRET_KEY', 'PAYMONGO_BASE_URL',
    'APICENTER_PAYMENTS_INTERNAL_TOKEN', 'PAYMONGO_TEST_WEBHOOK_SECRET',
    'DATABASE_URL', 'PAYMENT_DATABASE_URL', 'SHARED_SERVICES_DATABASE_URL'];
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const headers = { Authorization: 'Bearer reconciliation-runtime-token', 'Content-Type': 'application/json',
    'X-APICenter-Owner-Tribe-ID': 'tribe-a', 'X-APICenter-Project-ID': 'project-a',
    'X-APICenter-Consumer-Service-ID': 'service-a', 'X-APICenter-Environment': 'test' };
  let server: Server;
  let baseUrl: string;
  let sequence = 0;
  let providerAttributes: Record<string, unknown>;
  let providerFetch: jest.Mock;
  let checkoutId: string;
  let referenceId: string;

  beforeAll(async () => {
    for (const key of envKeys) delete process.env[key];
    Object.assign(process.env, { NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'test',
      PAYMONGO_TEST_SECRET_KEY: 'sk_test_reconciliation', APICENTER_PAYMENTS_INTERNAL_TOKEN: 'reconciliation-runtime-token',
      PAYMONGO_TEST_WEBHOOK_SECRET: 'reconciliation-webhook-secret' });
    const { app } = await import('../../apps/payments/src/server');
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    sequence++;
    checkoutId = `chk_reconcile_${sequence}`;
    referenceId = `ORDER-${sequence}`;
    providerAttributes = { status: 'active', checkout_url: 'https://checkout.paymongo.com/example',
      created_at: 1792145740, payments: [], payment_intent: { attributes: { status: 'awaiting_payment_method' } } };
    providerFetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({
      data: { id: `cs_reconcile_${sequence}`, attributes: providerAttributes },
    }) }));
    global.fetch = providerFetch;
    const response = await request('/checkout/sessions', { method: 'POST',
      headers: { 'Idempotency-Key': `create-${sequence}` }, body: JSON.stringify({ referenceId,
        amount: 100, currency: 'PHP', successUrl: 'https://shop.example/success', cancelUrl: 'https://shop.example/cancel',
        metadata: { booking: 'booking-a' } }) });
    expect(response.status).toBe(201);
  });

  afterEach(() => { global.fetch = originalFetch; });
  afterAll(async () => {
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function request(path: string, options: RequestInit = {}) {
    return originalFetch(baseUrl + path, { ...options, headers: { ...headers, ...options.headers } });
  }

  function paid() {
    providerAttributes = { ...providerAttributes, payment_intent: { attributes: { status: 'succeeded' } },
      payments: [{ id: `pay_reconcile_${sequence}`, type: 'payment', attributes: { status: 'paid', amount: 100, currency: 'PHP' } }] };
  }

  it('recognizes a paid payment in an active checkout and persists its status for reconciliation', async () => {
    paid();
    const response = await request(`/checkout/sessions/${checkoutId}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { checkoutId, referenceId, status: 'paid',
      amount: { value: 100, currency: 'PHP' }, metadata: { booking: 'booking-a' } } });
    const records = await request('/payments/records?type=checkout&status=paid');
    expect(await records.json()).toMatchObject({ data: { records: expect.arrayContaining([
      expect.objectContaining({ id: checkoutId, status: 'paid' }),
    ]) } });
  });

  it.each(['', '/status'])('refreshes reference lookup%s and keeps the paid version stable on subsequent reads', async (suffix) => {
    paid();
    const found = await request(`/checkout/sessions/by-reference/${referenceId}${suffix}`);
    const first = await found.json() as { data: { aggregateVersion: number } };
    expect(first).toMatchObject({ data: { checkoutId, referenceId, status: 'paid', aggregateVersion: 2 } });
    for (const path of [`/checkout/sessions/${checkoutId}`, `/checkout/sessions/${checkoutId}/status`,
      `/checkout/sessions/by-reference/${referenceId}`]) {
      expect(await (await request(path)).json()).toMatchObject({ data: first.data });
    }
  });

  it('leaves an active checkout unpaid without provider confirmation', async () => {
    expect(await (await request(`/checkout/sessions/${checkoutId}`)).json())
      .toMatchObject({ data: { status: 'pending', aggregateVersion: 1 } });
    providerAttributes = { ...providerAttributes, status: 'expired' };
    expect(await (await request(`/checkout/sessions/by-reference/${referenceId}`)).json())
      .toMatchObject({ data: { status: 'expired', aggregateVersion: 2 } });
  });

  it.each([
    { 'X-APICenter-Project-ID': 'project-b' },
    { 'X-APICenter-Owner-Tribe-ID': 'tribe-b' },
  ])('rejects a foreign owner before accessing PayMongo', async (foreignHeaders) => {
    providerFetch.mockClear();
    for (const path of [`/checkout/sessions/${checkoutId}`, `/checkout/sessions/by-reference/${referenceId}`]) {
      expect((await request(path, { headers: foreignHeaders })).status).toBe(404);
    }
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('rejects a mismatched environment before accessing PayMongo', async () => {
    providerFetch.mockClear();
    expect((await request(`/checkout/sessions/${checkoutId}`, { headers: { 'X-APICenter-Environment': 'live' } })).status).toBe(403);
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('reports a provider error without changing the saved checkout', async () => {
    providerFetch.mockResolvedValueOnce({ ok: false, status: 503,
      json: async () => ({ errors: [{ code: 'provider_unavailable', detail: 'Provider unavailable' }] }) });
    expect((await request(`/checkout/sessions/${checkoutId}`)).status).toBe(503);
    const records = await request('/payments/records?type=checkout&status=pending');
    expect(await records.json()).toMatchObject({ data: { records: expect.arrayContaining([
      expect.objectContaining({ id: checkoutId, status: 'pending' }),
    ]) } });
  });

  async function deliverPaidWebhook() {
    paid();
    const body = JSON.stringify({ data: { id: `evt_reconcile_${sequence}`, attributes: {
      type: 'checkout_session.payment.paid', livemode: false, created_at: 1792145775,
      data: { id: `cs_reconcile_${sequence}`, attributes: providerAttributes },
    } } });
    const timestamp = '1792145775';
    const signature = crypto.createHmac('sha256', 'reconciliation-webhook-secret').update(`${timestamp}.${body}`).digest('hex');
    return request('/webhooks', { method: 'POST', body, headers: {
      'X-APICenter-Internal-Token': 'reconciliation-runtime-token', 'Paymongo-Signature': `t=${timestamp},te=${signature}`,
    } });
  }

  it('does not regress a webhook-confirmed payment when an older poll finishes later', async () => {
    providerFetch.mockImplementationOnce(async () => {
      const stale = { ...providerAttributes };
      expect((await deliverPaidWebhook()).status).toBe(200);
      return { ok: true, status: 200, json: async () => ({ data: { id: `cs_reconcile_${sequence}`, attributes: stale } }) };
    });
    expect(await (await request(`/checkout/sessions/${checkoutId}`)).json())
      .toMatchObject({ data: { status: 'paid', aggregateVersion: 2 } });
    const records = await request('/payments/records?type=checkout&status=paid');
    expect(await records.json()).toMatchObject({ data: { records: expect.arrayContaining([
      expect.objectContaining({ id: checkoutId, status: 'paid' }),
    ]) } });
  });

  it('still queues exactly one signed webhook event after polling recovered the payment', async () => {
    paid();
    await request(`/checkout/sessions/${checkoutId}`);
    expect(await (await deliverPaidWebhook()).json()).toMatchObject({ data: { data: { queued: true } } });
    expect(await (await deliverPaidWebhook()).json()).toMatchObject({ data: { event: 'duplicate', data: { queued: false } } });
    expect(await (await request(`/checkout/sessions/${checkoutId}`)).json())
      .toMatchObject({ data: { status: 'paid', aggregateVersion: 3 } });
  });
});
