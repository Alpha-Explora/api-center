const crypto = require('node:crypto');

function createCheckoutService({
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
}) {
  function normalizeLineItems(lineItems = []) {
    return lineItems.map((item) => {
      const amount = normalizeAmount(item.amount, item.currency || 'PHP');

      return {
        name: item.name,
        quantity: Number(item.quantity || 1),
        amount: amount.value,
        currency: amount.currency,
        description: item.description,
        images: item.images,
      };
    });
  }

  function totalLineItemAmount(lineItems = []) {
    return normalizeLineItems(lineItems).reduce(
      (sum, item) => sum + Number(item.amount || 0) * Number(item.quantity || 1),
      0,
    );
  }

  function toCheckoutSession(providerResponse, request) {
    const providerData = providerResponse?.data || {};
    const attributes = providerData.attributes || {};
    const paymentMethodsAllowed =
      attributes.payment_method_types ||
      attributes.payment_method_allowed ||
      request.paymentMethodsAllowed;
    const amount = request.amount
      ? normalizeAmount(request.amount, request.currency || 'PHP')
      : {
        value: attributes.amount || totalLineItemAmount(request.lineItems),
        currency: attributes.currency || request.currency || 'PHP',
      };

    return {
      checkoutId:
        providerData.id || `mock_checkout_${crypto.randomUUID().replace(/-/g, '')}`,
      provider: 'paymongo',
      status: mapCheckoutStatus(attributes.status),
      referenceId: request.referenceId,
      redirectUrl:
        attributes.checkout_url ||
        request.successUrl ||
        'https://checkout.paymongo.local/mock',
      expiresAt: attributes.expires_at
        ? new Date(attributes.expires_at * 1000).toISOString()
        : undefined,
      amount,
      paymentMethodsAllowed,
      metadata: request.metadata,
      providerData,
    };
  }

  function mapCheckoutStatus(status) {
    if (status === 'paid') {
      return 'paid';
    }

    if (status === 'expired') {
      return 'expired';
    }

    if (status === 'failed') {
      return 'failed';
    }

    return 'pending';
  }

  async function charge(chargeData, options = {}) {
    if (chargeData.mode === 'subscription') {
      throw providerDisabledError('Subscription checkout');
    }

    const paymentMethodsAllowed = resolvePaymentMethods(chargeData);
    const store = getPaymentStore();
    const tribeId = options.tribeId || chargeData.tribeId;

    if (store.enabled && !tribeId) {
      throw new PayMongoError(
        'A tribe context is required when payment persistence is enabled.',
        400,
      );
    }

    if (isMockMode()) {
      const session = toCheckoutSession(
        {
          data: {
            id: 'mock_checkout_001',
            attributes: {
              checkout_url: 'https://checkout.paymongo.local/mock_checkout_001',
              status: 'pending',
            },
          },
        },
        { ...chargeData, paymentMethodsAllowed },
      );

      await persistCheckoutSession(session, chargeData, {
        paymentMethodsAllowed,
        providerMetadata: { mock: true },
        tribeId,
      });

      return session;
    }

    const body = {
      data: {
        attributes: {
          line_items: normalizeLineItems(chargeData.lineItems),
          payment_method_types: paymentMethodsAllowed,
          success_url: chargeData.successUrl,
          cancel_url: chargeData.cancelUrl,
          description: chargeData.description,
          statement_descriptor: chargeData.statementDescriptor,
          send_email_receipt: Boolean(chargeData.sendEmailReceipt),
          show_description: chargeData.showDescription !== false,
          show_line_items: chargeData.showLineItems !== false,
          metadata: chargeData.metadata,
        },
      },
    };

    const response = await paymongoRequest('/checkout_sessions', {
      method: 'POST',
      body,
      idempotencyKey: options.idempotencyKey,
    });

    const session = toCheckoutSession(response, {
      ...chargeData,
      paymentMethodsAllowed,
    });
    await persistCheckoutSession(session, chargeData, {
      paymentMethodsAllowed,
      providerMetadata: response?.data || {},
      tribeId,
    });

    return session;
  }

  async function getCheckoutSession(checkoutId) {
    if (isMockMode()) {
      return toCheckoutSession(
        {
          data: {
            id: checkoutId,
            attributes: {
              checkout_url: `https://checkout.paymongo.local/${checkoutId}`,
              status: 'pending',
            },
          },
        },
        { referenceId: checkoutId, lineItems: [] },
      );
    }

    const response = await paymongoRequest(
      `/checkout_sessions/${encodeURIComponent(checkoutId)}`,
    );
    return toCheckoutSession(response, { referenceId: checkoutId, lineItems: [] });
  }

  async function getCheckoutStatus(checkoutId, options = {}) {
    const store = getPaymentStore();
    const stored = await store.getCheckoutSessionStatus(checkoutId);

    if (stored) {
      assertTribeCanRead(stored, options.tribeId);
      return stored;
    }

    if (store.enabled) {
      throw new PayMongoError(
        `Checkout session '${checkoutId}' was not found.`,
        404,
      );
    }

    return getCheckoutSession(checkoutId);
  }

  async function getCheckoutStatusByReference(referenceId, options = {}) {
    const store = getPaymentStore();

    if (!options.tribeId) {
      throw new PayMongoError(
        'A tribe context is required to look up checkout status by reference.',
        400,
      );
    }

    const stored = await store.getCheckoutSessionByReference(
      referenceId,
      options.tribeId,
    );
    if (stored) {
      return stored;
    }

    if (store.enabled) {
      throw new PayMongoError(
        `Checkout session for reference '${referenceId}' was not found.`,
        404,
      );
    }

    return null;
  }

  async function markCheckoutCancelled(checkoutId, options = {}) {
    const store = getPaymentStore();
    const reason = options.reason || 'user_returned_from_cancel_url';

    if (!store.enabled) {
      return {
        checkoutId,
        provider: 'paymongo',
        providerMode: providerMode(),
        status: 'cancelled',
        reason,
      };
    }

    const current = await store.getCheckoutSessionStatus(checkoutId);
    if (!current) {
      throw new PayMongoError(
        `Checkout session '${checkoutId}' was not found.`,
        404,
      );
    }

    assertTribeCanRead(current, options.tribeId);

    if (['paid', 'refunded', 'partially_refunded'].includes(current.status)) {
      throw new PayMongoError(
        `Checkout session '${checkoutId}' cannot be marked cancelled after status '${current.status}'.`,
        409,
      );
    }

    const updated = await store.updateCheckoutStatus(checkoutId, {
      status: 'cancelled',
      cancellationReason: reason,
    });

    return {
      ...updated,
      reason,
    };
  }

  return {
    charge,
    getCheckoutSession,
    getCheckoutStatus,
    getCheckoutStatusByReference,
    markCheckoutCancelled,
    normalizeLineItems,
    toCheckoutSession,
  };
}

module.exports = { createCheckoutService };
