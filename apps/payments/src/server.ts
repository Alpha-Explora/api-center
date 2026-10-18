import { Request, Response } from 'express';
import { createSharedServiceApp } from '@apicenter/runtime';
import { CheckoutService } from './features/checkout/checkout.service';
import { PaymentIntentsService } from './features/payment-intents/payment-intents.service';
import { SubscriptionsService } from './features/subscriptions/subscriptions.service';
import { CustomersCatalogService } from './features/customers-catalog/customers-catalog.service';
import { RefundsService } from './features/refunds/refunds.service';
import { WebhooksService } from './features/webhooks/webhooks.service';
import { InvoicesService } from './features/invoices/invoices.service';
import { PaymentLinksService, QrPhService } from './features/payment-links/payment-links.service';
import { PayMongoError } from './shared/payment-errors';
import { isMockMode, providerMode } from './shared/paymongo-client';
import { timingSafeEqual } from 'node:crypto';
import { OwnerRecord, PaymentContext, PaymentOwnerStore, PaymentRecordFilters } from './shared/payment-owner-store';

const port = Number(process.env.PORT || 4010);
const { app, ok, fail } = createSharedServiceApp({
  serviceId: 'apicenter-payments',
  jsonOptions: { verify: (req: Request & { rawBody?: Buffer }, _res: Response, buf: Buffer) => { req.rawBody = Buffer.from(buf); } },
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
const invoicesService = new InvoicesService();
const paymentLinksService = new PaymentLinksService();
const qrPhService = new QrPhService();
const owners = PaymentOwnerStore.getInstance();

function recordFilters(query: Request['query']): PaymentRecordFilters {
  const one = (key: string): string | undefined => {
    const value = query[key];
    return typeof value === 'string' && value.length ? value : undefined;
  };
  const type = one('type');
  const status = one('status');
  const createdAfter = one('createdAfter');
  const createdBefore = one('createdBefore');
  const rawLimit = one('limit');
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (rawLimit !== undefined && (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 200)) {
    throw new PayMongoError('limit must be an integer from 1 to 200', 400, 'INVALID_LIMIT');
  }
  for (const [name, value] of [['createdAfter', createdAfter], ['createdBefore', createdBefore]] as const) {
    if (value && (!Number.isFinite(Date.parse(value)) || !/^\d{4}-\d\d-\d\dT/.test(value))) {
      throw new PayMongoError(`${name} must be an ISO 8601 timestamp`, 400, 'INVALID_DATE_FILTER');
    }
  }
  if (createdAfter && createdBefore && Date.parse(createdAfter) >= Date.parse(createdBefore)) {
    throw new PayMongoError('createdAfter must be earlier than createdBefore', 400, 'INVALID_DATE_FILTER');
  }
  if (type && !/^[a-z][a-z0-9_-]{0,63}$/.test(type)) throw new PayMongoError('Invalid type filter', 400, 'INVALID_TYPE_FILTER');
  if (status && !/^[a-z][a-z0-9_-]{0,63}$/i.test(status)) throw new PayMongoError('Invalid status filter', 400, 'INVALID_STATUS_FILTER');
  return { type, status, createdAfter, createdBefore, limit, cursor: one('cursor') };
}

function paymentContext(req: Request): PaymentContext {
  const tribeId = req.get('X-APICenter-Owner-Tribe-ID');
  const projectId = req.get('X-APICenter-Project-ID');
  const consumerServiceId = req.get('X-APICenter-Consumer-Service-ID');
  const environment = req.get('X-APICenter-Environment');
  if (!tribeId || !projectId || !consumerServiceId || (environment !== 'test' && environment !== 'live')) {
    throw new PayMongoError('Trusted payment context is required', 401, 'UNAUTHORIZED');
  }
  return { tribeId, projectId, consumerServiceId, environment };
}

app.use((req: Request, res: Response, next) => {
  const expected = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
  const presented = req.path === '/webhooks'
    ? req.get('X-APICenter-Internal-Token')
    : req.get('Authorization')?.replace(/^Bearer /, '');
  if (!expected || !presented || presented.length !== expected.length
    || !timingSafeEqual(Buffer.from(presented), Buffer.from(expected))) {
    return fail(res, 401, 'UNAUTHORIZED', 'Payment runtime token is required');
  }
  try {
    if (req.path === '/webhooks') {
      const mode = process.env.PAYMENT_PROVIDER_MODE;
      if ((mode === 'test' || mode === 'live') && req.get('X-APICenter-Environment') !== mode) {
        return fail(res, 403, 'ENVIRONMENT_MISMATCH', 'Payment environment does not match runtime');
      }
      return next();
    }
    const context = paymentContext(req);
    const mode = process.env.PAYMENT_PROVIDER_MODE;
    if ((mode === 'test' || mode === 'live') && context.environment !== mode) {
      return fail(res, 403, 'ENVIRONMENT_MISMATCH', 'Payment environment does not match runtime');
    }
    return next();
  } catch (error) { return handleCustomError(res, error); }
});

async function remember(type: string, id: string, req: Request, snapshot: Record<string, unknown>,
  providerReference?: string) {
  const context = paymentContext(req);
  await owners.save({ ...context, resourceType: type, resourceId: id,
    referenceId: typeof req.body?.referenceId === 'string' ? req.body.referenceId : undefined,
    providerReference, snapshot });
}

async function owned(type: string, id: string, req: Request) {
  return owners.assertOwned(type, id, paymentContext(req));
}

async function checkoutSnapshot(owner: OwnerRecord) {
  const record = owner.snapshot.status === 'paid' || isMockMode() ? owner
    : await owners.reconcileCheckout(owner.resourceId, owner,
      await checkoutService.getCheckoutSession(owner.resourceId));
  return { ...record.snapshot, aggregateVersion: record.aggregateVersion };
}

function idempotencyKey(req: Request): string | undefined {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey;
}

function tribeId(req: Request): string | undefined {
  return paymentContext(req).tribeId;
}

function handleCustomError(res: Response, err: any) {
  const status = err.statusCode || 502;
  return fail(res, status, err.code || 'PROVIDER_ERROR', err.message || 'Payment processing failed', err.details);
}

app.get('/payments/records', async (req: Request, res: Response) => {
  try {
    return ok(res, await owners.listRecords(paymentContext(req), recordFilters(req.query)));
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/admin/payments/records', async (req: Request, res: Response) => {
  try {
    const context = paymentContext(req);
    return ok(res, await owners.listRecords(context, recordFilters(req.query)));
  } catch (err) { return handleCustomError(res, err); }
});

// Payment Intents
app.post('/payment-intents', async (req: Request, res: Response) => {
  try {
    const data = await paymentIntentsService.createPaymentIntent(req.body || {}, {
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    const snapshot = { ...data, referenceId: req.body?.referenceId };
    await remember('intent', data.paymentIntentId, req, snapshot);
    return ok(res, snapshot, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/qrph', async (req: Request, res: Response) => {
  try {
    const data = await qrPhService.create(req.body || {}, idempotencyKey(req));
    const snapshot = { ...data, referenceId: req.body?.referenceId };
    await remember('intent', data.paymentIntentId, req, snapshot);
    return ok(res, snapshot, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/payment-intents/:paymentIntentId', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const owner = await owned('intent', paymentIntentId, req);
    const data = await paymentIntentsService.getPaymentIntent(paymentIntentId);
    return ok(res, { ...owner.snapshot, ...data });
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/:paymentIntentId/confirm', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const owner = await owned('intent', paymentIntentId, req);
    const data = await paymentIntentsService.confirmPaymentIntent(paymentIntentId, req.body || {}, { idempotencyKey: idempotencyKey(req) });
    const snapshot = { ...owner.snapshot, ...data };
    await remember('intent', paymentIntentId, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/:paymentIntentId/cancel', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const owner = await owned('intent', paymentIntentId, req);
    const data = await paymentIntentsService.cancelPaymentIntent(paymentIntentId, { idempotencyKey: idempotencyKey(req) });
    const snapshot = { ...owner.snapshot, ...data };
    await remember('intent', paymentIntentId, req, snapshot);
    return ok(res, snapshot);
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
    await remember('checkout', data.checkoutId, req, data);
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/:checkoutId', async (req: Request, res: Response) => {
  try {
    const checkoutId = Array.isArray(req.params.checkoutId) ? req.params.checkoutId[0] : req.params.checkoutId;
    const owner = await owned('checkout', checkoutId, req);
    return ok(res, await checkoutSnapshot(owner));
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/:checkoutId/status', async (req: Request, res: Response) => {
  try {
    const checkoutId = Array.isArray(req.params.checkoutId) ? req.params.checkoutId[0] : req.params.checkoutId;
    const owner = await owned('checkout', checkoutId, req);
    return ok(res, await checkoutSnapshot(owner));
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/by-reference/:referenceId/status', async (req: Request, res: Response) => {
  try {
    const referenceId = Array.isArray(req.params.referenceId) ? req.params.referenceId[0] : req.params.referenceId;
    const owner = await owners.findByReference('checkout', referenceId, paymentContext(req));
    return ok(res, await checkoutSnapshot(owner));
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/checkout/sessions/by-reference/:referenceId', async (req: Request, res: Response) => {
  try {
    const referenceId = String(req.params.referenceId);
    const owner = await owners.findByReference('checkout', referenceId, paymentContext(req));
    return ok(res, await checkoutSnapshot(owner));
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/checkout/sessions/:checkoutId/cancelled', async (req: Request, res: Response) => {
  try {
    const checkoutId = Array.isArray(req.params.checkoutId) ? req.params.checkoutId[0] : req.params.checkoutId;
    await owned('checkout', checkoutId, req);
    const data = await checkoutService.markCheckoutCancelled(checkoutId, { tribeId: tribeId(req), reason: req.body?.reason,
      idempotencyKey: idempotencyKey(req) });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/checkout/sessions/:checkoutId/cancel', async (req: Request, res: Response) => {
  try {
    const checkoutId = String(req.params.checkoutId);
    const owner = await owned('checkout', checkoutId, req);
    const data = await checkoutService.markCheckoutCancelled(checkoutId, { tribeId: tribeId(req), reason: req.body?.reason,
      idempotencyKey: idempotencyKey(req) });
    const snapshot = { ...owner.snapshot, ...data };
    await remember('checkout', checkoutId, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

// Customers & Catalog
app.post('/customers', async (req: Request, res: Response) => {
  try {
    const data = await catalogService.createCustomer(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    const snapshot = { ...data, customerReference: req.body?.customerReference };
    await remember('customer', data.customerId, req, snapshot);
    return ok(res, snapshot, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
    const owner = await owned('customer', customerId, req);
    const data = await catalogService.getCustomer(customerId);
    return ok(res, { ...owner.snapshot, ...data });
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/plans', async (req: Request, res: Response) => {
  try {
    const data = await catalogService.createPlan(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    await remember('plan', data.planId, req, data);
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/plans', async (req: Request, res: Response) => {
  try {
    return ok(res, await owners.listOwned(paymentContext(req), 'plan'));
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/plans/:planId', async (req: Request, res: Response) => {
  try {
    const planId = Array.isArray(req.params.planId) ? req.params.planId[0] : req.params.planId;
    const owner = await owned('plan', planId, req);
    const data = await catalogService.getPlan(planId);
    return ok(res, { ...owner.snapshot, ...data });
  } catch (err) { return handleCustomError(res, err); }
});

// Payment Links
app.post('/payment-links', async (req: Request, res: Response) => {
  try {
    const data = await paymentLinksService.create(req.body || {}, idempotencyKey(req));
    const snapshot = { ...data, referenceId: req.body?.referenceId };
    await remember('payment_link', data.paymentLinkId, req, snapshot, data.referenceNumber);
    return ok(res, snapshot, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/payment-links', async (req: Request, res: Response) => {
  try { return ok(res, await owners.listOwned(paymentContext(req), 'payment_link')); }
  catch (err) { return handleCustomError(res, err); }
});

app.get('/payment-links/:paymentLinkId', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.paymentLinkId);
    const owner = await owned('payment_link', id, req);
    const data = await paymentLinksService.get(id);
    return ok(res, { ...owner.snapshot, ...data, ...(owner.snapshot.status === 'paid' ? { status: 'paid' } : {}) });
  } catch (err) { return handleCustomError(res, err); }
});

app.patch('/payment-links/:paymentLinkId', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.paymentLinkId);
    const owner = await owned('payment_link', id, req);
    const data = await paymentLinksService.setArchived(id, req.body?.archive, idempotencyKey(req));
    const snapshot = { ...owner.snapshot, ...data, referenceId: owner.referenceId,
      ...(owner.snapshot.status === 'paid' ? { status: 'paid' } : {}) };
    await remember('payment_link', id, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

// Subscriptions
app.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    await owned('customer', req.body?.customerId, req);
    await owned('plan', req.body?.planId, req);
    const data = await subscriptionsService.createSubscription(req.body || {}, { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    await remember('subscription', data.subscriptionId, req, data);
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId;
    const owner = await owned('subscription', subscriptionId, req);
    const data = await subscriptionsService.getSubscription(subscriptionId);
    return ok(res, { ...owner.snapshot, ...data });
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/subscriptions/:subscriptionId/cancel', async (req: Request, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId;
    const owner = await owned('subscription', subscriptionId, req);
    const data = await subscriptionsService.cancelSubscription(subscriptionId, { idempotencyKey: idempotencyKey(req) });
    const snapshot = { ...owner.snapshot, ...data };
    await remember('subscription', subscriptionId, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/subscriptions/:subscriptionId/invoices', async (req: Request, res: Response) => {
  try {
    const subscriptionId = String(req.params.subscriptionId);
    await owned('subscription', subscriptionId, req);
    const invoices = await invoicesService.listForSubscription(subscriptionId);
    for (const invoice of invoices) await remember('invoice', invoice.invoiceId, req, invoice);
    return ok(res, invoices);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/invoices/:invoiceId', async (req: Request, res: Response) => {
  try {
    const invoiceId = String(req.params.invoiceId);
    const owner = await owned('invoice', invoiceId, req);
    const invoice = await invoicesService.get(invoiceId);
    return ok(res, { ...owner.snapshot, ...invoice });
  } catch (err) { return handleCustomError(res, err); }
});

// Refunds
app.post('/payments/:paymentId/refunds', async (req: Request, res: Response) => {
  try {
    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    await owned('payment', paymentId, req);
    const data = await refundsService.refund({ ...req.body, paymentId }, { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    await remember('refund', data.refundId, req, data);
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/refunds/:refundId', async (req: Request, res: Response) => {
  try {
    const refundId = String(req.params.refundId);
    const owner = await owned('refund', refundId, req);
    const record = isMockMode() ? owner
      : await owners.reconcileRefund(refundId, paymentContext(req), await refundsService.getRefund(refundId));
    return ok(res, { ...record.snapshot, aggregateVersion: record.aggregateVersion });
  } catch (err) { return handleCustomError(res, err); }
});

// Webhooks
app.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const data = await webhooksService.processWebhook(req.body || {}, {
      signatureHeader: req.get('Paymongo-Signature'),
      rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
      environment: req.get('X-APICenter-Environment'),
    });
    return ok(res, data);
  } catch (err) { return handleCustomError(res, err); }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[apicenter-payments] listening on port ${port}`);
  });
}

export { app };
