import { Request, Response } from 'express';
import { createSharedServiceApp } from '@apicenter/runtime';
import { CheckoutService } from './features/checkout/checkout.service';
import { PaymentIntentsService } from './features/payment-intents/payment-intents.service';
import { SubscriptionsService } from './features/subscriptions/subscriptions.service';
import { CustomersCatalogService } from './features/customers-catalog/customers-catalog.service';
import { RefundsService } from './features/refunds/refunds.service';
import { WebhooksService } from './features/webhooks/webhooks.service';
import { PayMongoError } from './shared/payment-errors';
import { providerMode } from './shared/paymongo-client';

const port = Number(process.env.PORT || 4010);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'apicenter-payments',
  health: {
    status: 'ok',
    service: 'apicenter-payments',
    architecture: 'enterprise-feature-sliced',
    providerMode: providerMode(),
  },
});

const checkoutService = new CheckoutService();
const paymentIntentsService = new PaymentIntentsService();
const subscriptionsService = new SubscriptionsService();
const catalogService = new CustomersCatalogService();
const refundsService = new RefundsService();
const webhooksService = new WebhooksService();

function idempotencyKey(req: Request): string | undefined {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey;
}

function tribeId(req: Request): string | undefined {
  return (
    req.get('X-Tribe-ID') ||
    req.get('X-Tribe-Id') ||
    req.get('X-API-Center-Tribe-ID') ||
    req.body?.tribeId
  );
}

function handleCustomError(res: Response, err: any) {
  const status = err.statusCode || 502;
  return fail(res, status, err.code || 'PROVIDER_ERROR', err.message || 'Payment processing failed', err.details);
}

// Payment Intents
app.post('/payment-intents', async (req: Request, res: Response) => {
  try {
    const data = await paymentIntentsService.createPaymentIntent(req.body || {}, {
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/payment-intents/:paymentIntentId', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const data = await paymentIntentsService.getPaymentIntent(paymentIntentId);
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/:paymentIntentId/confirm', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const data = await paymentIntentsService.confirmPaymentIntent(paymentIntentId, req.body || {}, { idempotencyKey: idempotencyKey(req) });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/:paymentIntentId/cancel', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const data = await paymentIntentsService.cancelPaymentIntent(paymentIntentId, { idempotencyKey: idempotencyKey(req) });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

// Checkout Sessions
app.post('/checkout/sessions', async (req: Request, res: Response) => {
  try {
    const key = idempotencyKey(req);
    if (!key) {
      return fail(res, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.');
    }
    const data = await checkoutService.charge(req.body || {}, { idempotencyKey: key, tribeId: tribeId(req) });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/:checkoutId', async (req: Request, res: Response) => {
  try {
    const checkoutId = Array.isArray(req.params.checkoutId) ? req.params.checkoutId[0] : req.params.checkoutId;
    const data = await checkoutService.getCheckoutSession(checkoutId);
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/:checkoutId/status', async (req: Request, res: Response) => {
  try {
    const checkoutId = Array.isArray(req.params.checkoutId) ? req.params.checkoutId[0] : req.params.checkoutId;
    const data = await checkoutService.getCheckoutStatus(checkoutId, { tribeId: tribeId(req) });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/by-reference/:referenceId/status', async (req: Request, res: Response) => {
  try {
    const referenceId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const data = await checkoutService.getCheckoutStatusByReference(referenceId, { tribeId: tribeId(req) });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/checkout/sessions/:checkoutId/cancelled', async (req: Request, res: Response) => {
  try {
    const checkoutId = Array.isArray(req.params.checkoutId) ? req.params.checkoutId[0] : req.params.checkoutId;
    const data = await checkoutService.markCheckoutCancelled(checkoutId, { tribeId: tribeId(req), reason: req.body?.reason });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

// Customers & Catalog
app.post('/customers', async (req: Request, res: Response) => {
  try {
    const data = await catalogService.createCustomer(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
    const data = await catalogService.getCustomer(customerId);
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/products', async (req: Request, res: Response) => {
  try {
    const data = await catalogService.createProduct(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/prices', async (req: Request, res: Response) => {
  try {
    const data = await catalogService.createPrice(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

// Subscriptions
app.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    const data = await subscriptionsService.createSubscription(req.body || {}, { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId;
    const data = await subscriptionsService.getSubscription(subscriptionId);
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/subscriptions/:subscriptionId/cancel', async (req: Request, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId;
    const data = await subscriptionsService.cancelSubscription(subscriptionId);
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

// Refunds
app.post('/payments/:paymentId/refunds', async (req: Request, res: Response) => {
  try {
    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    const data = await refundsService.refund({ ...req.body, paymentId }, { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

// Webhooks
app.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const data = await webhooksService.processWebhook(req.body || {}, { signatureHeader: req.get('Paymongo-Signature') });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[apicenter-payments] listening on port ${port}`);
  });
}

export { app };
