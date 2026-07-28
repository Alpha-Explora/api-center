const crypto = require('node:crypto');
const {
  getPaymentStore,
  isPaymentStoreEnabled,
} = require('./paymentStore');
const { createCheckoutService } = require('./checkoutService');
const { paymongoRequest: providerRequest } = require('./providerClient');
const { createSubscriptionService } = require('./subscriptionService');
const { createWebhookService } = require('./webhookService');
const { toProviderId, toPublicId } = require('./paymentIds');

const DEFAULT_SUPPORTED_PAYMENT_METHODS = [
  'qrph',
  'gcash',
  'grab_pay',
  'paymaya',
  'card',
  'dob',
  'dob_ubp',
  'brankas_bdo',
  'brankas_landbank',
  'brankas_metrobank',
];

const PAYMENT_METHOD_ALIASES = {
  qr: ['qrph'],
  qrph: ['qrph'],
  'qr-ph': ['qrph'],
  gcash: ['gcash'],
  grabpay: ['grab_pay'],
  grab_pay: ['grab_pay'],
  maya: ['paymaya'],
  paymaya: ['paymaya'],
  card: ['card'],
  cards: ['card'],
  visa: ['card'],
  mastercard: ['card'],
  master_card: ['card'],
  'visa_mastercard': ['card'],
  'visa-mastercard': ['card'],
  dob: ['dob'],
  direct_online_banking: ['dob', 'dob_ubp', 'brankas_bdo', 'brankas_landbank', 'brankas_metrobank'],
  online_banking: ['dob', 'dob_ubp', 'brankas_bdo', 'brankas_landbank', 'brankas_metrobank'],
  brankas: ['brankas_bdo', 'brankas_landbank', 'brankas_metrobank'],
  dob_ubp: ['dob_ubp'],
  brankas_bdo: ['brankas_bdo'],
  brankas_landbank: ['brankas_landbank'],
  brankas_metrobank: ['brankas_metrobank'],
};

class PayMongoError extends Error {
  constructor(message, statusCode = 502, details) {
    super(message);
    this.name = 'PayMongoError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = details?.code;
  }
}

function providerDisabledError(feature = 'Subscriptions') {
  return new PayMongoError(
    `${feature} wrapper is not enabled. Set PAYMENT_SUBSCRIPTIONS_ENABLED=true after PayMongo subscription integration is verified.`,
    501,
    { code: 'SUBSCRIPTIONS_DISABLED' },
  );
}

function catalogDisabledError(feature = 'Payment catalog') {
  return new PayMongoError(
    `${feature} requires SHARED_SERVICES_DATABASE_ENABLED=true.`,
    501,
    { code: 'PAYMENT_CATALOG_DISABLED' },
  );
}

function notFoundError(resource, id) {
  return new PayMongoError(`${resource} '${id}' was not found.`, 404, {
    code: 'NOT_FOUND',
  });
}

function isMockMode() {
  if (process.env.PAYMENT_PROVIDER_MODE === 'mock') {
    return true;
  }

  return !process.env.PAYMENT_PROVIDER_MODE
    && !resolveSecretKey()
    && process.env.NODE_ENV !== 'production';
}

function providerMode() {
  return process.env.PAYMENT_PROVIDER_MODE === 'live' ? 'live' : 'test';
}

function resolveSecretKey() {
  if (providerMode() === 'live') {
    return process.env.PAYMONGO_LIVE_SECRET_KEY;
  }

  return process.env.PAYMONGO_TEST_SECRET_KEY;
}

function requireSecretKey() {
  const secretKey = resolveSecretKey();
  if (!secretKey) {
    const mode = providerMode();
    const expectedKey = mode === 'live' ? 'PAYMONGO_LIVE_SECRET_KEY' : 'PAYMONGO_TEST_SECRET_KEY';
    throw new PayMongoError(`${expectedKey} is required for PayMongo ${mode} mode.`, 500);
  }

  return secretKey;
}

function parsePaymentMethodList(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === 'string') {
    return rawValue
      .split(',')
      .map((method) => method.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizePaymentMethodName(method) {
  return String(method || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function expandPaymentMethods(methods) {
  const expanded = [];

  for (const method of methods) {
    const normalized = normalizePaymentMethodName(method);
    const aliases = PAYMENT_METHOD_ALIASES[normalized];

    if (!aliases) {
      throw new PayMongoError(
        `Unsupported PayMongo payment method: ${method}.`,
        400,
        {
          supportedPaymentMethods: DEFAULT_SUPPORTED_PAYMENT_METHODS,
          aliases: Object.keys(PAYMENT_METHOD_ALIASES).sort(),
        },
      );
    }

    expanded.push(...aliases);
  }

  return [...new Set(expanded)];
}

function configuredAllowedPaymentMethods() {
  const configured = parsePaymentMethodList(process.env.PAYMONGO_ALLOWED_PAYMENT_METHODS);
  return configured.length > 0
    ? expandPaymentMethods(configured)
    : DEFAULT_SUPPORTED_PAYMENT_METHODS;
}

function configuredDefaultPaymentMethods(allowedMethods) {
  const configured = parsePaymentMethodList(process.env.PAYMONGO_DEFAULT_PAYMENT_METHODS);
  if (configured.length === 0) {
    return allowedMethods;
  }

  return expandPaymentMethods(configured);
}

function resolvePaymentMethods(chargeData = {}) {
  const allowedMethods = configuredAllowedPaymentMethods();
  const requestedMethods = parsePaymentMethodList(
    chargeData.paymentMethods || chargeData.paymentMethodTypes,
  );
  const selectedMethods = requestedMethods.length > 0
    ? expandPaymentMethods(requestedMethods)
    : configuredDefaultPaymentMethods(allowedMethods);
  const disallowedMethods = selectedMethods.filter((method) => !allowedMethods.includes(method));

  if (disallowedMethods.length > 0) {
    throw new PayMongoError(
      `PayMongo payment method is not enabled: ${disallowedMethods.join(', ')}.`,
      400,
      {
        disallowedPaymentMethods: disallowedMethods,
        allowedPaymentMethods: allowedMethods,
      },
    );
  }

  return selectedMethods;
}

async function paymongoRequest(path, { method = 'GET', body, idempotencyKey } = {}) {
  return providerRequest(path, {
    method,
    body,
    idempotencyKey,
    requireSecretKey,
    PayMongoError,
  });
}

function normalizeAmount(amount, fallbackCurrency = 'PHP') {
  if (typeof amount === 'object' && amount !== null) {
    return {
      value: Number(amount.value),
      currency: amount.currency || fallbackCurrency,
    };
  }

  return {
    value: Number(amount),
    currency: fallbackCurrency,
  };
}

function toRefund(providerResponse, request) {
  const providerData = providerResponse?.data || {};
  const attributes = providerData.attributes || {};
  const amount = normalizeAmount(request.amount, request.currency || attributes.currency || 'PHP');

  return {
    refundId: providerData.id || `mock_refund_${crypto.randomUUID().replace(/-/g, '')}`,
    paymentId: toPublicId("pay", request.payment_id),
    provider: 'paymongo',
    status: attributes.status || 'succeeded',
    amount,
    reason: request.reason,
    referenceId: request.referenceId,
  };
}

function requirePaymentStore(feature) {
  const store = getPaymentStore();
  if (!store.enabled) {
    throw catalogDisabledError(feature);
  }

  return store;
}

function requireTribeContext(tribeId, resource) {
  if (!tribeId) {
    throw new PayMongoError(`A tribe context is required for ${resource}.`, 400);
  }
}

function generatedId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function createCustomer(payload, options = {}) {
  requireTribeContext(options.tribeId, 'payment customers');
  const store = requirePaymentStore('Payment customer catalog');
  return store.createCustomer({
    customerId: payload.customerId || generatedId('cus'),
    tribeId: options.tribeId,
    provider: 'paymongo',
    providerMode: providerMode(),
    environment: providerMode(),
    email: payload.email,
    phone: payload.phone,
    name: payload.name,
    metadata: payload.metadata || {},
  });
}

async function getCustomer(customerId, options = {}) {
  requireTribeContext(options.tribeId, 'payment customers');
  const store = requirePaymentStore('Payment customer catalog');
  const customer = await store.getCustomer(customerId, options.tribeId);
  if (!customer) {
    throw notFoundError('Customer', customerId);
  }

  return customer;
}

async function createProduct(payload, options = {}) {
  requireTribeContext(options.tribeId, 'payment products');
  const store = requirePaymentStore('Payment product catalog');
  if (!payload.name) {
    throw new PayMongoError('Product name is required.', 400);
  }

  return store.createProduct({
    productId: payload.productId || generatedId('prod'),
    tribeId: options.tribeId,
    environment: providerMode(),
    name: payload.name,
    description: payload.description,
    active: payload.active !== false,
    metadata: payload.metadata || {},
  });
}

async function getProduct(productId, options = {}) {
  requireTribeContext(options.tribeId, 'payment products');
  const store = requirePaymentStore('Payment product catalog');
  const product = await store.getProduct(productId, options.tribeId);
  if (!product) {
    throw notFoundError('Product', productId);
  }

  return product;
}

async function createPrice(payload, options = {}) {
  requireTribeContext(options.tribeId, 'payment prices');
  const store = requirePaymentStore('Payment price catalog');
  if (!payload.productId) {
    throw new PayMongoError('productId is required.', 400);
  }
  if (!payload.amount?.value || !payload.amount?.currency) {
    throw new PayMongoError('amount.value and amount.currency are required.', 400);
  }

  return store.createPrice({
    priceId: payload.priceId || generatedId('price'),
    tribeId: options.tribeId,
    environment: providerMode(),
    productId: payload.productId,
    amount: payload.amount,
    recurring: payload.recurring,
    active: payload.active !== false,
    metadata: payload.metadata || {},
  });
}

async function getPrice(priceId, options = {}) {
  requireTribeContext(options.tribeId, 'payment prices');
  const store = requirePaymentStore('Payment price catalog');
  const price = await store.getPrice(priceId, options.tribeId);
  if (!price) {
    throw notFoundError('Price', priceId);
  }

  return price;
}

async function getInvoice(invoiceId, options = {}) {
  requireTribeContext(options.tribeId, 'payment invoices');
  const store = requirePaymentStore('Payment invoices');
  const invoice = await store.getInvoice(invoiceId, options.tribeId);
  if (!invoice) {
    throw notFoundError('Invoice', invoiceId);
  }

  return invoice;
}

async function refund(refundData, options = {}) {
  const store = getPaymentStore();
  if (store.enabled) {
    requireTribeContext(options.tribeId, 'payment refunds');
  }

  if (isMockMode()) {
    return toRefund(
      {
        data: {
          id: 'mock_refund_001',
          attributes: {
            status: 'succeeded',
          },
        },
      },
      refundData,
    );
  }

  const amount = normalizeAmount(refundData.amount);
  const response = await paymongoRequest('/refunds', {
    method: 'POST',
    idempotencyKey: options.idempotencyKey,
    body: {
      data: {
        attributes: {
          amount: amount.value,
          payment_id: toProviderId("pay", refundData.payment_id),
          reason: refundData.reason || 'requested_by_customer',
          notes: refundData.notes,
          metadata: refundData.metadata,
        },
      },
    },
  });

  const result = toRefund(response, refundData);
  if (store.enabled) {
    await store.upsertRefund({
      tribeId: options.tribeId,
      environment: providerMode(),
      provider: 'paymongo',
      providerMode: providerMode(),
      refundId: result.refundId,
      paymentId: result.paymentId,
      status: result.status,
      amount: result.amount,
      currency: result.amount?.currency,
      reason: result.reason,
      providerMetadata: response?.data || {},
    });
  }

  return result;
}

function normalizePaymentIntent(response, request) {
  const providerData = response?.data || {};
  const attributes = providerData.attributes || {};
  const status = attributes.status === 'succeeded' ? 'succeeded'
    : ['failed', 'cancelled'].includes(attributes.status) ? attributes.status
      : 'pending';
  return {
    paymentIntentId: toPublicId("pi", providerData.id),
    referenceId: request.referenceId,
    status,
    amount: normalizeAmount(attributes.amount ?? request.amount, attributes.currency || request.amount?.currency || 'PHP'),
    aggregateVersion: 1,
  };
}

async function createPaymentIntent(payload, options = {}) {
  requireTribeContext(options.tribeId, 'payment intents');
  if (!payload?.referenceId || !payload?.amount) throw new PayMongoError('referenceId and amount are required.', 400);
  const response = await paymongoRequest('/payment_intents', {
    method: 'POST',
    idempotencyKey: options.idempotencyKey,
    body: { data: { attributes: {
      amount: Number(payload.amount.value),
      currency: payload.amount.currency || 'PHP',
      description: payload.description,
      customer_id: payload.customerId,
      metadata: { ...(payload.metadata || {}), referenceId: payload.referenceId },
    } } },
  });
  return normalizePaymentIntent(response, payload);
}

async function getPaymentIntent(paymentIntentId) {
  const response = await paymongoRequest(`/payment_intents/${encodeURIComponent(toProviderId("pi", paymentIntentId))}`);
  return normalizePaymentIntent(response, { referenceId: response?.data?.attributes?.metadata?.referenceId || paymentIntentId });
}

async function confirmPaymentIntent(paymentIntentId, payload = {}, options = {}) {
  const response = await paymongoRequest(`/payment_intents/${encodeURIComponent(toProviderId("pi", paymentIntentId))}/attach`, {
    method: 'POST', idempotencyKey: options.idempotencyKey,
    body: { data: { attributes: { payment_method: payload.paymentMethodId, return_url: payload.returnUrl } } },
  });
  return normalizePaymentIntent(response, { referenceId: payload.referenceId || paymentIntentId });
}

async function cancelPaymentIntent(paymentIntentId, options = {}) {
  const response = await paymongoRequest(`/payment_intents/${encodeURIComponent(toProviderId("pi", paymentIntentId))}/cancel`, {
    method: 'POST', idempotencyKey: options.idempotencyKey,
  });
  return normalizePaymentIntent(response, { referenceId: options.referenceId || paymentIntentId });
}

async function createPaymentMethodSetup(payload, options = {}) {
  requireTribeContext(options.tribeId, 'payment method setups');
  if (!payload?.customerId || !payload?.referenceId) throw new PayMongoError('customerId and referenceId are required.', 400);
  const response = await paymongoRequest('/payment_method_setups', {
    method: 'POST', idempotencyKey: options.idempotencyKey,
    body: { data: { attributes: {
      customer_id: payload.customerId,
      return_url: payload.returnUrl,
      metadata: { ...(payload.metadata || {}), referenceId: payload.referenceId },
    } } },
  });
  const providerData = response?.data || {};
  const attributes = providerData.attributes || {};
  return {
    setupId: toPublicId("setu", providerData.id),
    customerId: attributes.customer_id || payload.customerId,
    status: ['succeeded', 'failed'].includes(attributes.status) ? attributes.status : 'pending',
    ...(payload.returnUrl ? { returnUrl: payload.returnUrl } : {}),
  };
}
async function persistCheckoutSession(session, request, options = {}) {
  const store = getPaymentStore();
  if (!store.enabled) {
    return null;
  }

  const record = await store.createCheckoutSessionRecord({
    tribeId: options.tribeId,
    checkoutId: session.checkoutId,
    referenceId: session.referenceId,
    status: 'created',
    amount: session.amount,
    currency: session.amount?.currency || request.currency || 'PHP',
    provider: 'paymongo',
    providerMode: providerMode(),
    environment: providerMode(),
    redirectUrl: session.redirectUrl,
    successUrl: request.successUrl,
    cancelUrl: request.cancelUrl,
    description: request.description,
    metadata: request.metadata || {},
    providerMetadata: options.providerMetadata || {},
    expiresAt: session.expiresAt,
  })
  const consumerServiceId = request.metadata?.__apicenterConsumerServiceId
  if (record && options.tribeId && session.referenceId && consumerServiceId) {
    await store.enqueuePaymentEvent({
      environment: providerMode(),
      provider: 'paymongo',
      providerMode: providerMode(),
      providerEventId: `checkout_created:${session.checkoutId}`,
      eventType: 'payment.checkout.created',
      aggregateType: 'checkout',
      aggregateId: session.checkoutId,
      aggregateVersion: record.aggregateVersion || 1,
      ownerTribeId: options.tribeId,
      consumerServiceId,
      referenceId: session.referenceId,
      payload: {
        environment: providerMode(),
        status: 'created',
        ownerTribeId: options.tribeId,
        consumerServiceId,
        referenceId: session.referenceId,
        checkoutId: session.checkoutId,
        amount: session.amount ? { amountMinor: session.amount.value, currency: session.amount.currency } : undefined,
        occurredAt: new Date().toISOString(),
        aggregateVersion: record.aggregateVersion || 1,
      },
    })
  }
  return record;
}

function assertTribeCanRead(session, tribeId) {
  if (tribeId && session.tribeId && tribeId !== session.tribeId) {
    throw new PayMongoError('Checkout session does not belong to the requesting tribe.', 403);
  }
}

const {
  charge,
  getCheckoutSession,
  getCheckoutStatus,
  getCheckoutStatusByReference,
  markCheckoutCancelled,
} = createCheckoutService({
  PayMongoError,
  assertTribeCanRead,
  getPaymentStore,
  isMockMode,
  normalizeAmount,
  paymongoRequest,
  persistCheckoutSession,
  providerDisabledError,
  providerMode,
  resolvePaymentMethods,
});
const {
  webhook,
  verifyWebhookSignature,
} = createWebhookService({
  PayMongoError,
  getCheckoutSession,
  getPaymentStore,
  isMockMode,
  providerMode,
  resolveSecretKey,
});
const {
  cancelSubscription,
  changeSubscriptionPrice,
  createSubscription,
  getSubscription,
  getSubscriptionByReference,
  listSubscriptionInvoices,
  pauseSubscription,
  resumeSubscription,
} = createSubscriptionService({
  PayMongoError,
  generatedId,
  getPaymentStore,
  notFoundError,
  providerDisabledError,
  providerMode,
  requirePaymentStore,
  requireTribeContext,
});
module.exports = {
  PayMongoError,
  cancelPaymentIntent,
  confirmPaymentIntent,
  cancelSubscription,
  charge,
  changeSubscriptionPrice,
  createCustomer,
  createPaymentIntent,
  createPaymentMethodSetup,
  createPrice,
  createProduct,
  createSubscription,
  getCustomer,
  getPaymentIntent,
  getCheckoutSession,
  getCheckoutStatus,
  getCheckoutStatusByReference,
  getInvoice,
  getPrice,
  getProduct,
  getSubscription,
  getSubscriptionByReference,
  isPaymentStoreEnabled,
  listSubscriptionInvoices,
  markCheckoutCancelled,
  pauseSubscription,
  resolvePaymentMethods,
  refund,
  resumeSubscription,
  webhook,
  verifyWebhookSignature,
};
