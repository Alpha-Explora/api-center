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

  it('posts a checkout through the public payment namespace with idempotency', async () => {
    const client = new TribeClient({
      baseUrl: 'https://api-center.example.test/',
      apiKey: 'ac_test_key',
      tribeId: 'alphaci',
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
          'X-Tribe-ID': 'alphaci',
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

  it('exposes payment intent and capability operations on the same public client', async () => {
    const client = new TribeClient({
      baseUrl: 'https://api-center.example.test',
      apiKey: 'ac_test_key',
      tribeId: 'alphaci',
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
      3,
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
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test', apiKey: 'ac_test_key', tribeId: 'alphaci', fetchImpl: pendingFetch });
    await expect(client.payments.createCheckout({
      referenceId: 'ACI-PENDING',
      amount: { amountMinor: 1000, currency: 'PHP' },
      successUrl: 'https://alpha.example.test/success',
      cancelUrl: 'https://alpha.example.test/cancel',
    }, { headers: { 'Idempotency-Key': 'idem_pending_1' } })).resolves.toEqual({ status: 'pending', resourceId: 'chk_v1_pending' });
  });
});
