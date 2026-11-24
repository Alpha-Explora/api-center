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
import { PROVIDER_CODE_SUNSET } from './shared/provider-errors';
import type { PaymentResourceType } from './shared/payment-id-map';
import { readPaymentContext } from './shared/payment-context';
import { hasPayMongoTestCredentials, isMockMode, providerMode } from './shared/paymongo-client';
import { timingSafeEqual } from 'node:crypto';
import { OwnerRecord, PaymentContext, PaymentOwnerStore, PaymentRecordFilters } from './shared/payment-owner-store';
import { PaymentReplayStore } from './events/paymentReplayStore';
import { createPaymentEventPool, drainPaymentEventOutbox } from './events/paymentEventDispatcher';
import { z } from 'zod';
import { attachAllocations, parseAllocations, validateAllocations, type AllocationInput, type PaidResource } from './features/payouts/allocations';
import { createCollectionRouting } from './features/linked-accounts/collection-routing';
import { createChildWebhookSecretLookup } from './features/linked-accounts/child-webhook-secret';
import { LinkedAccountOnboarding } from './features/linked-accounts/linked-account-onboarding';
import { LinkedAccountStore } from './features/linked-accounts/linked-account-store';
import { FakeLinkedAccountsProvider, type ConsumerDetails, type MerchantDetails } from './features/linked-accounts/linked-accounts-provider';
import { registerPayeeOnboardingRoutes } from './features/linked-accounts/payee-onboarding.routes';
import { PayMongoLinkedAccountsSandbox } from './features/linked-accounts/paymongo-linked-accounts-provider';
import { registerLinkedAccountRoutes } from './features/linked-accounts/linked-accounts.routes';
import { createLinkedAccountsSwitch } from './features/linked-accounts/linked-accounts-switch';
import type { Environment } from './features/payouts/payout-store';
import { hasPaymentEventTopic } from './events/pubsubPublisher';
import { createPayoutsFeature } from './features/payouts/payouts-feature';
import { registerPayoutCallbackRoute, registerPayoutRoutes } from './features/payouts/payouts.routes';
import { payoutContext } from './features/payouts/payout-store';

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
const invoicesService = new InvoicesService();
const paymentLinksService = new PaymentLinksService();
const qrPhService = new QrPhService();
const owners = PaymentOwnerStore.getInstance();
const linkedAccountsSwitch = createLinkedAccountsSwitch(owners.databasePool);
const payouts = createPayoutsFeature(owners, { linkedAccountsSwitch });
const childWebhookSecret = createChildWebhookSecretLookup();
const linkedAccountStore = new LinkedAccountStore(owners.databasePool, isMockMode);
const onboarding = new LinkedAccountOnboarding<MerchantDetails>(linkedAccountStore, linkedAccountsSwitch,
  isMockMode() ? new FakeLinkedAccountsProvider()
    : hasPayMongoTestCredentials() ? new PayMongoLinkedAccountsSandbox() : null,
  undefined, (accountId) => Boolean(childWebhookSecret(accountId)));
const payeeWalletsEnabled = (environment: Environment, projectId: string) =>
  payouts.projectFeatures.enabled(environment, projectId, 'payee_wallets');
const consumerOnboarding = new LinkedAccountOnboarding<ConsumerDetails>(linkedAccountStore, {
  projectEnabled: payeeWalletsEnabled, enabledFor: payeeWalletsEnabled,
  setProject: (environment, projectId, enabled, actor) => payouts.projectFeatures.set(environment, projectId, 'payee_wallets', enabled, actor),
  async assertEnabledFor(environment, projectId) {
    if (environment !== 'test' || !await payeeWalletsEnabled(environment, projectId) || !isMockMode()) {
      throw new PayMongoError('Payee wallet onboarding is unavailable for this project', 503, 'PAYEE_ONBOARDING_DISABLED');
    }
  },
}, isMockMode() ? new FakeLinkedAccountsProvider() : null);
const collection = createCollectionRouting(payouts.accounts, owners.databasePool);
const webhooksService = new WebhooksService(owners, refundsService, collection.forOwner, onboarding, childWebhookSecret);
const eventRecovery = new PaymentReplayStore();
const replayInput = z.object({ eventId: z.string().uuid(), operationId: z.string().uuid(), reason: z.string().trim().min(1).max(500), actor: z.string().trim().min(1).max(200) }).strict();

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

const contextOptions = {
  canVerify: Boolean(process.env.APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS?.trim()),
  production: process.env.NODE_ENV === 'production',
};
if (!contextOptions.canVerify && contextOptions.production) {
  console.warn(JSON.stringify({
    event: 'payments_runtime_context_unverified',
    message: 'APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS is not set: payment requests are scoped by unsigned headers.',
  }));
}

/** The verified caller, read once per request. */
function paymentContext(req: Request): PaymentContext {
  const cached = (req as Request & { paymentContext?: PaymentContext }).paymentContext;
  if (cached) return cached;
  const context = readPaymentContext(req, contextOptions);
  (req as Request & { paymentContext?: PaymentContext }).paymentContext = context;
  return context;
}

app.use((req: Request, res: Response, next) => {
  const expected = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
  // Provider callbacks arrive from the gateway's webhook routes, which send the token in their own header.
  const providerCallback = req.path === '/webhooks' || req.path.startsWith('/payouts/callbacks/');
  const presented = providerCallback
    ? req.get('X-APICenter-Internal-Token')
    : req.get('Authorization')?.replace(/^Bearer /, '');
  if (!expected || !presented || presented.length !== expected.length
    || !timingSafeEqual(Buffer.from(presented), Buffer.from(expected))) {
    return fail(res, 401, 'UNAUTHORIZED', 'Payment runtime token is required');
  }
  try {
    if (providerCallback) {
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
  references: { providerReference?: string; merchantAccountId?: string; providerResourceId?: string } = {}) {
  const context = paymentContext(req);
  await owners.save({ ...context, resourceType: type, resourceId: id,
    referenceId: typeof req.body?.referenceId === 'string' ? req.body.referenceId : undefined,
    ...references, snapshot });
}

/** Validates `allocations` before the provider call and strips them from the body the provider service sees. */
async function plannedAllocations(req: Request): Promise<{ body: Record<string, unknown>; allocations?: AllocationInput }> {
  const { allocations: _allocations, ...body } = (req.body || {}) as Record<string, unknown>;
  const allocations = parseAllocations(req.body);
  if (allocations) await validateAllocations(payouts.store, payoutContext(paymentContext(req)), allocations, Number(req.body?.amount));
  return { body, ...(allocations ? { allocations } : {}) };
}

async function withAllocations<T extends Record<string, unknown>>(req: Request, snapshot: T, allocations: AllocationInput | undefined,
  resource: Omit<PaidResource, 'gross' | 'referenceId'>): Promise<T | (T & { allocations: unknown })> {
  if (!allocations) return snapshot;
  const referenceId = typeof req.body?.referenceId === 'string' ? req.body.referenceId : resource.id;
  const attached = await attachAllocations(payouts, payoutContext(paymentContext(req)), {
    ...resource, gross: Number(req.body?.amount), referenceId }, allocations);
  return { ...snapshot, allocations: attached };
}

async function owned(type: string, id: string, req: Request) {
  return owners.assertOwned(type, id, paymentContext(req));
}

/** APICenter's ID for a resource the provider created or returned: the existing one, or a newly minted one. */
async function publicIdFor(req: Request, type: PaymentResourceType, providerId: string): Promise<string> {
  return owners.publicIdFor(type, providerId, paymentContext(req).environment);
}

/** The provider's ID for an owned resource. Provider IDs are used to call the provider and never returned. */
function providerIdOf(owner: OwnerRecord): string {
  if (!owner.providerResourceId) {
    throw new PayMongoError('The payment resource has no provider record', 409, 'PROVIDER_RECORD_MISSING');
  }
  return owner.providerResourceId;
}

async function checkoutSnapshot(owner: OwnerRecord) {
  if (isMockMode()) return { ...owner.snapshot, aggregateVersion: owner.aggregateVersion };
  const paid = owner.status === 'paid' || owner.snapshot.status === 'paid';
  const paymentId = owner.snapshot.paymentId;
  if (paid && typeof paymentId === 'string') {
    try {
      const payment = await owners.assertOwned('payment', paymentId, owner);
      if (payment.status === 'paid' || payment.snapshot.status === 'paid') {
        return { ...owner.snapshot, status: 'paid', aggregateVersion: owner.aggregateVersion };
      }
    } catch (error) {
      if (!(error instanceof PayMongoError) || error.code !== 'NOT_FOUND') throw error;
    }
  }
  const { paidPayment, ...fresh } = await checkoutService.getCheckoutSession(providerIdOf(owner),
    { includePayment: true, account: await collection.forOwner(owner) });
  const paidPaymentId = paidPayment ? await owners.publicIdFor('payment', paidPayment.paymentId, owner.environment) : undefined;
  const record = await owners.reconcileCheckout(owner.resourceId, owner,
    { ...fresh, checkoutId: owner.resourceId, ...(paidPaymentId ? { paymentId: paidPaymentId } : {}) });
  if (paidPayment) await owners.registerCheckoutPayment(record, paidPayment, paidPaymentId);
  const snapshot = record.snapshot.status === 'paid' || record.status === 'paid'
    ? { ...record.snapshot, status: 'paid' } : record.snapshot;
  return { ...snapshot, aggregateVersion: record.aggregateVersion };
}

function idempotencyKey(req: Request): string | undefined {
  return req.get('Idempotency-Key') || req.body?.idempotencyKey;
}

function tribeId(req: Request): string | undefined {
  return paymentContext(req).tribeId;
}

function handleCustomError(res: Response, err: any) {
  // Only APICenter errors (PayMongoError) are returned as they are; anything else is a defect worth a trace,
  // and its message stays in the log.
  if (!(err instanceof PayMongoError) || !err.statusCode) {
    console.error(JSON.stringify({
      type: 'apicenter_payment_unexpected_error',
      path: res.req?.path,
      message: err?.message,
      ...(err instanceof PayMongoError && err.provider ? { provider: err.provider } : {}),
      stack: typeof err?.stack === 'string' ? err.stack.split('\n').slice(0, 6).join('\n') : undefined,
    }));
    if (!(err instanceof PayMongoError)) return fail(res, 502, 'PROVIDER_ERROR', 'Payment processing failed');
  } else if (err.provider) {
    // The provider's own answer is for operators; callers get the neutral code and message.
    console.warn(JSON.stringify({ type: 'apicenter_payment_provider_error', path: res.req?.path,
      code: err.code, provider: { ...err.provider, body: undefined } }));
  }
  if (err.details && typeof err.details === 'object' && 'deprecatedProviderCode' in err.details) {
    res.set('Deprecation', 'true');
    res.set('Sunset', new Date(`${PROVIDER_CODE_SUNSET}T00:00:00Z`).toUTCString());
  }
  return fail(res, err.statusCode || 502, err.code || 'PROVIDER_ERROR', err.message || 'Payment processing failed', err.details);
}

let outboxPool: ReturnType<typeof createPaymentEventPool> | undefined;

/**
 * Publish the events a webhook just queued, so consumers hear about a payment without waiting for the
 * scheduled dispatcher job. A failure stays in the outbox, and the job retries it.
 */
async function publishQueuedPaymentEvents(): Promise<void> {
  if (!hasPaymentEventTopic('test') && !hasPaymentEventTopic('live')) return;
  try {
    outboxPool ??= createPaymentEventPool();
    await drainPaymentEventOutbox({ pool: outboxPool, limit: 10 });
  } catch (error) {
    console.error(JSON.stringify({ type: 'apicenter_payment_outbox_drain_failed', message: (error as Error).message }));
  }
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

app.get('/admin/payments/events', async (req: Request, res: Response) => {
  try { return ok(res, await eventRecovery.list(paymentContext(req))); }
  catch (error) { return handleCustomError(res, error); }
});

app.post('/admin/payments/events/replay', async (req: Request, res: Response) => {
  const parsed = replayInput.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, 'INVALID_REPLAY', 'A valid event, operation ID, actor and reason are required');
  try { return ok(res, await eventRecovery.replay({ ...parsed.data, context: paymentContext(req) })); }
  catch (error) {
    if (error instanceof Error && 'status' in error && 'code' in error && typeof error.status === 'number' && typeof error.code === 'string') return fail(res, error.status, error.code, error.code);
    return handleCustomError(res, error);
  }
});

// Payment Intents
app.post('/payment-intents', async (req: Request, res: Response) => {
  try {
    const { body, allocations } = await plannedAllocations(req);
    const account = await collection.forCreate(paymentContext(req), 'intent', idempotencyKey(req));
    const data = await paymentIntentsService.createPaymentIntent(body, {
      account,
      idempotencyKey: idempotencyKey(req),
      tribeId: tribeId(req),
    });
    const paymentIntentId = await publicIdFor(req, 'intent', data.paymentIntentId);
    const snapshot = { ...data, paymentIntentId, referenceId: req.body?.referenceId };
    await remember('intent', paymentIntentId, req, snapshot, { merchantAccountId: account.id, providerResourceId: data.paymentIntentId });
    return ok(res, await withAllocations(req, snapshot, allocations, { type: 'intent', id: paymentIntentId, merchantAccountId: account.id }), 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/qrph', async (req: Request, res: Response) => {
  try {
    const account = await collection.forCreate(paymentContext(req), 'qrph', idempotencyKey(req));
    const data = await qrPhService.create(req.body || {}, idempotencyKey(req), account);
    const paymentIntentId = await publicIdFor(req, 'intent', data.paymentIntentId);
    const snapshot = { ...data, paymentIntentId, referenceId: req.body?.referenceId };
    await remember('intent', paymentIntentId, req, snapshot, { merchantAccountId: account.id, providerResourceId: data.paymentIntentId });
    return ok(res, snapshot, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/payment-intents/:paymentIntentId', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const current = await owned('intent', paymentIntentId, req);
    const data = await paymentIntentsService.getPaymentIntent(providerIdOf(current), await collection.forOwner(current));
    const owner = await owners.reconcileFreshRead('intent', paymentIntentId, paymentContext(req), { ...data, paymentIntentId });
    return ok(res, owner.snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/:paymentIntentId/confirm', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const owner = await owned('intent', paymentIntentId, req);
    const data = await paymentIntentsService.confirmPaymentIntent(providerIdOf(owner), req.body || {}, {
      idempotencyKey: idempotencyKey(req), account: await collection.forOwner(owner),
    });
    const snapshot = { ...owner.snapshot, ...data, paymentIntentId };
    await remember('intent', paymentIntentId, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/payment-intents/:paymentIntentId/cancel', async (req: Request, res: Response) => {
  try {
    const paymentIntentId = Array.isArray(req.params.paymentIntentId) ? req.params.paymentIntentId[0] : req.params.paymentIntentId;
    const owner = await owned('intent', paymentIntentId, req);
    const data = await paymentIntentsService.cancelPaymentIntent(providerIdOf(owner), {
      idempotencyKey: idempotencyKey(req), account: await collection.forOwner(owner),
    });
    const snapshot = { ...owner.snapshot, ...data, paymentIntentId };
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
    const { body, allocations } = await plannedAllocations(req);
    const account = await collection.forCreate(paymentContext(req), 'checkout', key);
    const created = await checkoutService.charge(body, { idempotencyKey: key, tribeId: tribeId(req), account });
    const checkoutId = await publicIdFor(req, 'checkout', created.checkoutId);
    const data = { ...created, checkoutId };
    await remember('checkout', checkoutId, req, data, { merchantAccountId: account.id, providerResourceId: created.checkoutId });
    return ok(res, await withAllocations(req, data, allocations, { type: 'checkout', id: checkoutId, merchantAccountId: account.id }), 201);
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
    const owner = await owned('checkout', checkoutId, req);
    const data = await checkoutService.markCheckoutCancelled(providerIdOf(owner), { tribeId: tribeId(req), reason: req.body?.reason,
      idempotencyKey: idempotencyKey(req), account: await collection.forOwner(owner) });
    return ok(res, { ...data, checkoutId });
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/checkout/sessions/:checkoutId/cancel', async (req: Request, res: Response) => {
  try {
    const checkoutId = String(req.params.checkoutId);
    const owner = await owned('checkout', checkoutId, req);
    const data = await checkoutService.markCheckoutCancelled(providerIdOf(owner), { tribeId: tribeId(req), reason: req.body?.reason,
      idempotencyKey: idempotencyKey(req), account: await collection.forOwner(owner) });
    const snapshot = { ...owner.snapshot, ...data, checkoutId };
    await remember('checkout', checkoutId, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

// Customers & Catalog
app.post('/customers', async (req: Request, res: Response) => {
  try {
    const data = await catalogService.createCustomer(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    const customerId = await publicIdFor(req, 'customer', data.customerId);
    const snapshot = { ...data, customerId, customerReference: req.body?.customerReference };
    await remember('customer', customerId, req, snapshot, { providerResourceId: data.customerId });
    return ok(res, snapshot, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
    const owner = await owned('customer', customerId, req);
    const data = await catalogService.getCustomer(providerIdOf(owner));
    return ok(res, { ...owner.snapshot, ...data, customerId });
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/plans', async (req: Request, res: Response) => {
  try {
    const created = await catalogService.createPlan(req.body || {}, { idempotencyKey: idempotencyKey(req) });
    const planId = await publicIdFor(req, 'plan', created.planId);
    const data = { ...created, planId };
    await remember('plan', planId, req, data, { providerResourceId: created.planId });
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
    const data = await catalogService.getPlan(providerIdOf(owner));
    return ok(res, { ...owner.snapshot, ...data, planId });
  } catch (err) { return handleCustomError(res, err); }
});

// Payment Links
app.post('/payment-links', async (req: Request, res: Response) => {
  try {
    const { body, allocations } = await plannedAllocations(req);
    const account = await collection.forCreate(paymentContext(req), 'payment_link', idempotencyKey(req));
    const data = await paymentLinksService.create(body, idempotencyKey(req), account);
    const paymentLinkId = await publicIdFor(req, 'payment_link', data.paymentLinkId!);
    const snapshot = { ...data, paymentLinkId, referenceId: req.body?.referenceId };
    await remember('payment_link', paymentLinkId, req, snapshot, { providerReference: data.referenceNumber,
      merchantAccountId: account.id, providerResourceId: data.paymentLinkId });
    return ok(res, await withAllocations(req, snapshot, allocations, { type: 'payment_link', id: paymentLinkId, merchantAccountId: account.id }), 201);
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
    const data = await paymentLinksService.get(providerIdOf(owner), await collection.forOwner(owner));
    return ok(res, { ...owner.snapshot, ...data, paymentLinkId: id, ...(owner.snapshot.status === 'paid' ? { status: 'paid' } : {}) });
  } catch (err) { return handleCustomError(res, err); }
});

app.patch('/payment-links/:paymentLinkId', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.paymentLinkId);
    const current = await owned('payment_link', id, req);
    const data = await paymentLinksService.setArchived(providerIdOf(current), req.body?.archive, idempotencyKey(req), await collection.forOwner(current));
    const owner = await owners.reconcilePaymentLink(id, paymentContext(req), { ...data, paymentLinkId: id });
    return ok(res, owner.snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

// Subscriptions
app.post('/subscriptions', async (req: Request, res: Response) => {
  try {
    const customer = await owned('customer', req.body?.customerId, req);
    const plan = await owned('plan', req.body?.planId, req);
    const created = await subscriptionsService.createSubscription(
      { ...(req.body || {}), customerId: providerIdOf(customer), planId: providerIdOf(plan) },
      { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req) });
    const subscriptionId = await publicIdFor(req, 'subscription', created.subscriptionId);
    const data = { ...created, subscriptionId, customerId: customer.resourceId, planId: plan.resourceId };
    await remember('subscription', subscriptionId, req, data, { providerResourceId: created.subscriptionId });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/subscriptions/:subscriptionId', async (req: Request, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId;
    const current = await owned('subscription', subscriptionId, req);
    const data = await subscriptionsService.getSubscription(providerIdOf(current));
    const owner = await owners.reconcileFreshRead('subscription', subscriptionId, paymentContext(req),
      { ...data, subscriptionId, customerId: current.snapshot.customerId, planId: current.snapshot.planId });
    return ok(res, owner.snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

app.post('/subscriptions/:subscriptionId/cancel', async (req: Request, res: Response) => {
  try {
    const subscriptionId = Array.isArray(req.params.subscriptionId) ? req.params.subscriptionId[0] : req.params.subscriptionId;
    const owner = await owned('subscription', subscriptionId, req);
    const data = await subscriptionsService.cancelSubscription(providerIdOf(owner), { idempotencyKey: idempotencyKey(req) });
    const snapshot = { ...owner.snapshot, ...data, subscriptionId };
    await remember('subscription', subscriptionId, req, snapshot);
    return ok(res, snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/subscriptions/:subscriptionId/invoices', async (req: Request, res: Response) => {
  try {
    const subscriptionId = String(req.params.subscriptionId);
    const subscription = await owned('subscription', subscriptionId, req);
    const invoices = await invoicesService.listForSubscription(providerIdOf(subscription));
    const context = paymentContext(req);
    const reconciled: OwnerRecord[] = [];
    for (const invoice of invoices) {
      const invoiceId = await publicIdFor(req, 'invoice', invoice.invoiceId);
      reconciled.push(await owners.reconcileFreshRead('invoice', invoiceId, context,
        { ...invoice, invoiceId, subscriptionId }, invoice.invoiceId));
    }
    return ok(res, reconciled.map((owner) => owner.snapshot));
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/invoices/:invoiceId', async (req: Request, res: Response) => {
  try {
    const invoiceId = String(req.params.invoiceId);
    const current = await owned('invoice', invoiceId, req);
    const invoice = await invoicesService.get(providerIdOf(current));
    const owner = await owners.reconcileFreshRead('invoice', invoiceId, paymentContext(req),
      { ...invoice, invoiceId, subscriptionId: current.snapshot.subscriptionId });
    return ok(res, owner.snapshot);
  } catch (err) { return handleCustomError(res, err); }
});

// Refunds
app.post('/payments/:paymentId/refunds', async (req: Request, res: Response) => {
  try {
    const paymentId = Array.isArray(req.params.paymentId) ? req.params.paymentId[0] : req.params.paymentId;
    const owner = await owned('payment', paymentId, req);
    const account = await collection.forOwner(owner);
    const created = await refundsService.refund({ ...req.body, paymentId: providerIdOf(owner) },
      { idempotencyKey: idempotencyKey(req), tribeId: tribeId(req), account });
    const refundId = await publicIdFor(req, 'refund', created.refundId);
    const data = { ...created, refundId, paymentId };
    await remember('refund', refundId, req, data, { merchantAccountId: account.id, providerResourceId: created.refundId });
    return ok(res, data, 201);
  } catch (err) { return handleCustomError(res, err); }
});

app.get('/refunds/:refundId', async (req: Request, res: Response) => {
  try {
    const refundId = String(req.params.refundId);
    const owner = await owned('refund', refundId, req);
    const record = isMockMode() ? owner
      : await owners.reconcileRefund(refundId, paymentContext(req), { ...await refundsService.getRefund(providerIdOf(owner),
        await collection.forOwner(owner)), refundId, paymentId: owner.snapshot.paymentId as string | undefined });
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
      accountId: req.get('X-APICenter-Webhook-Account'),
    });
    if ((data as { data?: { queued?: boolean } })?.data?.queued) await publishQueuedPaymentEvents();
    return ok(res, data);
  } catch (err) {
    console.error(JSON.stringify({
      type: 'apicenter_payment_webhook_failed',
      providerEventId: req.body?.data?.id,
      eventType: req.body?.data?.attributes?.type,
      code: (err as { code?: string })?.code,
      message: (err as Error)?.message,
    }));
    return handleCustomError(res, err);
  }
});

registerPayoutCallbackRoute(app, payouts, { handleError: handleCustomError });
registerPayoutRoutes(app, payouts, { ok, context: paymentContext,
  signedContext: (req) => readPaymentContext(req, { ...contextOptions, requireSigned: true }),
  handleError: handleCustomError, pauses: payouts.pauses, features: {
  linkedAccountsEnabled: (environment, projectId) => linkedAccountsSwitch.enabledFor(environment, projectId),
  payeeWalletsAvailable: () => isMockMode() && Boolean(owners.databasePool),
} });
registerLinkedAccountRoutes(app, onboarding, { ok, context: paymentContext, handleError: handleCustomError, pauses: payouts.pauses });
registerPayeeOnboardingRoutes(app, {
  onboarding: consumerOnboarding, payees: payouts.store, persistent: Boolean(owners.databasePool),
  helpers: { ok, context: paymentContext, handleError: handleCustomError, pauses: payouts.pauses }, publish: publishQueuedPaymentEvents,
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`[apicenter-payments] listening on port ${port}`);
  });
}

export { app };
