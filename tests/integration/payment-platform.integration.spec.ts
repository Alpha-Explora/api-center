import { runPaymentPlatformSmoke, type PaymentSmokeHarness } from '../../scripts/smoke/payment-platform-smoke';

describe('payment platform release smoke', () => {
  it('proves idempotency, one canonical event, projection, stale duplicate safety, and no provider leak', async () => {
    const injected: unknown[] = [];
    const published = {
      eventId: 'smoke-fixed-smoke-key',
      eventType: 'payment.checkout.paid',
      aggregateId: 'checkout-1',
      aggregateVersion: 1,
      data: { status: 'paid', checkoutId: 'checkout-1' },
    };
    let projection = { status: 'paid', aggregateVersion: 1 };
    const harness: PaymentSmokeHarness = {
      async injectVerifiedEvent(event) {
        injected.push(event);
        return event;
      },
      async waitForPublishedEvent() { return published as never; },
      async waitForProjection() { return projection; },
      async entitlement() { return { status: 'active' }; },
    };
    const createCheckout = jest.fn()
      .mockResolvedValueOnce({ checkoutId: 'checkout-1', referenceId: 'order-smoke', status: 'created', amount: { amountMinor: 39900, currency: 'PHP' }, aggregateVersion: 1 })
      .mockResolvedValueOnce({ checkoutId: 'checkout-1', referenceId: 'order-smoke', status: 'created', amount: { amountMinor: 39900, currency: 'PHP' }, aggregateVersion: 1 });
    const payments = {
      createCheckout,
      getCheckout: jest.fn().mockResolvedValue({ checkoutId: 'checkout-1', referenceId: 'order-smoke', status: 'created', amount: { amountMinor: 39900, currency: 'PHP' }, aggregateVersion: 1 }),
    } as never;

    const evidence = await runPaymentPlatformSmoke({
      payments,
      harness,
      idempotencyKey: 'fixed-smoke-key',
      referenceId: 'order-smoke',
      ownerTribeId: 'tribe-alpha',
      consumerServiceId: 'alphaci-backend',
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
      now: () => '2026-07-28T00:00:00.000Z',
    });

    expect(createCheckout).toHaveBeenCalledTimes(2);
    expect(createCheckout.mock.calls[0][1]).toEqual({ headers: { 'Idempotency-Key': 'fixed-smoke-key' } });
    expect(injected).toHaveLength(2);
    expect(evidence).toMatchObject({ checkoutId: 'checkout-1', duplicateProjectionStable: true, providerPayloadLeak: false, entitlementStatus: 'active' });
    expect(JSON.stringify(published)).not.toMatch(/providerData|paymongo|secretKey/i);
    expect(projection).toEqual({ status: 'paid', aggregateVersion: 1 });
  });
});
