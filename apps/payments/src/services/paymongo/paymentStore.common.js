const CANONICAL_PAYMENT_STATUSES = [
  'created',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
];

const CANONICAL_SUBSCRIPTION_STATUSES = [
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired',
];

function resolvePaymentEnvironment(entry = {}) {
  const environment = entry.environment || entry.apicenterEnvironment || entry.providerMode || 'test';
  if (environment !== 'test' && environment !== 'live') {
    throw new Error(`Unsupported payment environment: ${environment}.`);
  }

  return environment;
}

function rowToPayment(row) {
  return {
    id: row.id,
    tribeId: row.tribe_id,
    environment: row.environment,
    provider: row.provider,
    providerMode: row.provider_mode,
    paymentId: row.payment_id,
    checkoutId: row.checkout_id,
    referenceId: row.reference_id,
    status: row.status,
    amount: row.amount === null || row.amount === undefined
      ? undefined
      : { value: Number(row.amount), currency: row.currency || 'PHP' },
    currency: row.currency,
    paymentMethodType: row.payment_method_type,
    providerMetadata: row.provider_metadata || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    aggregateVersion: Number(row.aggregate_version || 1),
  };
}

function normalizeCheckoutEntry(entry) {
  assertCanonicalStatus(entry.status);
  const now = new Date().toISOString();
  const providerMode = entry.providerMode || 'test';

  return {
    provider: 'paymongo',
    providerMode,
    environment: resolvePaymentEnvironment({ ...entry, providerMode }),
    metadata: {},
    providerMetadata: {},
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
}

function normalizeCustomerEntry(entry) {
  const now = new Date().toISOString();
  const providerMode = entry.providerMode || 'test';

  return {
    provider: 'paymongo',
    providerMode,
    environment: resolvePaymentEnvironment({ ...entry, providerMode }),
    metadata: {},
    providerMetadata: {},
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
}

function normalizeProductEntry(entry) {
  const now = new Date().toISOString();
  return {
    active: true,
    environment: resolvePaymentEnvironment(entry),
    metadata: {},
    providerMetadata: {},
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
}

function normalizePriceEntry(entry) {
  const now = new Date().toISOString();
  return {
    active: true,
    environment: resolvePaymentEnvironment(entry),
    metadata: {},
    providerMetadata: {},
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
}

function normalizeSubscriptionEntry(entry) {
  assertCanonicalSubscriptionStatus(entry.status);
  const now = new Date().toISOString();
  const providerMode = entry.providerMode || 'test';

  return {
    provider: 'paymongo',
    providerMode,
    environment: resolvePaymentEnvironment({ ...entry, providerMode }),
    cancelAtPeriodEnd: false,
    metadata: {},
    providerMetadata: {},
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
}

function normalizeInvoiceEntry(entry) {
  const now = new Date().toISOString();
  const providerMode = entry.providerMode || 'test';

  return {
    provider: 'paymongo',
    providerMode,
    environment: resolvePaymentEnvironment({ ...entry, providerMode }),
    metadata: {},
    providerMetadata: {},
    createdAt: now,
    updatedAt: now,
    ...entry,
  };
}

function assertCanonicalStatus(status) {
  if (!CANONICAL_PAYMENT_STATUSES.includes(status)) {
    throw new Error(`Unsupported payment status: ${status}.`);
  }
}

function assertCanonicalSubscriptionStatus(status) {
  if (!CANONICAL_SUBSCRIPTION_STATUSES.includes(status)) {
    throw new Error(`Unsupported subscription status: ${status}.`);
  }
}

function tenantScoped(entry, tribeId) {
  if (!entry || (tribeId && entry.tribeId !== tribeId)) {
    return null;
  }

  return entry;
}

function rowToCheckout(row) {
  return {
    checkoutId: row.checkout_id,
    tribeId: row.tribe_id,
    environment: row.environment,
    referenceId: row.reference_id,
    status: row.status,
    amount: row.amount === null || row.amount === undefined
      ? undefined
      : { value: Number(row.amount), currency: row.currency || 'PHP' },
    currency: row.currency,
    provider: row.provider,
    providerMode: row.provider_mode,
    redirectUrl: row.redirect_url,
    successUrl: row.success_url,
    cancelUrl: row.cancel_url,
    description: row.description,
    metadata: row.metadata || {},
    providerMetadata: row.provider_metadata || {},
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    aggregateVersion: Number(row.aggregate_version || 1),
  };
}

function rowToCustomer(row) {
  return {
    customerId: row.customer_id,
    tribeId: row.tribe_id,
    environment: row.environment,
    provider: row.provider,
    providerMode: row.provider_mode,
    email: row.email,
    phone: row.phone,
    name: row.name,
    metadata: row.metadata || {},
    providerMetadata: row.provider_metadata || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

function rowToProduct(row) {
  return {
    productId: row.product_id,
    tribeId: row.tribe_id,
    environment: row.environment,
    name: row.name,
    description: row.description,
    active: row.active,
    metadata: row.metadata || {},
    providerMetadata: row.provider_metadata || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

function rowToPrice(row) {
  return {
    priceId: row.price_id,
    tribeId: row.tribe_id,
    environment: row.environment,
    productId: row.product_id,
    amount: row.amount === null || row.amount === undefined
      ? undefined
      : { value: Number(row.amount), currency: row.currency || 'PHP' },
    currency: row.currency,
    recurring: row.recurring_interval
      ? {
        interval: row.recurring_interval,
        intervalCount: Number(row.recurring_interval_count || 1),
        trialPeriodDays: row.trial_period_days === null || row.trial_period_days === undefined
          ? undefined
          : Number(row.trial_period_days),
      }
      : undefined,
    active: row.active,
    metadata: row.metadata || {},
    providerMetadata: row.provider_metadata || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
  };
}

function rowToSubscription(row) {
  return {
    subscriptionId: row.subscription_id,
    tribeId: row.tribe_id,
    environment: row.environment,
    provider: row.provider,
    providerMode: row.provider_mode,
    referenceId: row.reference_id,
    customerId: row.customer_id,
    priceId: row.price_id,
    status: row.status,
    currentPeriodStart: row.current_period_start ? new Date(row.current_period_start).toISOString() : undefined,
    currentPeriodEnd: row.current_period_end ? new Date(row.current_period_end).toISOString() : undefined,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    latestInvoiceId: row.latest_invoice_id,
    latestPaymentId: row.latest_payment_id,
    metadata: row.metadata || {},
    providerMetadata: row.provider_metadata || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    aggregateVersion: Number(row.aggregate_version || 1),
  };
}

function rowToInvoice(row) {
  return {
    invoiceId: row.invoice_id,
    tribeId: row.tribe_id,
    environment: row.environment,
    provider: row.provider,
    providerMode: row.provider_mode,
    subscriptionId: row.subscription_id,
    customerId: row.customer_id,
    status: row.status,
    amountDue: row.amount_due === null || row.amount_due === undefined
      ? undefined
      : { value: Number(row.amount_due), currency: row.currency || 'PHP' },
    amountPaid: row.amount_paid === null || row.amount_paid === undefined
      ? undefined
      : { value: Number(row.amount_paid), currency: row.currency || 'PHP' },
    currency: row.currency,
    dueAt: row.due_at ? new Date(row.due_at).toISOString() : undefined,
    paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : undefined,
    metadata: row.metadata || {},
    providerMetadata: row.provider_metadata || {},
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : undefined,
    aggregateVersion: Number(row.aggregate_version || 1),
  };
}

function webhookEventKey(event) {
  return [
    event.environment || event.apicenterEnvironment || event.providerMode || 'test',
    event.provider || 'paymongo',
    event.providerMode || 'test',
    event.eventId || event.providerEventId,
  ].join(':');
}

function referenceKey(referenceId, tribeId) {
  return `${tribeId}:${referenceId}`;
}
module.exports = {
  CANONICAL_PAYMENT_STATUSES,
  CANONICAL_SUBSCRIPTION_STATUSES,
  assertCanonicalStatus,
  assertCanonicalSubscriptionStatus,
  normalizeCheckoutEntry,
  normalizeCustomerEntry,
  normalizeInvoiceEntry,
  normalizePriceEntry,
  normalizeProductEntry,
  normalizeSubscriptionEntry,
  referenceKey,
  resolvePaymentEnvironment,
  rowToCheckout,
  rowToCustomer,
  rowToInvoice,
  rowToPayment,
  rowToPrice,
  rowToProduct,
  rowToSubscription,
  tenantScoped,
  webhookEventKey,
};