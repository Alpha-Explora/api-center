const { toPublicId } = require('./paymentIds');

function money(value, currency = 'PHP') {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object') {
    const amountMinor = value.amountMinor ?? value.value;
    if (amountMinor === undefined || amountMinor === null) return undefined;
    return { amountMinor: Number(amountMinor), currency: value.currency || currency };
  }
  return { amountMinor: Number(value), currency };
}

function publicId(kind, value) {
  return value ? toPublicId(kind, value) : value;
}

function version(record) {
  return Math.max(1, Number(record?.aggregateVersion ?? record?.aggregate_version ?? 1));
}

function toCheckoutSnapshot(record) {
  return {
    checkoutId: publicId('chk', record.checkoutId ?? record.checkout_id),
    referenceId: record.referenceId ?? record.reference_id,
    status: record.status,
    amount: money(record.amount, record.currency),
    aggregateVersion: version(record),
    ...(record.redirectUrl || record.redirect_url ? { checkoutUrl: record.redirectUrl ?? record.redirect_url } : {}),
  };
}

function toPaymentSnapshot(record) {
  return {
    paymentId: publicId('pay', record.paymentId ?? record.payment_id),
    checkoutId: publicId('chk', record.checkoutId ?? record.checkout_id),
    referenceId: record.referenceId ?? record.reference_id,
    status: record.status,
    amount: money(record.amount, record.currency),
    aggregateVersion: version(record),
  };
}

function toRefundSnapshot(record) {
  return {
    refundId: publicId('ref', record.refundId ?? record.refund_id),
    paymentId: publicId('pay', record.paymentId ?? record.payment_id),
    status: record.status,
    amount: money(record.amount, record.currency),
    aggregateVersion: version(record),
  };
}

function toSubscriptionSnapshot(record) {
  return {
    subscriptionId: publicId('sub', record.subscriptionId ?? record.subscription_id),
    customerId: publicId('cus', record.customerId ?? record.customer_id),
    referenceId: record.referenceId ?? record.reference_id,
    status: record.status,
    currentPeriodEnd: record.currentPeriodEnd ?? record.current_period_end,
    aggregateVersion: version(record),
  };
}

function toInvoiceSnapshot(record) {
  return {
    invoiceId: publicId('inv', record.invoiceId ?? record.invoice_id),
    subscriptionId: publicId('sub', record.subscriptionId ?? record.subscription_id),
    status: record.status,
    amount: money(record.amount ?? record.amountPaid ?? record.amountDue, record.currency),
    aggregateVersion: version(record),
  };
}

function toAggregateSnapshot(aggregateType, record) {
  if (aggregateType === 'checkout') return toCheckoutSnapshot(record);
  if (aggregateType === 'payment') return toPaymentSnapshot(record);
  if (aggregateType === 'refund') return toRefundSnapshot(record);
  if (aggregateType === 'subscription') return toSubscriptionSnapshot(record);
  if (aggregateType === 'invoice') return toInvoiceSnapshot(record);
  return { aggregateVersion: version(record), status: record?.status };
}

module.exports = {
  money,
  toCheckoutSnapshot,
  toPaymentSnapshot,
  toRefundSnapshot,
  toSubscriptionSnapshot,
  toInvoiceSnapshot,
  toAggregateSnapshot,
};