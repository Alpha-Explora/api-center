import { checkoutPaymentStatus } from '../../../../apps/payments/src/features/checkout/checkout.model';

describe('PayMongo checkout payment status', () => {
  const payment = { id: 'pay_confirmed', type: 'payment', attributes: { status: 'paid' } };

  it.each(['active', 'expired'])('recognizes a paid payment in a %s checkout session', (status) => {
    expect(checkoutPaymentStatus({ status, payments: [payment] })).toBe('paid');
  });

  it('recognizes a succeeded payment intent and payments nested on the intent', () => {
    expect(checkoutPaymentStatus({ status: 'active', payment_intent: { attributes: { status: 'succeeded' } } })).toBe('paid');
    expect(checkoutPaymentStatus({ status: 'active', payment_intent: { attributes: { payments: [payment] } } })).toBe('paid');
  });

  it.each([
    {}, { status: 'active' }, { status: 'paid' },
    { status: 'active', payments: [{ ...payment, attributes: { status: 'failed' } }] },
    { status: 'active', payments: [{ ...payment, type: 'payment_method' }] },
    { status: 'active', payments: [{ ...payment, id: 'unrecognized' }] },
    { status: 'active', payments: {}, payment_intent: { attributes: { status: 'processing' } } },
  ])('does not confirm payment without payment evidence: %j', (attributes) => {
    expect(checkoutPaymentStatus(attributes)).toBe('pending');
  });

  it('preserves expiration when there is no confirmed payment', () => {
    expect(checkoutPaymentStatus({ status: 'expired', payments: [] })).toBe('expired');
  });
});
