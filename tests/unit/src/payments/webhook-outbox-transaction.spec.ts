export {};
const { createWebhookService } = require('../../../../apps/payments/src/services/paymongo/webhookService');
const { createMemoryPaymentStore } = require('../../../../apps/payments/src/services/paymongo/paymentStore.memory');

class TestPaymentError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

describe('webhook state and outbox transaction', () => {
  const originalProviderMode = process.env.PAYMENT_PROVIDER_MODE;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    if (originalProviderMode === undefined) delete process.env.PAYMENT_PROVIDER_MODE; else process.env.PAYMENT_PROVIDER_MODE = originalProviderMode;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
  });

  it('commits one versioned checkout transition and one outbox record for duplicate webhooks', async () => {
    const store = createMemoryPaymentStore();
    await store.createCheckoutSessionRecord({
      tribeId: 'tribe-alpha',
      environment: 'test',
      providerMode: 'test',
      checkoutId: 'chk_123',
      referenceId: 'order-123',
      status: 'pending',
      amount: { value: 39900, currency: 'PHP' },
      metadata: { __apicenterConsumerServiceId: 'service-alpha' },
    });
    const service = createWebhookService({
      PayMongoError: TestPaymentError,
      getCheckoutSession: jest.fn(),
      getPaymentStore: () => store,
      isMockMode: () => true,
      providerMode: () => 'test',
      resolveSecretKey: () => undefined,
    });
    const body = {
      data: {
        id: 'evt_checkout_paid_123',
        attributes: {
          type: 'checkout_session.payment.paid',
          livemode: false,
          data: {
            type: 'checkout_session',
            id: 'chk_123',
            attributes: { reference_id: 'order-123', amount: 39900, currency: 'PHP' },
          },
        },
      },
    };

    await service.webhook(body, { environment: 'test', rawBody: JSON.stringify(body) });
    await service.webhook(body, { environment: 'test', rawBody: JSON.stringify(body) });

    await expect(store.getCheckoutSessionStatus('chk_123')).resolves.toMatchObject({
      status: 'paid',
      aggregateVersion: 2,
    });
    await expect(store.claimPendingPaymentEvents()).resolves.toEqual([
      expect.objectContaining({
        providerEventId: 'evt_checkout_paid_123',
        aggregateVersion: 2,
        payload: expect.objectContaining({ aggregateVersion: 2 }),
      }),
    ]);
  });
});