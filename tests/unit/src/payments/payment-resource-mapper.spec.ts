const {
  toCheckoutSnapshot,
  toAggregateSnapshot,
} = require('../../../../apps/payments/src/services/paymongo/paymentResourceMapper');

describe('payment resource mapper', () => {
  it('maps a provider row to a stable checkout snapshot', () => {
    expect(toCheckoutSnapshot({
      checkout_id: 'chk_123',
      reference_id: 'order-123',
      status: 'paid',
      amount: 39900,
      currency: 'PHP',
      redirect_url: 'https://checkout.example.test/chk_123',
      aggregate_version: 2,
    })).toEqual({
      checkoutId: 'chk_123',
      referenceId: 'order-123',
      status: 'paid',
      amount: { amountMinor: 39900, currency: 'PHP' },
      aggregateVersion: 2,
      checkoutUrl: 'https://checkout.example.test/chk_123',
    });
  });

  it('maps each aggregate type without provider fields', () => {
    const snapshot = toAggregateSnapshot('refund', {
      refundId: 'ref_123',
      paymentId: 'pay_123',
      status: 'succeeded',
      amount: { value: 100, currency: 'PHP' },
      aggregateVersion: 3,
      providerMetadata: { raw: 'must-not-leak' },
    });
    expect(snapshot).toEqual({
      refundId: 'ref_123',
      paymentId: 'pay_123',
      status: 'succeeded',
      amount: { amountMinor: 100, currency: 'PHP' },
      aggregateVersion: 3,
    });
    expect(snapshot).not.toHaveProperty('providerMetadata');
  });
});