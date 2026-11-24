import type { Server } from 'node:http';
import { PaymentIntentsService } from '../../../../apps/payments/src/features/payment-intents/payment-intents.service';
import { PayMongoError } from '../../../../apps/payments/src/shared/payment-errors';
import { paymongoRequest } from '../../../../apps/payments/src/shared/paymongo-client';
import { toNeutralError, toTransferFailure } from '../../../../apps/payments/src/shared/provider-errors';

const realFetch = global.fetch;

function providerAnswers(status: number, body: unknown) {
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://api.paymongo.com')) {
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  }) as typeof fetch;
}

describe('provider-neutral payment errors', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.PAYMENT_PROVIDER_MODE = 'test';
    process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_neutral_errors';
  });
  const restore = (keys: string[]) => {
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  };
  afterEach(() => {
    global.fetch = realFetch;
    restore(['PAYMENT_PROVIDER_MODE', 'PAYMONGO_TEST_SECRET_KEY']);
  });
  afterAll(() => restore(['APICENTER_PAYMENTS_INTERNAL_TOKEN', 'SHARED_SERVICES_DATABASE_URL']));

  it('maps provider statuses to APICenter codes', () => {
    expect(toNeutralError(400, 'parameter_invalid')).toMatchObject({ status: 400, code: 'PAYMENT_REQUEST_INVALID' });
    expect(toNeutralError(404, 'resource_not_found')).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(toNeutralError(429, undefined)).toMatchObject({ status: 429, code: 'PROVIDER_RATE_LIMITED' });
    expect(toNeutralError(500, 'internal_server_error')).toMatchObject({ status: 502, code: 'PROVIDER_ERROR' });
    expect(toTransferFailure('destination_account_invalid')).toBe('invalid_destination');
    expect(toTransferFailure('unprocessable_entity')).toBe('rejected');
    expect(toTransferFailure(null)).toBeNull();
  });

  it('a provider decline becomes PAYMENT_DECLINED with a neutral reason', async () => {
    providerAnswers(400, { errors: [{ code: 'insufficient_funds', detail: 'Provider says: card 4343 has no funds' }] });
    const error = await paymongoRequest('/payment_intents', { method: 'POST', body: {} }).catch((caught) => caught);
    expect(error).toBeInstanceOf(PayMongoError);
    expect(error).toMatchObject({ statusCode: 402, code: 'PAYMENT_DECLINED', providerStatus: 400,
      details: { reason: 'insufficient_funds', deprecatedProviderCode: 'insufficient_funds' } });
    expect(error.message).not.toContain('4343');
  });

  it('a provider credential failure is our outage, not the caller\'s fault', async () => {
    providerAnswers(401, { errors: [{ code: 'api_key_invalid', detail: 'bad key' }] });
    const error = await paymongoRequest('/payment_intents').catch((caught) => caught);
    expect(error).toMatchObject({ statusCode: 503, code: 'PROVIDER_UNAVAILABLE', providerStatus: 401 });
  });

  it('reports a failed intent attempt with a neutral reason', async () => {
    const request = jest.fn(async () => ({ data: { id: 'pi_1', attributes: { status: 'awaiting_payment_method',
      amount: 10_000, currency: 'PHP', last_payment_error: { failed_code: 'card_expired', failed_message: 'Provider text' } } } }));
    const intent = await new PaymentIntentsService(request as never, () => false).getPaymentIntent('pi_1');
    expect(intent).toMatchObject({ status: 'failed', lastPaymentError: { code: 'card_expired',
      message: 'The payment was declined because the card has expired.', deprecatedProviderCode: 'card_expired' } });
  });

  describe('through the runtime', () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      process.env.PAYMENT_PROVIDER_MODE = 'test';
      process.env.PAYMONGO_TEST_SECRET_KEY = 'sk_test_neutral_errors';
      process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = 'test-runtime-token';
      delete process.env.SHARED_SERVICES_DATABASE_URL;
      const { app } = require('../../../../apps/payments/src/server') as { app: { listen: (port: number, callback: () => void) => Server } };
      server = await new Promise<Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP server');
      baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('returns only neutral fields, with the deprecation headers', async () => {
      providerAnswers(400, { errors: [{ code: 'parameter_invalid', detail: 'internal provider detail XYZ' }] });
      const response = await realFetch(`${baseUrl}/payment-intents`, {
        method: 'POST',
        headers: { authorization: 'Bearer test-runtime-token', 'content-type': 'application/json',
          'x-apicenter-owner-tribe-id': 'tribe-a', 'x-apicenter-project-id': 'project-a',
          'x-apicenter-consumer-service-id': 'service-a', 'x-apicenter-environment': 'test' },
        body: JSON.stringify({ amount: 10_000, currency: 'PHP', referenceId: 'order-errors' }),
      });
      const text = await response.text();
      expect(response.status).toBe(400);
      expect(JSON.parse(text).error).toEqual({ code: 'PAYMENT_REQUEST_INVALID',
        message: 'The payment provider rejected the request.', details: { deprecatedProviderCode: 'parameter_invalid' } });
      expect(text).not.toContain('XYZ');
      expect(response.headers.get('deprecation')).toBe('true');
      expect(response.headers.get('sunset')).toBe('Mon, 01 Mar 2027 00:00:00 GMT');
    });
  });
});
