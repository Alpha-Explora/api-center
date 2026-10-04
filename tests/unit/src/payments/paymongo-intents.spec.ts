import { PaymentIntentsService } from '../../../../apps/payments/src/features/payment-intents/payment-intents.service';
import { CheckoutService } from '../../../../apps/payments/src/features/checkout/checkout.service';
import { SubscriptionsService } from '../../../../apps/payments/src/features/subscriptions/subscriptions.service';

describe('PayMongo payment intents', () => {
  const originalFetch = global.fetch;
  const originalMode = process.env.PAYMENT_PROVIDER_MODE;
  const originalKey = process.env.PAYMONGO_TEST_SECRET_KEY;

  beforeEach(() => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_unit';
  });
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.PAYMENT_PROVIDER_MODE;
    else process.env.PAYMENT_PROVIDER_MODE = originalMode;
    if (originalKey === undefined) delete process.env.PAYMONGO_TEST_SECRET_KEY;
    else process.env.PAYMONGO_TEST_SECRET_KEY = originalKey;
  });

  it('sends the validated amount and idempotency key to PayMongo', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201,
      json: async () => ({ data: { id: 'pi_provider_123', attributes: {
        status: 'awaiting_payment_method', amount: 39900, currency: 'PHP' } } }) });
    const intent = await new PaymentIntentsService().createPaymentIntent({
      amount: 39900, currency: 'PHP', referenceId: 'order-123',
    }, { idempotencyKey: 'intent-order-123', tribeId: 'tribe-alpha' });
    expect(intent).toMatchObject({ paymentIntentId: 'pi_provider_123', amount: 39900,
      currency: 'PHP', status: 'awaiting_payment_method' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/payment_intents'),
      expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': 'intent-order-123' }),
        body: expect.stringContaining('39900') }));
  });

  it.each([
    ['checkout expiration', () => new CheckoutService().markCheckoutCancelled('chk_provider_123', {
      idempotencyKey: 'cancel-checkout-123',
    }), 'cancel-checkout-123'],
    ['subscription cancellation', () => new SubscriptionsService().cancelSubscription('sub_provider_123', {
      idempotencyKey: 'cancel-subscription-123',
    }), 'cancel-subscription-123'],
  ])('sends the idempotency key for %s', async (_operation, perform, key) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200,
      json: async () => ({ data: { id: 'provider-resource', attributes: { status: 'cancelled' } } }) });
    await perform();
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': key }),
    }));
  });
});
