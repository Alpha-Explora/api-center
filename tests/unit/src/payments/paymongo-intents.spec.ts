const paymongo = require('../../../../apps/payments/src/services/paymongo/paymongoService');

describe('private payments intent and setup operations', () => {
  const originalFetch = global.fetch;
  const originalMode = process.env.PAYMENT_PROVIDER_MODE;
  const originalTestKey = process.env.PAYMONGO_TEST_SECRET_KEY;

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_unit';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.PAYMENT_PROVIDER_MODE;
    else process.env.PAYMENT_PROVIDER_MODE = originalMode;
    if (originalTestKey === undefined) delete process.env.PAYMONGO_TEST_SECRET_KEY;
    else process.env.PAYMONGO_TEST_SECRET_KEY = originalTestKey;
  });

  it('creates a normalized payment intent through PayMongo', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 'pi_provider_123', attributes: { status: 'awaiting_payment_method', amount: 39900, currency: 'PHP', metadata: { referenceId: 'order-123' } } } }),
    });

    await expect(paymongo.createPaymentIntent({
      referenceId: 'order-123',
      amount: { value: 39900, currency: 'PHP' },
    }, { idempotencyKey: 'intent-order-123', tribeId: 'tribe-alpha' })).resolves.toMatchObject({
      paymentIntentId: 'pi_v1_cGlfcHJvdmlkZXJfMTIz',
      referenceId: 'order-123',
      amount: { value: 39900, currency: 'PHP' },
      status: 'pending',
    });
  });

  it('creates a normalized payment method setup through PayMongo', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: 'setu_provider_123', attributes: { status: 'awaiting_action', customer_id: 'cus_123', metadata: { referenceId: 'setup-123' } } } }),
    });

    await expect(paymongo.createPaymentMethodSetup({
      customerId: 'cus_123',
      referenceId: 'setup-123',
      returnUrl: 'https://app.test/return',
    }, { idempotencyKey: 'setup-123', tribeId: 'tribe-alpha' })).resolves.toMatchObject({
      setupId: 'setu_v1_c2V0dV9wcm92aWRlcl8xMjM',
      customerId: 'cus_123',
      status: 'pending',
    });
  });
});