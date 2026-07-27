const crypto = require('node:crypto');
const {
  extractPaymentFromCheckoutSession,
  extractPayMongoEvent,
} = require('./paymentEvents');
const { toAggregateSnapshot } = require('./paymentResourceMapper');

function createWebhookService({
  PayMongoError,
  getCheckoutSession,
  getPaymentStore,
  isMockMode,
  providerMode,
  resolveSecretKey,
}) {
  async function webhook(webhookPayload, options = {}) {
    const rawBody = options.rawBody || JSON.stringify(webhookPayload || {});
    const environment = resolveWebhookEnvironment(options.environment);
    verifyWebhookSignature(rawBody, options.signatureHeader, environment);

    const eventType = webhookPayload?.data?.attributes?.type || 'unknown';
    const extractedEvent = extractPayMongoEvent(webhookPayload, rawBody);
    const providerEvent = await enrichPaidCheckoutPayment({
      ...extractedEvent,
      environment,
    });
    const store = getPaymentStore();
    logWebhookExtract(providerEvent);

    const idempotency = await store.recordWebhookEvent({
      environment: providerEvent.environment,
      provider: providerEvent.provider,
      providerMode: providerEvent.providerMode,
      providerEventId: providerEvent.providerEventId,
      eventId: providerEvent.providerEventId,
      eventType,
      status: 'received',
      payloadHash: providerEvent.payloadHash,
      metadata: {
        environment: providerEvent.environment,
        lifecycleEventType: providerEvent.eventType,
        checkoutId: providerEvent.checkoutId,
        subscriptionId: providerEvent.subscriptionId,
        invoiceId: providerEvent.invoiceId,
        paymentId: providerEvent.paymentId,
        refundId: providerEvent.refundId,
      },
    });

    if (idempotency.duplicate && idempotency.status === 'processed') {
      logWebhookPersist(providerEvent, { duplicate: true, updatedState: {} });

      return {
        received: true,
        event: eventType,
        data: {
          eventType: providerEvent.eventType,
          status: providerEvent.status,
          checkoutId: providerEvent.checkoutId,
          subscriptionId: providerEvent.subscriptionId,
          invoiceId: providerEvent.invoiceId,
          paymentId: providerEvent.paymentId,
          refundId: providerEvent.refundId,
          updated: false,
          environment: providerEvent.environment,
          duplicate: true,
        },
      };
    }

    const updatedState = store.withTransaction
      ? await store.withTransaction(async (transaction) => {
        const state = await applyWebhookState(providerEvent, store, transaction);
        await enqueuePaymentEvent(providerEvent, state, transaction);
        await store.markWebhookEventProcessed(providerEvent.providerEventId, providerEvent.environment, transaction, providerEvent.providerMode);
        return state;
      })
      : await applyWebhookState(providerEvent, store);
    if (!store.withTransaction) {
      await enqueuePaymentEvent(providerEvent, updatedState);
      await store.markWebhookEventProcessed?.(providerEvent.providerEventId, providerEvent.environment, undefined, providerEvent.providerMode);
    }
    logWebhookPersist(providerEvent, {
      duplicate: false,
      updatedState,
    });

    return {
      received: true,
      event: eventType,
      data: {
        eventType: providerEvent.eventType,
        status: providerEvent.status,
        referenceId: providerEvent.referenceId
          || updatedState.updatedCheckout?.referenceId
          || updatedState.updatedSubscription?.referenceId,
        consumerServiceId: updatedState.updatedCheckout?.metadata?.__apicenterConsumerServiceId
          || updatedState.updatedSubscription?.metadata?.__apicenterConsumerServiceId,
        checkoutId: providerEvent.checkoutId,
        subscriptionId: providerEvent.subscriptionId,
        invoiceId: providerEvent.invoiceId,
        paymentId: providerEvent.paymentId,
        refundId: providerEvent.refundId,
        updated: Boolean(
          updatedState.updatedCheckout
            || updatedState.updatedSubscription
            || updatedState.updatedInvoice
            || updatedState.updatedPayment
            || updatedState.updatedRefund,
        ),
        environment: providerEvent.environment,
        duplicate: false,
      },
    };
  }

  async function enrichPaidCheckoutPayment(providerEvent) {
    if (
      providerEvent.paymentId
      || providerEvent.providerEventType !== 'checkout_session.payment.paid'
      || !providerEvent.checkoutId
      || !resolveSecretKey()
      || isMockMode()
    ) {
      return providerEvent;
    }

    const checkout = await getCheckoutSession(providerEvent.checkoutId);
    const payment = extractPaymentFromCheckoutSession(
      checkout.providerData || checkout,
    );
    if (!payment?.paymentId) {
      return providerEvent;
    }

    return {
      ...providerEvent,
      paymentId: payment.paymentId,
      amount: payment.amount ?? providerEvent.amount,
      currency: payment.currency || providerEvent.currency,
      paymentMethodType: payment.paymentMethodType || providerEvent.paymentMethodType,
      providerData: payment.providerData || providerEvent.providerData,
    };
  }

  function logWebhookExtract(providerEvent) {
    console.log(JSON.stringify({
      component: 'paymongo-webhook-extract',
      environment: providerEvent.environment,
      providerEventId: providerEvent.providerEventId,
      providerEventType: providerEvent.providerEventType,
      providerMode: providerEvent.providerMode,
      checkoutId: providerEvent.checkoutId,
      subscriptionId: providerEvent.subscriptionId,
      invoiceId: providerEvent.invoiceId,
      paymentIdSet: Boolean(providerEvent.paymentId),
      refundIdSet: Boolean(providerEvent.refundId),
      status: providerEvent.status,
    }));
  }

  function logWebhookPersist(providerEvent, { duplicate, updatedState = {} }) {
    console.log(JSON.stringify({
      component: 'paymongo-webhook-persist',
      environment: providerEvent.environment,
      duplicate: Boolean(duplicate),
      checkoutUpdated: Boolean(updatedState.updatedCheckout),
      subscriptionUpdated: Boolean(updatedState.updatedSubscription),
      invoiceUpdated: Boolean(updatedState.updatedInvoice),
      paymentIdSet: Boolean(providerEvent.paymentId),
      refundIdSet: Boolean(providerEvent.refundId),
    }));
  }

  async function enqueuePaymentEvent(providerEvent, updatedState, transaction) {
    const aggregateType = providerEvent.checkoutId
      ? 'checkout'
      : providerEvent.subscriptionId
        ? 'subscription'
        : providerEvent.invoiceId
          ? 'invoice'
          : providerEvent.paymentId
            ? 'payment'
            : providerEvent.refundId
              ? 'refund'
              : 'provider_event';
    const aggregateId = providerEvent.checkoutId
      || providerEvent.subscriptionId
      || providerEvent.invoiceId
      || providerEvent.paymentId
      || providerEvent.refundId
      || providerEvent.providerEventId;
    const referenceId = providerEvent.referenceId
      || updatedState.updatedCheckout?.referenceId
      || updatedState.updatedSubscription?.referenceId
      || updatedState.updatedInvoice?.referenceId
      || updatedState.updatedPayment?.referenceId
      || updatedState.updatedRefund?.referenceId;
    const consumerServiceId = updatedState.updatedCheckout?.metadata?.__apicenterConsumerServiceId
      || updatedState.updatedSubscription?.metadata?.__apicenterConsumerServiceId
      || updatedState.updatedInvoice?.providerMetadata?.__apicenterConsumerServiceId
      || updatedState.updatedPayment?.providerMetadata?.__apicenterConsumerServiceId
      || updatedState.updatedRefund?.providerMetadata?.__apicenterConsumerServiceId;
    const aggregateRecord = updatedState.updatedCheckout || updatedState.updatedSubscription || updatedState.updatedInvoice || updatedState.updatedPayment || updatedState.updatedRefund;
    const snapshot = toAggregateSnapshot(aggregateType, aggregateRecord || providerEvent);
    const amountValue = providerEvent.amount?.value ?? providerEvent.amount ?? updatedState.updatedCheckout?.amount?.value ?? updatedState.updatedPayment?.amount?.value;
    const amountCurrency = providerEvent.amount?.currency || providerEvent.currency || updatedState.updatedCheckout?.amount?.currency || updatedState.updatedPayment?.amount?.currency || 'PHP';
    const amount = snapshot.amount || (Number.isFinite(Number(amountValue)) && Number(amountValue) > 0
      ? { amountMinor: Math.round(Number(amountValue)), currency: amountCurrency }
      : undefined);
    const ownerTribeId = updatedState.updatedCheckout?.tribeId
      || updatedState.updatedSubscription?.tribeId
      || updatedState.updatedInvoice?.tribeId
      || updatedState.updatedPayment?.tribeId
      || updatedState.updatedRefund?.tribeId;
    const store = getPaymentStore();
    if (!ownerTribeId || !consumerServiceId || !referenceId) {
      console.error(JSON.stringify({
        component: 'payment-event-quarantine',
        providerEventId: providerEvent.providerEventId,
        environment: providerEvent.environment,
        reason: 'missing_owner_tribe_id_consumer_service_id_or_reference_id',
      }));
    }
    await store.enqueuePaymentEvent({
      environment: providerEvent.environment,
      provider: providerEvent.provider,
      providerMode: providerEvent.providerMode,
      providerEventId: providerEvent.providerEventId,
      eventType: providerEvent.eventType,
      aggregateType,
      aggregateId,
      aggregateVersion: snapshot.aggregateVersion || 1,
      payload: {
        environment: providerEvent.environment,
        eventType: providerEvent.eventType,
        status: providerEvent.status,
        ownerTribeId,
        referenceId,
        consumerServiceId,
        occurredAt: new Date().toISOString(),
        correlationId: providerEvent.providerEventId,
        amount,
        currency: amountCurrency,
        checkoutId: providerEvent.checkoutId,
        subscriptionId: providerEvent.subscriptionId,
        invoiceId: providerEvent.invoiceId,
        paymentId: providerEvent.paymentId,
        refundId: providerEvent.refundId,
        aggregateVersion: snapshot.aggregateVersion || 1,
        updated: Boolean(
          updatedState.updatedCheckout
            || updatedState.updatedSubscription
            || updatedState.updatedInvoice
            || updatedState.updatedPayment
            || updatedState.updatedRefund,
        ),
      },
    }, transaction);
  }
  async function applyWebhookState(providerEvent, store, transaction) {
    if (!providerEvent.status || !store.enabled) return {};

    let updatedCheckout = null;
    let updatedSubscription = null;
    let updatedInvoice = null;
    let updatedPayment = null;
    let updatedRefund = null;

    if (providerEvent.checkoutId) {
      updatedCheckout = await store.updateCheckoutStatus(providerEvent.checkoutId, {
        status: providerEvent.status,
        environment: providerEvent.environment,
      }, transaction);
    }

    if (providerEvent.paymentId) {
      updatedPayment = await store.upsertPayment({
        tribeId: updatedCheckout?.tribeId || 'unknown',
        provider: 'paymongo',
        providerMode: providerEvent.providerMode,
        environment: providerEvent.environment,
        paymentId: providerEvent.paymentId,
        checkoutId: providerEvent.checkoutId,
        referenceId: providerEvent.referenceId || updatedCheckout?.referenceId,
        status: providerEvent.status === 'paid' ? 'paid' : providerEvent.status,
        amount: providerEvent.amount,
        currency: providerEvent.currency,
        paymentMethodType: providerEvent.paymentMethodType,
        providerMetadata: providerEvent.providerData || {},
      }, transaction);
    }

    if (providerEvent.subscriptionId) {
      await store.recordSubscriptionEvent({
        provider: providerEvent.provider,
        providerMode: providerEvent.providerMode,
        environment: providerEvent.environment,
        providerEventId: providerEvent.providerEventId,
        subscriptionId: providerEvent.subscriptionId,
        eventType: providerEvent.eventType,
        status: providerEvent.status,
        metadata: {
          invoiceId: providerEvent.invoiceId,
          paymentId: providerEvent.paymentId,
          referenceId: providerEvent.referenceId,
        },
      }, transaction);

      const currentSubscription = await store.getSubscription(
        providerEvent.subscriptionId,
        undefined,
        providerEvent.environment,
        transaction,
      );
      if (providerEvent.eventType.startsWith('payment.subscription.')) {
        updatedSubscription = await store.updateSubscriptionStatus(
          providerEvent.subscriptionId,
          {
            status: providerEvent.status,
            environment: providerEvent.environment,
            latestInvoiceId: providerEvent.invoiceId,
            latestPaymentId: providerEvent.paymentId,
          },
          transaction,
        );
      } else if (currentSubscription) {
        updatedSubscription = await store.updateSubscriptionStatus(
          providerEvent.subscriptionId,
          {
            status: currentSubscription.status,
            environment: providerEvent.environment,
            latestInvoiceId: providerEvent.invoiceId,
            latestPaymentId: providerEvent.paymentId,
          },
          transaction,
        );
      }
    }

    if (providerEvent.invoiceId) {
      updatedInvoice = await store.createInvoice({
        tribeId: updatedSubscription?.tribeId || updatedCheckout?.tribeId || 'unknown',
        provider: providerEvent.provider,
        providerMode: providerEvent.providerMode,
        environment: providerEvent.environment,
        invoiceId: providerEvent.invoiceId,
        subscriptionId: providerEvent.subscriptionId,
        customerId: providerEvent.customerId || updatedSubscription?.customerId,
        status: providerEvent.status,
        amountDue: providerEvent.status === 'paid' ? undefined : {
          value: Number(providerEvent.amount || 0),
          currency: providerEvent.currency || 'PHP',
        },
        amountPaid: providerEvent.status === 'paid' ? {
          value: Number(providerEvent.amount || 0),
          currency: providerEvent.currency || 'PHP',
        } : undefined,
        currency: providerEvent.currency || 'PHP',
        providerMetadata: providerEvent.providerData || {},
      }, transaction);
    }

    if (providerEvent.refundId && providerEvent.paymentId) {
      updatedRefund = await store.upsertRefund({
        tribeId: updatedCheckout?.tribeId || 'unknown',
        provider: 'paymongo',
        providerMode: providerEvent.providerMode,
        environment: providerEvent.environment,
        refundId: providerEvent.refundId,
        paymentId: providerEvent.paymentId,
        status: providerEvent.status,
        amount: providerEvent.amount || 0,
        currency: providerEvent.currency,
        providerMetadata: providerEvent.providerData || {},
      }, transaction);
    }

    return { updatedCheckout, updatedSubscription, updatedInvoice, updatedPayment, updatedRefund };
  }
  function verifyWebhookSignature(rawBody, signatureHeader, environment = resolveWebhookEnvironment()) {
    const webhookSecret = resolveWebhookSecret(environment);

    if (
      !webhookSecret
      && process.env.NODE_ENV !== 'production'
      && (!process.env.PAYMENT_PROVIDER_MODE || process.env.PAYMENT_PROVIDER_MODE === 'mock')
    ) {
      return true;
    }

    if (!webhookSecret) {
      const expectedKey = environment === 'live'
        ? 'PAYMONGO_LIVE_WEBHOOK_SECRET'
        : 'PAYMONGO_TEST_WEBHOOK_SECRET';
      throw new PayMongoError(
        `${expectedKey} is required for webhook verification.`,
        500,
      );
    }

    const signatureParts = parseSignatureHeader(signatureHeader);
    const timestamp = signatureParts.t;
    const expectedMode = environment === 'live' ? 'li' : 'te';
    const providerSignature = signatureParts[expectedMode];

    if (!timestamp || !providerSignature) {
      throw new PayMongoError('Invalid PayMongo webhook signature header.', 401);
    }

    const computed = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(computed);
    const providerBuffer = Buffer.from(providerSignature);

    if (
      expectedBuffer.length !== providerBuffer.length
      || !crypto.timingSafeEqual(expectedBuffer, providerBuffer)
    ) {
      throw new PayMongoError('Invalid PayMongo webhook signature.', 401);
    }

    return true;
  }

  function resolveWebhookSecret(environment = resolveWebhookEnvironment()) {
    if (environment === 'live') {
      return process.env.PAYMONGO_LIVE_WEBHOOK_SECRET;
    }

    return process.env.PAYMONGO_TEST_WEBHOOK_SECRET;
  }

  function resolveWebhookEnvironment(environment = providerMode()) {
    if (environment === 'test' || environment === 'live') {
      return environment;
    }

    return providerMode() === 'live' ? 'live' : 'test';
  }

  function parseSignatureHeader(signatureHeader = '') {
    return String(signatureHeader)
      .split(',')
      .map((part) => part.trim().split('='))
      .reduce((parts, [key, value]) => {
        if (key) {
          parts[key] = value || '';
        }

        return parts;
      }, {});
  }

  return {
    webhook,
    verifyWebhookSignature,
  };
}

module.exports = { createWebhookService };


