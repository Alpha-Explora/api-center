const express = require('express');
const router = express.Router();
const {
  cancelPaymentIntent,
  confirmPaymentIntent,
  charge,
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
  listSubscriptionInvoices,
  markCheckoutCancelled,
  cancelSubscription,
  changeSubscriptionPrice,
  pauseSubscription,
  refund,
  resumeSubscription,
  webhook,
} = require('../services/paymongo');

function idempotencyKey(req) {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey;
}

function tribeId(req) {
  return req.get('X-Tribe-ID')
    || req.get('X-Tribe-Id')
    || req.get('X-API-Center-Tribe-ID')
    || req.body?.tribeId;
}
function apicenterEnvironment(req) {
  const environment = req.get('X-APICenter-Environment') || req.get('X-API-Center-Environment');
  if (!environment) return undefined;
  if (environment !== 'test' && environment !== 'live') {
    const error = new Error('X-APICenter-Environment must be test or live');
    error.statusCode = 400;
    error.code = 'INVALID_ENVIRONMENT';
    throw error;
  }
  return environment;
}


function sendError(res, err) {
  const status = err.statusCode || 502;
  return res.status(status).json({
    success: false,
    error: {
      code: err.code || err.details?.code || (status === 401
        ? 'INVALID_SIGNATURE'
        : status === 400
          ? 'INVALID_REQUEST'
          : 'PROVIDER_ERROR'),
      message: err.message || 'PayMongo request failed',
      details: err.details,
    },
  });
}

function logWebhookResult(result) {
  console.log(JSON.stringify({
    component: 'paymongo-webhook',
    event: result.event,
    eventType: result.data?.eventType,
    checkoutId: result.data?.checkoutId,
    paymentIdSet: Boolean(result.data?.paymentId),
    refundIdSet: Boolean(result.data?.refundId),
    duplicate: Boolean(result.data?.duplicate),
    updated: Boolean(result.data?.updated),
  }));
}

// Payment intents
router.post('/payment-intents', async (req, res) => {
  try {
    const result = await createPaymentIntent(req.body || {}, { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    res.status(201).json({ success: true, data: result });
  } catch (err) { sendError(res, err); }
});
router.get('/payment-intents/:paymentIntentId', async (req, res) => {
  try {
    const result = await getPaymentIntent(req.params.paymentIntentId);
    res.status(200).json({ success: true, data: result });
  } catch (err) { sendError(res, err); }
});
router.post('/payment-intents/:paymentIntentId/confirm', async (req, res) => {
  try {
    const result = await confirmPaymentIntent(req.params.paymentIntentId, req.body || {}, { idempotencyKey: idempotencyKey(req) });
    res.status(200).json({ success: true, data: result });
  } catch (err) { sendError(res, err); }
});
router.post('/payment-intents/:paymentIntentId/cancel', async (req, res) => {
  try {
    const result = await cancelPaymentIntent(req.params.paymentIntentId, { idempotencyKey: idempotencyKey(req) });
    res.status(200).json({ success: true, data: result });
  } catch (err) { sendError(res, err); }
});
router.post('/payment-method-setups', async (req, res) => {
  try {
    const result = await createPaymentMethodSetup(req.body || {}, { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    res.status(201).json({ success: true, data: result });
  } catch (err) { sendError(res, err); }
});
// POST /customers
router.post('/customers', async (req, res) => {
  try {
    const result = await createCustomer(req.body || {}, {
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /customers/:customerId
router.get('/customers/:customerId', async (req, res) => {
  try {
    const result = await getCustomer(req.params.customerId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /products
router.post('/products', async (req, res) => {
  try {
    const result = await createProduct(req.body || {}, {
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /products/:productId
router.get('/products/:productId', async (req, res) => {
  try {
    const result = await getProduct(req.params.productId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /prices
router.post('/prices', async (req, res) => {
  try {
    const result = await createPrice(req.body || {}, {
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /prices/:priceId
router.get('/prices/:priceId', async (req, res) => {
  try {
    const result = await getPrice(req.params.priceId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /checkout/sessions
router.post('/checkout/sessions', async (req, res) => {
  try {
    const { referenceId, successUrl, cancelUrl, lineItems, amount, currency, description } = req.body || {};

    if (!amount && (!Array.isArray(lineItems) || lineItems.length === 0)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'amount or at least one line item is required',
        },
      });
    }

    const key = idempotencyKey(req);
    if (!key) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header or idempotencyKey body field is required',
        },
      });
    }

    const result = await charge(req.body, {
      idempotencyKey: key,
      tribeId: tribeId(req),
    });
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /checkout/sessions/by-reference/:referenceId/status
router.get('/checkout/sessions/by-reference/:referenceId/status', async (req, res) => {
  try {
    const result = await getCheckoutStatusByReference(req.params.referenceId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /checkout/sessions/:checkoutId/status
router.get('/checkout/sessions/:checkoutId/status', async (req, res) => {
  try {
    const result = await getCheckoutStatus(req.params.checkoutId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /checkout/sessions/:checkoutId/cancelled
router.post('/checkout/sessions/:checkoutId/cancelled', async (req, res) => {
  try {
    const result = await markCheckoutCancelled(req.params.checkoutId, {
      tribeId: tribeId(req),
      reason: req.body?.reason,
    });
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /checkout/sessions/:checkoutId
router.get('/checkout/sessions/:checkoutId', async (req, res) => {
  try {
    const result = await getCheckoutSession(req.params.checkoutId);
    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /subscriptions
router.post('/subscriptions', async (req, res) => {
  try {
    const result = await createSubscription(req.body || {}, {
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /subscriptions/by-reference/:referenceId
router.get('/subscriptions/by-reference/:referenceId', async (req, res) => {
  try {
    const result = await getSubscriptionByReference(req.params.referenceId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /subscriptions/:subscriptionId/invoices
router.get('/subscriptions/:subscriptionId/invoices', async (req, res) => {
  try {
    const result = await listSubscriptionInvoices(req.params.subscriptionId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /subscriptions/:subscriptionId/cancel
router.post('/subscriptions/:subscriptionId/cancel', async (req, res) => {
  try {
    const result = await cancelSubscription(req.params.subscriptionId, req.body || {}, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /subscriptions/:subscriptionId/pause
router.post('/subscriptions/:subscriptionId/pause', async (req, res) => {
  try {
    const result = await pauseSubscription(req.params.subscriptionId, req.body || {}, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /subscriptions/:subscriptionId/resume
router.post('/subscriptions/:subscriptionId/resume', async (req, res) => {
  try {
    const result = await resumeSubscription(req.params.subscriptionId, req.body || {}, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /subscriptions/:subscriptionId/change-price
router.post('/subscriptions/:subscriptionId/change-price', async (req, res) => {
  try {
    const result = await changeSubscriptionPrice(req.params.subscriptionId, req.body || {}, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /subscriptions/:subscriptionId
router.get('/subscriptions/:subscriptionId', async (req, res) => {
  try {
    const result = await getSubscription(req.params.subscriptionId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// GET /invoices/:invoiceId
router.get('/invoices/:invoiceId', async (req, res) => {
  try {
    const result = await getInvoice(req.params.invoiceId, {
      tribeId: tribeId(req),
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /payments/:paymentId/refunds
router.post('/payments/:paymentId/refunds', async (req, res) => {
  try {
    if (!req.body?.amount) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'amount is required',
        },
      });
    }

    const key = idempotencyKey(req);
    if (!key) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency-Key header or idempotencyKey body field is required',
        },
      });
    }

    const result = await refund(
      { ...req.body, payment_id: req.params.paymentId },
      { idempotencyKey: key, tribeId: tribeId(req) },
    );
    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /webhooks
router.post('/webhooks', async (req, res) => {
  try {
    const result = await webhook(req.body, {
      rawBody: req.rawBody,
      signatureHeader: req.get('Paymongo-Signature'),
      environment: apicenterEnvironment(req),
    });
    logWebhookResult(result);
    res.status(200).json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
