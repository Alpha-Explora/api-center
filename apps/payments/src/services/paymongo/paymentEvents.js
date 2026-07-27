const crypto = require('node:crypto');

const PAYMONGO_TO_LIFECYCLE_EVENT = {
  'checkout_session.payment.paid': {
    eventType: 'payment.checkout.paid',
    status: 'paid',
  },
  'payment.paid': {
    eventType: 'payment.paid',
    status: 'paid',
  },
  'payment.failed': {
    eventType: 'payment.failed',
    status: 'failed',
  },
  'payment.refunded': {
    eventType: 'payment.refunded',
    status: 'refunded',
  },
  'payment.refund.updated': {
    eventType: 'payment.refund.updated',
    status: 'refunded',
  },
  'subscription.created': {
    eventType: 'payment.subscription.created',
    status: 'active',
  },
  'subscription.active': {
    eventType: 'payment.subscription.active',
    status: 'active',
  },
  'subscription.past_due': {
    eventType: 'payment.subscription.past_due',
    status: 'past_due',
  },
  'subscription.paused': {
    eventType: 'payment.subscription.paused',
    status: 'paused',
  },
  'subscription.cancelled': {
    eventType: 'payment.subscription.cancelled',
    status: 'cancelled',
  },
  'invoice.created': {
    eventType: 'payment.invoice.created',
    status: 'open',
  },
  'invoice.paid': {
    eventType: 'payment.invoice.paid',
    status: 'paid',
  },
  'invoice.failed': {
    eventType: 'payment.invoice.failed',
    status: 'failed',
  },
};

function extractPayMongoEvent(webhookPayload = {}, rawBody = '') {
  const data = webhookPayload.data || {};
  const attributes = data.attributes || {};
  const providerData = attributes.data || {};
  const providerAttributes = providerData.attributes || {};
  const mapping = mapPayMongoEvent(attributes.type);
  const nestedPayment = extractNestedPayment(providerAttributes);
  const nestedPaymentAttributes = nestedPayment?.attributes || {};

  return {
    provider: 'paymongo',
    providerEventId: data.id || hashEvent(rawBody || JSON.stringify(webhookPayload || {})),
    providerMode: attributes.livemode ? 'live' : 'test',
    providerEventType: attributes.type || 'unknown',
    eventType: mapping.eventType,
    status: mapping.status,
    checkoutId: extractCheckoutId(providerData, providerAttributes),
    subscriptionId: extractSubscriptionId(providerData, providerAttributes),
    invoiceId: extractInvoiceId(providerData, providerAttributes),
    customerId: extractCustomerId(providerData, providerAttributes),
    paymentId: extractPaymentId(providerData, providerAttributes, nestedPayment),
    refundId: extractRefundId(providerData, providerAttributes),
    referenceId: providerAttributes.reference_id || providerAttributes.reference_number,
    amount: nestedPaymentAttributes.amount ?? providerAttributes.amount,
    currency: nestedPaymentAttributes.currency || providerAttributes.currency || 'PHP',
    paymentMethodType: nestedPaymentAttributes.payment_method_type
      || nestedPaymentAttributes.source?.type
      || providerAttributes.payment_method_type,
    payloadHash: hashEvent(rawBody || JSON.stringify(webhookPayload || {})),
    providerData,
  };
}

function extractPaymentFromCheckoutSession(providerData = {}) {
  const providerAttributes = providerData.attributes || {};
  const nestedPayment = extractNestedPayment(providerAttributes);
  const nestedPaymentAttributes = nestedPayment?.attributes || {};

  if (!nestedPayment?.id) {
    return null;
  }

  return {
    paymentId: nestedPayment.id,
    amount: nestedPaymentAttributes.amount,
    currency: nestedPaymentAttributes.currency || providerAttributes.currency || 'PHP',
    paymentMethodType: nestedPaymentAttributes.payment_method_type
      || nestedPaymentAttributes.source?.type
      || providerAttributes.payment_method_type,
    providerData,
  };
}

function mapPayMongoEvent(providerEventType) {
  return PAYMONGO_TO_LIFECYCLE_EVENT[providerEventType] || {
    eventType: 'payment.provider_event.received',
    status: undefined,
  };
}

function extractCheckoutId(providerData = {}, providerAttributes = {}) {
  if (providerData.type === 'checkout_session') {
    return providerData.id;
  }

  return providerAttributes.checkout_id
    || providerAttributes.checkout_session_id
    || providerAttributes.checkout_session?.id;
}

function extractSubscriptionId(providerData = {}, providerAttributes = {}) {
  if (providerData.type === 'subscription') {
    return providerData.id;
  }

  return providerAttributes.subscription_id
    || providerAttributes.subscription?.id;
}

function extractInvoiceId(providerData = {}, providerAttributes = {}) {
  if (providerData.type === 'invoice') {
    return providerData.id;
  }

  return providerAttributes.invoice_id
    || providerAttributes.invoice?.id;
}

function extractCustomerId(providerData = {}, providerAttributes = {}) {
  if (providerData.type === 'customer') {
    return providerData.id;
  }

  return providerAttributes.customer_id
    || providerAttributes.customer?.id;
}

function extractPaymentId(providerData = {}, providerAttributes = {}, nestedPayment = null) {
  if (providerData.type === 'payment') {
    return providerData.id;
  }

  return providerAttributes.payment_id || providerAttributes.payment?.id || nestedPayment?.id;
}

function extractRefundId(providerData = {}, providerAttributes = {}) {
  if (providerData.type === 'refund') {
    return providerData.id;
  }

  return providerAttributes.refund_id || providerAttributes.refund?.id;
}

function hashEvent(rawBody) {
  return crypto.createHash('sha256').update(String(rawBody || '')).digest('hex');
}

function extractNestedPayment(providerAttributes = {}) {
  const payments = Array.isArray(providerAttributes.payments)
    ? providerAttributes.payments
    : [];

  for (const payment of payments) {
    const resource = unwrapResource(payment);
    if (resource?.type === 'payment' && resource.id) {
      return resource;
    }
  }

  return null;
}

function unwrapResource(resource) {
  if (resource && typeof resource === 'object' && resource.data && typeof resource.data === 'object') {
    return resource.data;
  }

  return resource;
}

module.exports = {
  extractPayMongoEvent,
  extractPaymentFromCheckoutSession,
  mapPayMongoEvent,
};
