import axios from 'axios';
import { getCloudRunAuthorizationHeader } from '../../../../apps/gateway/src/shared/proxy/cloud-run-auth';
import { PaymentsController } from '../../../../apps/gateway/src/domains/payments/features/payment-facade/payments.controller';
import { PaymentIdempotencyService } from '../../../../apps/gateway/src/domains/payments/shared/payment-idempotency.service';
import { PaymentReturnLinks } from '../../../../apps/gateway/src/domains/payments/features/payment-return/payment-return-links';
const paymentLimits = { enforce: jest.fn().mockResolvedValue(undefined) } as any;
const applications = { authorizeAction: jest.fn(), recordOutcome: jest.fn().mockResolvedValue(undefined) } as any;
const returnLinks = new PaymentReturnLinks({});
const createController = () => new PaymentsController(new PaymentIdempotencyService(), paymentLimits, applications, returnLinks);
const KEY = 'ak_test_aaaaaaaaaaaaaaaa_' + 'b'.repeat(43);
// What authorizeAction returns for the test application: its organization and project own the records.
const authorized = (action = 'payments:checkout:write') => ({
  identity: {
    organizationId: 'tribe-alpha',
    projectId: 'project-alpha',
    environmentId: 'env_aaaaaaaaaaaaaaaaaaaaaaaa',
    environmentKind: 'test',
    applicationId: 'service-alpha',
    credentialId: 'crd_aaaaaaaaaaaaaaaaaaaaaaaa',
  },
  resourceOwner: { groupId: 'tribe-alpha', projectId: 'project-alpha' },
  requestKey: 'req:1',
  capability: 'payments',
  action,
  signedContext: 'unused',
});

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
jest.mock('../../../../apps/gateway/src/shared/proxy/cloud-run-auth', () => ({
  getCloudRunAuthorizationHeader: jest.fn(),
}));
const mockedCloudRunAuthorization = getCloudRunAuthorizationHeader as jest.MockedFunction<typeof getCloudRunAuthorizationHeader>;

function request(path: string, method: string, body?: Record<string, unknown>) {
  return {
    method,
    originalUrl: `/api/v1/payments${path}`,
    headers: {
      authorization: `Bearer ${KEY}`,
      'idempotency-key': 'idempotency-key-123456',
    },
    get(name: string) { return this.headers[name.toLowerCase()]; },
    body,
  } as any;
}

function response() {
  const state: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const res = {
    locals: {},
    on: jest.fn(),
    setHeader: jest.fn((name: string, value: string) => { state.headers[name] = value; }),
    status: jest.fn((status: number) => { state.status = status; return res; }),
    json: jest.fn((body: unknown) => { state.body = body; return res; }),
    send: jest.fn((body: unknown) => { state.body = body; return res; }),
  } as any;
  return { res, state };
}

describe('PaymentsController', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabaseEnabled = process.env.DATABASE_ENABLED;
  const originalRuntimeToken = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;

  beforeAll(() => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_ENABLED;
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = 'unit-test-runtime-token';
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalDatabaseEnabled === undefined) delete process.env.DATABASE_ENABLED; else process.env.DATABASE_ENABLED = originalDatabaseEnabled;
    if (originalRuntimeToken === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;
    else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = originalRuntimeToken;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    applications.authorizeAction.mockResolvedValue(authorized());
    mockedCloudRunAuthorization.mockResolvedValue(undefined);
    mockedAxios.request.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: Buffer.from(JSON.stringify({
        success: true,
        data: {
          checkoutId: 'chk_123',
          referenceId: 'order-123',
          status: 'pending',
          amount: { value: 39900, currency: 'PHP' },
          redirectUrl: 'https://checkout.example.test/chk_123',
        },
      })),
      config: {},
      statusText: 'OK',
    } as any);
  });

  it.each([
    ['POST', '/checkouts', { referenceId: 'order-123', amount: { amountMinor: 39900, currency: 'PHP' }, successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel' }],
    ['GET', '/checkouts/chk_123', undefined],
    ['GET', '/checkouts/by-reference/order-123', undefined],
    ['POST', '/checkouts/chk_123/cancel', {}],
    ['POST', '/intents', { referenceId: 'order-123', amount: { amountMinor: 39900, currency: 'PHP' } }],
    ['POST', '/intents/qrph', { referenceId: 'qr-123', amount: { amountMinor: 39900, currency: 'PHP' }, expirySeconds: 300 }],
    ['GET', '/intents/pi_123', undefined],
    ['POST', '/intents/pi_123/confirm', { paymentMethodId: 'pm_123', clientKey: 'pi_123_client', returnUrl: 'https://app.test/return' }],
    ['POST', '/intents/pi_123/cancel', {}],
    ['POST', '/customers', { customerReference: 'customer-123', email: 'customer@example.test' }],
    ['GET', '/customers/cus_123', undefined],
    ['POST', '/plans', { name: 'Starter', amount: 2000, interval: 'monthly' }],
    ['GET', '/plans', undefined],
    ['GET', '/plans/plan_123', undefined],
    ['POST', '/payment-links', { referenceId: 'link-123', amount: { amountMinor: 39900, currency: 'PHP' }, description: 'Order 123' }],
    ['GET', '/payment-links', undefined],
    ['GET', '/payment-links/pl_123', undefined],
    ['PATCH', '/payment-links/pl_123', { archive: true }],
    ['POST', '/refunds', { paymentId: 'pay_123', amount: { amountMinor: 100, currency: 'PHP' } }],
    ['GET', '/refunds/ref_123', undefined],
    ['POST', '/subscriptions', { customerId: 'cus_123', referenceId: 'sub-123', planId: 'plan_123' }],
    ['GET', '/subscriptions/sub_123', undefined],
    ['POST', '/subscriptions/sub_123/cancel', {}],
    ['GET', '/subscriptions/sub_123/invoices', undefined],
    ['GET', '/invoices/inv_123', undefined],
    ['POST', '/payees', { externalRef: 'provider-1', legalName: 'Juan Dela Cruz' }],
    ['GET', '/payees', undefined],
    ['GET', '/payees/pye_1', undefined],
    ['PUT', '/payees/pye_1/destination', { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan Dela Cruz' }],
    ['POST', '/payees/pye_1/cash-out', {}],
    ['POST', '/allocations/pal_1/release', {}],
    ['POST', '/allocations/pal_1/cancel', {}],
    ['GET', '/payouts', undefined],
    ['GET', '/payouts/po_1', undefined],
  ])('maps %s %s to the private payments runtime', async (method, path, body) => {
    const idempotency = new PaymentIdempotencyService();
    const controller = new PaymentsController(idempotency, paymentLimits, applications, returnLinks);
    const { res, state } = response();

    await controller.proxy(request(path, method, body), res);

    expect(state.status).toBe(200);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    expect(mockedAxios.request.mock.calls[0][0]).toEqual(expect.objectContaining({
      method,
      url: expect.stringContaining('/'),
    }));
    if (path.endsWith('/confirm')) {
      expect(mockedAxios.request.mock.calls[0][0].data).toEqual({
        payment_method: 'pm_123', client_key: 'pi_123_client', return_url: 'https://app.test/return',
      });
    }
  });

  it('uses the authenticated principal for tenant/environment and normalizes provider resources', async () => {
    const controller = createController();
    const { res, state } = response();
    const body = {
      referenceId: 'order-123',
      amount: { amountMinor: 39900, currency: 'PHP' },
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
      tribeId: 'attacker-tribe',
      environment: 'live',
      metadata: { planId: 'starter' },
    };

    await controller.proxy(request('/checkouts', 'POST', body), res);

    const config = mockedAxios.request.mock.calls[0][0] as any;
    expect(config.headers['x-apicenter-owner-tribe-id']).toBe('tribe-alpha');
    expect(config.headers).not.toHaveProperty('x-tribe-id');
    expect(config.headers['x-apicenter-project-id']).toBe('project-alpha');
    expect(config.headers['x-apicenter-environment']).toBe('test');
    expect(config.data).not.toHaveProperty('tribeId');
    expect(config.data).not.toHaveProperty('environment');
    expect(config.data.metadata).toEqual({ planId: 'starter', __apicenterConsumerServiceId: 'service-alpha' });
    const payload = JSON.parse(Buffer.from(state.body as Buffer).toString('utf8'));
    expect(payload.data.amount).toEqual({ amountMinor: 39900, currency: 'PHP' });
    expect(payload.data.checkoutUrl).toBe('https://checkout.example.test/chk_123');
  });

  it('rejects invalid plan schedules before forwarding to the runtime', async () => {
    const controller = createController();
    const { res } = response();
    await expect(controller.proxy(request('/plans', 'POST', {
      name: 'Invalid', amount: 150050, interval: 'monthly', intervalCount: 11,
    }), res)).rejects.toMatchObject({ status: 400 });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('rejects QR Ph expiry outside 60 to 9000 before forwarding to the runtime', async () => {
    const controller = createController();
    await expect(controller.proxy(request('/intents/qrph', 'POST', {
      referenceId: 'qr-invalid', amount: { amountMinor: 100, currency: 'PHP' }, expirySeconds: 9001,
    }), response().res)).rejects.toMatchObject({ response: { code: 'INVALID_PAYMENT_REQUEST' } });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it.each([
    ['no description', {}],
    ['a blank description', { description: '  ' }],
    ['a description over 255 characters', { description: 'x'.repeat(256) }],
    ['a non-string metadata value', { description: 'Order 1', metadata: { count: 1 } }],
  ])('rejects a payment link with %s before forwarding to the runtime', async (_case, fields) => {
    const controller = createController();
    await expect(controller.proxy(request('/payment-links', 'POST', {
      referenceId: 'link-invalid', amount: { amountMinor: 100, currency: 'PHP' }, ...fields,
    }), response().res)).rejects.toMatchObject({ response: { code: 'INVALID_PAYMENT_REQUEST' } });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it.each([
    ['a payment link', '/payment-links', { referenceId: 'link-1', description: 'Order 1', amount: { amountMinor: 2_000_000, currency: 'PHP' } }],
    ['a QR Ph code', '/intents/qrph', { referenceId: 'qr-1', amount: { amountMinor: 2_000_000, currency: 'PHP' } }],
    ['a plan', '/plans', { name: 'Gold', amount: 2_000_000, interval: 'monthly' }],
  ])('applies the amount limit to %s', async (_case, path, body) => {
    paymentLimits.enforce.mockRejectedValueOnce({ status: 422, response: { code: 'AMOUNT_LIMIT_EXCEEDED' } });
    await expect(createController().proxy(request(path, 'POST', body), response().res))
      .rejects.toMatchObject({ response: { code: 'AMOUNT_LIMIT_EXCEEDED' } });
    expect(paymentLimits.enforce).toHaveBeenCalledWith(expect.objectContaining({ amountMinor: 2_000_000, method: 'POST' }));
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('serves provider capabilities from the public facade', async () => {
    const controller = createController();
    const { res, state } = response();

    await controller.proxy(request('/capabilities', 'GET'), res);

    expect(state.status).toBe(200);
    expect(state.body).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ currency: 'PHP', resources: expect.arrayContaining(['checkouts']) }),
    }));
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it("checks the project's amount and rate limits before forwarding", async () => {
    paymentLimits.enforce.mockRejectedValueOnce({ status: 422, response: { code: "AMOUNT_LIMIT_EXCEEDED" } });
    const controller = createController();

    await expect(controller.proxy(request('/checkouts', 'POST', {
      referenceId: 'order-123',
      amount: { amountMinor: 1_000_001, currency: 'PHP' },
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    }), response().res)).rejects.toMatchObject({ response: { code: 'AMOUNT_LIMIT_EXCEEDED' } });

    expect(paymentLimits.enforce).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-alpha',
      environment: 'test',
      amountMinor: 1_000_001,
    }));
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('rejects an invalid public body before calling the private runtime', async () => {
    const controller = createController();
    const invalid = request('/checkouts', 'POST', { referenceId: '', amount: { amountMinor: 0, currency: 'USD' } });

    await expect(controller.proxy(invalid, response().res)).rejects.toMatchObject({
      response: { code: 'INVALID_PAYMENT_REQUEST' },
    });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('rejects unlisted routes and calls without an application key', async () => {
    const controller = createController();
    await expect(controller.proxy(request('/admin', 'GET'), response().res))
      .rejects.toMatchObject({ response: { code: 'PAYMENT_OPERATION_NOT_FOUND' } });
    for (const authorization of [undefined, 'Bearer apic_test_legacy_payment_key']) {
      const req = request('/checkouts/chk_1', 'GET');
      req.headers.authorization = authorization;
      const { res, state } = response();
      await controller.proxy(req, res);
      expect(state.status).toBe(401);
    }
    expect(applications.authorizeAction).not.toHaveBeenCalled();
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('retries an unknown provider outcome with the same key after a bounded lease', async () => {
    const clock = jest.spyOn(Date, 'now');
    const start = Date.now();
    clock.mockReturnValue(start);
    const controller = createController();
    const body = { referenceId: 'order-lease', amount: { amountMinor: 100, currency: 'PHP' },
      successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel' };
    mockedAxios.request.mockRejectedValueOnce(new Error('timeout'));
    try {
      const first = response();
      await controller.proxy(request('/checkouts', 'POST', body), first.res);
      expect(first.state.status).toBe(502);
      await expect(controller.proxy(request('/checkouts', 'POST', body), response().res))
        .rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS' } });
      clock.mockReturnValue(start + 31000);
      const retried = response();
      await controller.proxy(request('/checkouts', 'POST', body), retried.res);
      expect(retried.state.status).toBe(200);
      expect(mockedAxios.request).toHaveBeenCalledTimes(2);
      expect((mockedAxios.request.mock.calls[1][0] as any).headers['idempotency-key'])
        .toBe('idempotency-key-123456');
    } finally { clock.mockRestore(); }
  });

  it('authorizes an application credential per operation and scopes the runtime call to its resolved owner', async () => {
    const bearer = KEY;
    applications.authorizeAction.mockResolvedValue({
      ...authorized(),
      identity: { ...authorized().identity, applicationId: 'app_aaaaaaaaaaaaaaaaaaaaaaaa' },
      resourceOwner: { groupId: 'org_1', projectId: 'prj_1' },
    });
    const req = request('/checkouts', 'POST', {
      referenceId: 'order-123',
      amount: { amountMinor: 39900, currency: 'PHP' },
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });
    const { res } = response();

    await createController().proxy(req, res);

    expect(applications.authorizeAction).toHaveBeenCalledWith(
      expect.objectContaining({ bearer, capability: 'payments', action: 'payments:checkout:write', idempotencyKey: 'idempotency-key-123456' }),
    );
    const headers = mockedAxios.request.mock.calls[0][0].headers as Record<string, string>;
    expect(headers['x-apicenter-owner-tribe-id']).toBe('org_1');
    expect(headers['x-apicenter-project-id']).toBe('prj_1');
    expect(headers['x-apicenter-consumer-service-id']).toBe('app_aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(headers.authorization).toBe('Bearer unit-test-runtime-token');
    expect(JSON.stringify(mockedAxios.request.mock.calls[0][0])).not.toContain(bearer);
  });

  it.each([
    ['POST', '/payees', '/payouts/payees', 'payments:payouts:write'],
    ['GET', '/payees', '/payouts/payees', 'payments:payouts:read'],
    ['GET', '/payees/pye_1', '/payouts/payees/pye_1', 'payments:payouts:read'],
    ['PUT', '/payees/pye_1/destination', '/payouts/payees/pye_1/destination', 'payments:payouts:write'],
    ['POST', '/payees/pye_1/cash-out', '/payouts/payees/pye_1/cash-out', 'payments:payouts:write'],
    ['POST', '/allocations/pal_1/release', '/payouts/allocations/pal_1/release', 'payments:payouts:write'],
    ['POST', '/allocations/pal_1/cancel', '/payouts/allocations/pal_1/cancel', 'payments:payouts:write'],
    ['GET', '/payouts', '/payouts', 'payments:payouts:read'],
    ['GET', '/payouts/po_1', '/payouts/po_1', 'payments:payouts:read'],
  ])('authorizes %s %s on runtime path %s with %s', async (method, path, runtimePath, scope) => {
    const bodies: Record<string, Record<string, unknown>> = {
      '/payees': { externalRef: 'provider-1', legalName: 'Juan' },
      '/payees/pye_1/destination': { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan' },
    };
    const { res } = response();
    await createController().proxy(request(path, method, method === 'GET' ? undefined : (bodies[path] ?? {})), res);
    expect(applications.authorizeAction).toHaveBeenCalledWith(expect.objectContaining({ action: scope }));
    const call = mockedAxios.request.mock.calls[0][0] as { method: string; url: string };
    expect(call.method).toBe(method);
    expect(new URL(call.url).pathname).toBe(runtimePath);
  });

  it('flattens allocation amounts for the runtime and returns allocations in public form', async () => {
    mockedAxios.request.mockResolvedValueOnce({ status: 201, headers: { 'content-type': 'application/json' }, data: Buffer.from(JSON.stringify({
      success: true, data: { paymentIntentId: 'pi_1', referenceId: 'order-1', status: 'awaiting_payment_method', amount: 50000, currency: 'PHP',
        allocations: [{ id: 'pal_1', payeeId: 'pye_1', amount: 42500, status: 'awaiting_payment', paymentId: null }] },
    })) } as any);
    applications.authorizeAction.mockResolvedValue(authorized('payments:intents:write'));
    const { res, state } = response();
    await createController().proxy(request('/intents', 'POST', { referenceId: 'order-1', amount: { amountMinor: 50000, currency: 'PHP' },
      allocations: [{ payeeId: 'pye_1', amount: { amountMinor: 42500, currency: 'PHP' } }] }), res);
    const sent = (mockedAxios.request.mock.calls[0][0] as { data: unknown }).data;
    expect(typeof sent === 'string' ? JSON.parse(sent) : sent).toMatchObject({ amount: 50000, allocations: [{ payeeId: 'pye_1', amount: 42500 }] });
    expect(JSON.parse(Buffer.from(state.body as Buffer).toString('utf8')).data.allocations).toEqual([{ allocationId: 'pal_1', payeeId: 'pye_1',
      amount: { amountMinor: 42500, currency: 'PHP' }, status: 'awaiting_payment', paymentId: null }]);
  });

  it('masks payee account numbers and pages payee lists', async () => {
    mockedAxios.request.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'application/json' }, data: Buffer.from(JSON.stringify({
      success: true, data: { nextCursor: 'abc', records: [{ id: 'pye_1', externalRef: 'provider-1', legalName: 'Juan', status: 'active',
        createdAt: '2026-11-24T00:00:00.000Z', destinationHoldUntil: null,
        destination: { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan' } }] },
    })) } as any);
    applications.authorizeAction.mockResolvedValue(authorized('payments:payouts:read'));
    const { res, state } = response();
    await createController().proxy(request('/payees', 'GET'), res);
    expect(JSON.parse(Buffer.from(state.body as Buffer).toString('utf8')).data).toEqual({ nextCursor: 'abc', records: [{ payeeId: 'pye_1', externalRef: 'provider-1', legalName: 'Juan',
      status: 'active', createdAt: '2026-11-24T00:00:00.000Z', destinationHoldUntil: null,
      destination: { type: 'instapay', bic: 'GXCHPHM2XXX', accountName: 'Juan', accountNumberLast4: '4567' } }] });
    expect(Buffer.from(state.body as Buffer).toString('utf8')).not.toContain('09171234567');
  });

  it('rejects a destination that does not match the contract before reaching the runtime', async () => {
    applications.authorizeAction.mockResolvedValue(authorized('payments:payouts:write'));
    const { res } = response();
    await expect(createController().proxy(request('/payees/pye_1/destination', 'PUT', { type: 'instapay', accountNumber: '1', accountName: 'J' }), res))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'INVALID_PAYMENT_REQUEST' }) });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('never reaches the payment runtime when the application lacks the grant', async () => {
    applications.authorizeAction.mockRejectedValue(Object.assign(new Error('The application has not been granted this action'), { status: 403 }));
    const req = request('/checkouts/chk_1', 'GET');
    const { res } = response();
    await expect(createController().proxy(req, res)).rejects.toThrow('not been granted');
    expect(applications.authorizeAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'payments:checkout:read' }));
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });
  it('sends the Cloud Run identity separately from the payment runtime token', async () => {
    mockedCloudRunAuthorization.mockResolvedValue('Bearer google-id-token');
    const { res, state } = response();
    await createController().proxy(request('/checkouts', 'POST', {
      referenceId: 'order-iam', amount: { amountMinor: 100, currency: 'PHP' },
      successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel',
    }), res);

    expect(state.status).toBe(200);
    const headers = (mockedAxios.request.mock.calls[0][0] as any).headers;
    expect(headers['x-serverless-authorization']).toBe('Bearer google-id-token');
    expect(headers.authorization).toBe('Bearer unit-test-runtime-token');
  });

  it('handles Cloud Run identity failures without leaving an idempotency request unreported', async () => {
    mockedCloudRunAuthorization.mockRejectedValueOnce(new Error('identity token unavailable'));
    const { res, state } = response();
    await createController().proxy(request('/checkouts', 'POST', {
      referenceId: 'order-iam-failure', amount: { amountMinor: 100, currency: 'PHP' },
      successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel',
    }), res);

    expect(state.status).toBe(502);
    expect(state.body).toEqual({
      success: false,
      error: { code: 'PAYMENT_UPSTREAM_UNREACHABLE', message: 'identity token unavailable' },
    });
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });

  it('reports a non-JSON runtime rejection with its HTTP status', async () => {
    mockedAxios.request.mockResolvedValueOnce({
      status: 401,
      headers: { 'content-type': 'text/html' },
      data: '<html><title>401 Unauthorized</title></html>',
      config: {},
      statusText: 'Unauthorized',
    } as any);
    const { res, state } = response();
    await createController().proxy(request('/checkouts', 'POST', {
      referenceId: 'order-html', amount: { amountMinor: 100, currency: 'PHP' },
      successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel',
    }), res);

    expect(state.status).toBe(502);
    expect(state.body).toEqual({
      success: false,
      error: {
        code: 'PAYMENT_UPSTREAM_INVALID_RESPONSE',
        message: 'Payment runtime returned HTTP 401 with a non-JSON body',
      },
    });
  });
});
