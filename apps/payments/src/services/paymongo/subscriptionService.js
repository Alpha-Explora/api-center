const crypto = require('node:crypto');

function createSubscriptionService({
  PayMongoError,
  generatedId,
  getPaymentStore,
  notFoundError,
  providerDisabledError,
  providerMode,
  requirePaymentStore,
  requireTribeContext,
}) {
  function subscriptionsEnabled() {
    return process.env.PAYMENT_SUBSCRIPTIONS_ENABLED === 'true';
  }

  function conflictError(message) {
    return new PayMongoError(message, 409, { code: 'CONFLICT' });
  }

  function hashIdempotencyKey(idempotencyKey) {
    return crypto
      .createHash('sha256')
      .update(String(idempotencyKey))
      .digest('hex');
  }

  function addBillingInterval(startMs, interval, intervalCount) {
    const date = new Date(startMs);
    const count = Number(intervalCount) || 1;

    if (interval === 'day') {
      date.setUTCDate(date.getUTCDate() + count);
    } else if (interval === 'week') {
      date.setUTCDate(date.getUTCDate() + count * 7);
    } else if (interval === 'year') {
      date.setUTCFullYear(date.getUTCFullYear() + count);
    } else {
      date.setUTCMonth(date.getUTCMonth() + count);
    }

    return date.toISOString();
  }

  async function createSubscription(payload, options = {}) {
    if (!subscriptionsEnabled()) {
      throw providerDisabledError('Subscriptions');
    }

    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    if (!options.idempotencyKey) {
      throw new PayMongoError(
        'Idempotency-Key header or idempotencyKey body field is required.',
        400,
        { code: 'IDEMPOTENCY_KEY_REQUIRED' },
      );
    }
    if (!payload.referenceId) {
      throw new PayMongoError('referenceId is required.', 400);
    }
    if (!payload.customerId) {
      throw new PayMongoError('customerId is required.', 400);
    }
    if (!payload.priceId) {
      throw new PayMongoError('priceId is required.', 400);
    }

    const customer = await store.getCustomer(payload.customerId, options.tribeId);
    if (!customer) {
      throw notFoundError('Customer', payload.customerId);
    }

    const price = await store.getPrice(payload.priceId, options.tribeId);
    if (!price) {
      throw notFoundError('Price', payload.priceId);
    }
    if (!price.recurring?.interval) {
      throw new PayMongoError('Subscriptions require a recurring price.', 400);
    }

    const idempotencyKeyHash = hashIdempotencyKey(options.idempotencyKey);
    const existing = await store.getSubscriptionByReference(
      payload.referenceId,
      options.tribeId,
    );
    if (existing) {
      if (existing.providerMetadata?.idempotencyKeyHash === idempotencyKeyHash) {
        return existing;
      }

      throw conflictError(
        `Subscription reference '${payload.referenceId}' already exists for this tribe.`,
      );
    }

    const now = Date.now();
    const trialPeriodDays = Number(
      payload.trialPeriodDays ?? price.recurring.trialPeriodDays ?? 0,
    );
    const periodStart = new Date(now).toISOString();
    const periodEnd = addBillingInterval(
      now,
      price.recurring.interval,
      price.recurring.intervalCount || 1,
    );
    const status = trialPeriodDays > 0 ? 'trialing' : 'active';

    return store.createSubscription({
      subscriptionId: payload.subscriptionId || generatedId('sub'),
      tribeId: options.tribeId,
      provider: 'paymongo',
      providerMode: providerMode(),
      referenceId: payload.referenceId,
      customerId: customer.customerId,
      priceId: price.priceId,
      status,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      metadata: payload.metadata || {},
      providerMetadata: {
        mode: 'api-center-local',
        idempotencyKeyHash,
        paymentSubscriptionsEnabled: true,
      },
    });
  }

  async function getSubscription(subscriptionId, options = {}) {
    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    const subscription = await store.getSubscription(
      subscriptionId,
      options.tribeId,
    );
    if (!subscription) {
      throw notFoundError('Subscription', subscriptionId);
    }

    return subscription;
  }

  async function getSubscriptionByReference(referenceId, options = {}) {
    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    const subscription = await store.getSubscriptionByReference(
      referenceId,
      options.tribeId,
    );
    if (!subscription) {
      throw notFoundError('Subscription reference', referenceId);
    }

    return subscription;
  }

  async function cancelSubscription(subscriptionId, payload = {}, options = {}) {
    if (!subscriptionsEnabled()) {
      throw providerDisabledError('Subscriptions');
    }

    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    const subscription = await store.getSubscription(
      subscriptionId,
      options.tribeId,
    );
    if (!subscription) {
      throw notFoundError('Subscription', subscriptionId);
    }

    const cancelAtPeriodEnd = payload.cancelAtPeriodEnd !== false;
    return store.updateSubscriptionStatus(subscriptionId, {
      status: cancelAtPeriodEnd ? subscription.status : 'cancelled',
      cancelAtPeriodEnd,
      metadata: {
        ...(subscription.metadata || {}),
        cancellationReason: payload.reason,
      },
    });
  }

  async function pauseSubscription(subscriptionId, _payload = {}, options = {}) {
    if (!subscriptionsEnabled()) {
      throw providerDisabledError('Subscriptions');
    }

    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    const subscription = await store.getSubscription(
      subscriptionId,
      options.tribeId,
    );
    if (!subscription) {
      throw notFoundError('Subscription', subscriptionId);
    }

    return store.updateSubscriptionStatus(subscriptionId, { status: 'paused' });
  }

  async function resumeSubscription(subscriptionId, _payload = {}, options = {}) {
    if (!subscriptionsEnabled()) {
      throw providerDisabledError('Subscriptions');
    }

    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    const subscription = await store.getSubscription(
      subscriptionId,
      options.tribeId,
    );
    if (!subscription) {
      throw notFoundError('Subscription', subscriptionId);
    }

    return store.updateSubscriptionStatus(subscriptionId, {
      status: 'active',
      cancelAtPeriodEnd: false,
    });
  }

  async function changeSubscriptionPrice(subscriptionId, payload = {}, options = {}) {
    if (!subscriptionsEnabled()) {
      throw providerDisabledError('Subscriptions');
    }

    requireTribeContext(options.tribeId, 'payment subscriptions');
    const store = requirePaymentStore('Payment subscriptions');
    const subscription = await store.getSubscription(
      subscriptionId,
      options.tribeId,
    );
    if (!subscription) {
      throw notFoundError('Subscription', subscriptionId);
    }
    if (!payload.priceId) {
      throw new PayMongoError('priceId is required.', 400);
    }

    const price = await store.getPrice(payload.priceId, options.tribeId);
    if (!price) {
      throw notFoundError('Price', payload.priceId);
    }
    if (!price.recurring?.interval) {
      throw new PayMongoError('Subscriptions require a recurring price.', 400);
    }

    return store.createSubscription({
      ...subscription,
      priceId: price.priceId,
      metadata: {
        ...(subscription.metadata || {}),
        ...(payload.metadata || {}),
      },
    });
  }

  async function listSubscriptionInvoices(subscriptionId, options = {}) {
    requireTribeContext(options.tribeId, 'payment subscription invoices');
    const store = requirePaymentStore('Subscription invoices');
    return store.listInvoicesForSubscription(subscriptionId, options.tribeId);
  }

  return {
    cancelSubscription,
    changeSubscriptionPrice,
    createSubscription,
    getSubscription,
    getSubscriptionByReference,
    listSubscriptionInvoices,
    pauseSubscription,
    resumeSubscription,
  };
}

module.exports = { createSubscriptionService };
