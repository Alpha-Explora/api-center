import type { Server } from 'node:http';

describe('private payment runtime identity', () => {
  let server: Server;
  let baseUrl: string;
  const saved = {
    mode: process.env.PAYMENT_PROVIDER_MODE,
    token: process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN,
    database: process.env.SHARED_SERVICES_DATABASE_URL,
  };

  beforeAll(async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = 'test-runtime-token';
    delete process.env.SHARED_SERVICES_DATABASE_URL;
    const { app } = require('../../../../apps/payments/src/server') as { app: { listen: (port: number, callback: () => void) => Server } };
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (saved.mode === undefined) delete process.env.PAYMENT_PROVIDER_MODE; else process.env.PAYMENT_PROVIDER_MODE = saved.mode;
    if (saved.token === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN; else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = saved.token;
    if (saved.database === undefined) delete process.env.SHARED_SERVICES_DATABASE_URL; else process.env.SHARED_SERVICES_DATABASE_URL = saved.database;
  });

  function headers(tribeId: string, token = 'test-runtime-token') {
    return { authorization: `Bearer ${token}`, 'content-type': 'application/json',
      'x-apicenter-owner-tribe-id': tribeId,
      'x-apicenter-consumer-service-id': 'service-a',
      'x-apicenter-environment': 'test' };
  }

  it('requires the internal token and rejects cross-tenant reads despite a forged body tenant', async () => {
    const anonymous = await fetch(`${baseUrl}/checkout/sessions`, {
      method: 'POST', headers: headers('tribe-a', 'wrong'), body: '{}',
    });
    expect(anonymous.status).toBe(401);

    const created = await fetch(`${baseUrl}/checkout/sessions`, {
      method: 'POST', headers: { ...headers('tribe-a'), 'idempotency-key': 'runtime-owner-checkout-1' },
      body: JSON.stringify({ referenceId: 'order-ownership', amount: 100, currency: 'PHP',
        successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel', tribeId: 'tribe-b' }),
    });
    expect(created.status).toBe(201);
    const checkoutId = ((await created.json()) as { data: { checkoutId: string } }).data.checkoutId;

    const other = await fetch(`${baseUrl}/checkout/sessions/${checkoutId}`, {
      headers: { ...headers('tribe-b'), 'x-tribe-id': 'tribe-a' },
    });
    expect(other.status).toBe(404);

    const owner = await fetch(`${baseUrl}/checkout/sessions/${checkoutId}`, { headers: headers('tribe-a') });
    expect(owner.status).toBe(200);
  });
});
