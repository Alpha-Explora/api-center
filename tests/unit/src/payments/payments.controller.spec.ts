import axios from 'axios';
import { PaymentsController } from '../../../../apps/gateway/src/domains/payments/features/payment-facade/payments.controller';
import { PaymentIdempotencyService } from '../../../../apps/gateway/src/domains/payments/shared/payment-idempotency.service';
const paymentLimits = { enforce: jest.fn().mockResolvedValue(undefined) } as any;
const createController = () => new PaymentsController(new PaymentIdempotencyService(), paymentLimits);

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function request(path: string, method: string, body?: Record<string, unknown>) {
  return {
    method,
    originalUrl: `/api/v1/payments${path}`,
    headers: {
      authorization: 'Bearer apic_test_key',
      'idempotency-key': 'idempotency-key-123456',
    },
    get(name: string) { return this.headers[name.toLowerCase()]; },
    body,
    paymentPrincipal: {
      ownerTribeId: 'tribe-alpha',
      projectId: 'project-alpha',
      consumerServiceId: 'service-alpha',
      environment: 'test' as const,
      scopes: ['payments:read', 'payments:write'],
    },
    tribeId: 'client-supplied-tribe',
    user: { environment: 'live' as const },
  } as any;
}

function response() {
  const state: { status?: number; headers: Record<string, string>; body?: unknown } = { headers: {} };
  const res = {
    setHeader: jest.fn((name: string, value: string) => { state.headers[name] = value; }),
    status: jest.fn((status: number) => { state.status = status; return res; }),
    json: jest.fn((body: unknown) => { state.body = body; return res; }),
    send: jest.fn((body: unknown) => { state.body = body; return res; }),
  } as any;
  return { res, state };
}

describe('PaymentsController', () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRedisCacheUrl = process.env.REDIS_CACHE_URL;
  const originalRuntimeToken = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;

  beforeAll(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_CACHE_URL;
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = 'unit-test-runtime-token';
  });

  afterAll(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = originalRedisUrl;
    if (originalRedisCacheUrl === undefined) delete process.env.REDIS_CACHE_URL; else process.env.REDIS_CACHE_URL = originalRedisCacheUrl;
    if (originalRuntimeToken === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;
    else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = originalRuntimeToken;
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
    ['GET', '/intents/pi_123', undefined],
    ['POST', '/intents/pi_123/confirm', {}],
    ['POST', '/intents/pi_123/cancel', {}],
    ['POST', '/customers', { customerReference: 'customer-123', email: 'customer@example.test' }],
    ['GET', '/customers/cus_123', undefined],
    ['POST', '/plans', { name: 'Starter', amount: 2000, interval: 'monthly' }],
    ['GET', '/plans', undefined],
    ['GET', '/plans/plan_123', undefined],
    ['POST', '/refunds', { paymentId: 'pay_123', amount: { amountMinor: 100, currency: 'PHP' } }],
    ['GET', '/refunds/ref_123', undefined],
    ['POST', '/subscriptions', { customerId: 'cus_123', referenceId: 'sub-123', planId: 'plan_123' }],
    ['GET', '/subscriptions/sub_123', undefined],
    ['POST', '/subscriptions/sub_123/cancel', {}],
    ['GET', '/subscriptions/sub_123/invoices', undefined],
    ['GET', '/invoices/inv_123', undefined],
  ])('maps %s %s to the private payments runtime', async (method, path, body) => {
    const idempotency = new PaymentIdempotencyService();
    const controller = new PaymentsController(idempotency, paymentLimits);
    const { res, state } = response();

    await controller.proxy(request(path, method, body), res);

    expect(state.status).toBe(200);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    expect(mockedAxios.request.mock.calls[0][0]).toEqual(expect.objectContaining({
      method,
      url: expect.stringContaining('/'),
    }));
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
    expect(config.headers['x-tribe-id']).toBe('tribe-alpha');
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

  it('rejects unlisted routes and a read-only key on a mutation', async () => {
    const controller = createController();
    await expect(controller.proxy(request('/admin', 'GET'), response().res))
      .rejects.toMatchObject({ response: { code: 'PAYMENT_OPERATION_NOT_FOUND' } });
    const readOnly = request('/checkouts', 'POST', {
      referenceId: 'order-1', amount: { amountMinor: 100, currency: 'PHP' },
      successUrl: 'https://app.test/success', cancelUrl: 'https://app.test/cancel',
    });
    readOnly.paymentPrincipal.scopes = ['payments:read'];
    await expect(controller.proxy(readOnly, response().res))
      .rejects.toMatchObject({ response: { code: 'INSUFFICIENT_SCOPE' } });
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
});
