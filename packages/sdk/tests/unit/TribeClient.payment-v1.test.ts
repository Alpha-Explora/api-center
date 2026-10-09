import { TribeClient } from '../../src';

describe('TribeClient payment v1', () => {
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => ({
      success: true,
      data: {
        checkoutId: 'chk_123',
        referenceId: 'ACI-123',
        status: 'pending',
        amount: { amountMinor: 39900, currency: 'PHP' },
      },
    }),
  })) as unknown as typeof fetch;

  beforeEach(() => {
    (fetchImpl as jest.Mock).mockClear();
  });

  it('posts a checkout through the public payment namespace with idempotency', async () => {
    const client = new TribeClient({
      baseUrl: 'https://api-center.example.test/',
      apiKey: 'ac_test_key',
      serviceToken: 'jwt_service_token',
      fetchImpl,
    });

    await client.payments.createCheckout(
      {
        referenceId: 'ACI-123',
        amount: { amountMinor: 39900, currency: 'PHP' },
        successUrl: 'https://alpha.example.test/success',
        cancelUrl: 'https://alpha.example.test/cancel',
      },
      { headers: { 'Idempotency-Key': 'idem_checkout_1' } },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-center.example.test/api/v1/payments/checkouts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ac_test_key',
          'Idempotency-Key': 'idem_checkout_1',
        }),
        body: JSON.stringify({
          referenceId: 'ACI-123',
          amount: { amountMinor: 39900, currency: 'PHP' },
          successUrl: 'https://alpha.example.test/success',
          cancelUrl: 'https://alpha.example.test/cancel',
        }),
      }),
    );
  });

  it('creates PayMongo plans through the public payment namespace', async () => {
    const client = new TribeClient({
      baseUrl: 'https://api-center.example.test',
      apiKey: 'ac_test_key',
      serviceToken: 'jwt_service_token',
      fetchImpl,
    });

    await client.payments.createPlan(
      { name: 'Quarterly', amount: 150050, interval: 'monthly', intervalCount: 3 },
      { headers: { 'Idempotency-Key': 'idem_plan_1' } },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-center.example.test/api/v1/payments/plans',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Quarterly', amount: 150050, interval: 'monthly', intervalCount: 3 }),
      }),
    );
    await client.payments.getPlan('plan_123');
    await client.payments.listPlans();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-center.example.test/api/v1/payments/plans/plan_123',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api-center.example.test/api/v1/payments/plans',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('exposes payment intent and capability operations on the same public client', async () => {
    const client = new TribeClient({
      baseUrl: 'https://api-center.example.test',
      apiKey: 'ac_test_key',
      serviceToken: 'jwt_service_token',
      fetchImpl,
    });

    await client.payments.createPaymentIntent(
      {
        referenceId: 'ACI-PI-123',
        amount: { amountMinor: 1000, currency: 'PHP' },
      },
      { headers: { 'Idempotency-Key': 'idem_intent_1' } },
    );
    await client.payments.getPaymentCapabilities();

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api-center.example.test/api/v1/payments/capabilities',
      expect.objectContaining({ method: 'GET' }),
    );
  });


  it('returns a pending resource from a 202 envelope', async () => {
    const pendingFetch = jest.fn(async () => ({
      ok: false,
      status: 202,
      json: async () => ({ success: true, data: { status: 'pending', resourceId: 'chk_v1_pending' } }),
    })) as unknown as typeof fetch;
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test', apiKey: 'ac_test_key', serviceToken: 'jwt_service_token', fetchImpl: pendingFetch });
    await expect(client.payments.createCheckout({
      referenceId: 'ACI-PENDING',
      amount: { amountMinor: 1000, currency: 'PHP' },
      successUrl: 'https://alpha.example.test/success',
      cancelUrl: 'https://alpha.example.test/cancel',
    }, { headers: { 'Idempotency-Key': 'idem_pending_1' } })).resolves.toEqual({ status: 'pending', resourceId: 'chk_v1_pending' });
  });

  it('lists project payment records with encoded filters and cursor', async () => {
    const listFetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { records: [], nextCursor: 'cursor-next' } }),
    }));
    const listFetch = listFetchMock as unknown as typeof fetch;
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test', apiKey: 'ac_test_key',
      serviceToken: 'jwt_service_token', fetchImpl: listFetch });

    await expect(client.payments.listPaymentRecords({ type: 'payment', status: 'paid', limit: 200,
      createdAfter: '2026-10-01T00:00:00.000Z', cursor: 'cursor / +' }))
      .resolves.toMatchObject({ records: [], nextCursor: 'cursor-next' });
    const [url, options] = listFetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/payments/records?');
    expect(url).toContain('type=payment');
    expect(url).toContain('status=paid');
    expect(url).toContain('cursor=cursor+%2F+%2B');
    expect(options.method).toBe('GET');
  });
});
