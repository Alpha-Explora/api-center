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

export type PaidCheckoutPayment = {
  paymentId: string;
  status: 'paid';
  amount: number;
  currency: string;
  paymentIntentId?: string;
};

/** Extracts only the provider facts needed to register a refundable paid payment owner. */
export function paidCheckoutPayment(attributes: any): PaidCheckoutPayment | undefined {
  const payments = [
    ...(Array.isArray(attributes.payments) ? attributes.payments : []),
    ...(Array.isArray(attributes.payment_intent?.attributes?.payments) ? attributes.payment_intent.attributes.payments : []),
  ].map((payment) => payment?.data ?? payment);
  const payment = payments.find((candidate) => candidate?.type === 'payment'
    && typeof candidate.id === 'string' && candidate.id.startsWith('pay_')
    && candidate.attributes?.status === 'paid');
  const amount = payment?.attributes?.amount;
  const currency = payment?.attributes?.currency;
  if (!payment || !Number.isSafeInteger(amount) || amount <= 0
    || typeof currency !== 'string' || !/^[a-z]{3}$/i.test(currency)) return undefined;
  const paymentIntentId = payment.attributes.payment_intent_id;
  return { paymentId: payment.id, status: 'paid', amount, currency: currency.toUpperCase(),
    ...(typeof paymentIntentId === 'string' && paymentIntentId.startsWith('pi_') ? { paymentIntentId } : {}) };
}

/** Payment success takes precedence over the checkout session's lifecycle status. */
export function checkoutPaymentStatus(attributes: any): 'paid' | 'pending' | 'expired' {
  const payments = [
    ...(Array.isArray(attributes.payments) ? attributes.payments : []),
    ...(Array.isArray(attributes.payment_intent?.attributes?.payments) ? attributes.payment_intent.attributes.payments : []),
  ].map((payment) => payment?.data ?? payment);
  if (payments.some((payment) => payment?.type === 'payment' && typeof payment.id === 'string'
    && payment.id.startsWith('pay_') && payment.attributes?.status === 'paid')
    || attributes.payment_intent?.attributes?.status === 'succeeded') return 'paid';
  return attributes.status === 'expired' ? 'expired' : 'pending';
}
