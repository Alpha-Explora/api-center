export function normalizeAmount(rawAmount: any, currency = 'PHP') {
  const value = Number(rawAmount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be a positive number.');
  }
  return {
    value,
    currency: currency.toUpperCase(),
  };
}

/** Payment success takes precedence over the checkout session's lifecycle status. */
export function checkoutPaymentStatus(attributes: any): 'paid' | 'pending' | 'expired' {
  const payments = [
    ...(Array.isArray(attributes.payments) ? attributes.payments : []),
    ...(Array.isArray(attributes.payment_intent?.attributes?.payments) ? attributes.payment_intent.attributes.payments : []),
  ];
  if (payments.some((payment) => payment?.type === 'payment' && typeof payment.id === 'string'
    && payment.id.startsWith('pay_') && payment.attributes?.status === 'paid')
    || attributes.payment_intent?.attributes?.status === 'succeeded') return 'paid';
  return attributes.status === 'expired' ? 'expired' : 'pending';
}
