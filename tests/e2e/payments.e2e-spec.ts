import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { generateKeyPairSync } from 'node:crypto';
import { PaymentsController } from '../../apps/gateway/src/domains/payments';
import { PaymentIdempotencyService } from '../../apps/gateway/src/domains/payments/shared/payment-idempotency.service';
import { PaymentLimitsService } from '../../apps/gateway/src/domains/payments/features/payment-limits/payment-limits.service';
import { ApplicationAccessService } from '../../apps/gateway/src/domains/control-plane/application-access.service';
import { PaymentReturnController } from '../../apps/gateway/src/domains/payments/features/payment-return/payment-return.controller';
import { PaymentReturnLinks } from '../../apps/gateway/src/domains/payments/features/payment-return/payment-return-links';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const KEY = 'ak_test_aaaaaaaaaaaaaaaa_' + 'b'.repeat(43);
const RETURN_PAGE = 'https://api.example.test/api/v1/payment-return/';
const signingKey = JSON.stringify({ ...generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }), kid: 'test' });
// The control plane accepts KEY and resolves it to its application, organization and project.
const applications = {
  authorizeAction: jest.fn(async ({ bearer, action }: { bearer: string; action: string }) => {
    if (bearer !== KEY) throw Object.assign(new Error('Invalid application key'), { status: 401, response: { code: 'INVALID_CREDENTIAL' } });
    return {
      identity: { organizationId: 'tribe-alpha', projectId: 'project-alpha', environmentId: 'env_1', environmentKind: 'test', applicationId: 'service-alpha', credentialId: 'crd_1' },
      resourceOwner: { groupId: 'tribe-alpha', projectId: 'project-alpha' },
      requestKey: 'req:1',
      capability: 'payments',
      action,
      signedContext: 'unused',
    };
  }),
  recordOutcome: jest.fn().mockResolvedValue(undefined),
};

describe('Payments facade (e2e)', () => {
  let app: INestApplication;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalDatabaseEnabled = process.env.DATABASE_ENABLED;
  const originalInternalToken = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_ENABLED;
    process.env.APICENTER_PAYMENTS_URL = 'http://payments.internal';
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = 'test-internal-token';

    const moduleFixture = await Test.createTestingModule({
      controllers: [PaymentsController, PaymentReturnController],
      providers: [
        PaymentIdempotencyService,
        { provide: PaymentReturnLinks, useValue: new PaymentReturnLinks({
          APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: signingKey, APICENTER_PUBLIC_URL: 'https://api.example.test' }) },
        { provide: PaymentLimitsService, useValue: { enforce: jest.fn().mockResolvedValue(undefined) } },
        { provide: ApplicationAccessService, useValue: applications },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);
  });

  beforeEach(() => {
    mockedAxios.request.mockReset();
    const mockResponse = {
      status: 201,
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({
        success: true,
        data: {
          checkoutId: 'chk_e2e',
          referenceId: 'order-e2e',
          status: 'pending',
          amount: { value: 39900, currency: 'PHP' },
          redirectUrl: 'https://checkout.example.test/chk_e2e',
        },
      }),
      config: {},
      statusText: 'Created',
    };
    mockedAxios.request.mockResolvedValue(mockResponse as any);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.APICENTER_PAYMENTS_URL;
    if (originalInternalToken === undefined) delete process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
    else process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = originalInternalToken;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalDatabaseEnabled === undefined) delete process.env.DATABASE_ENABLED; else process.env.DATABASE_ENABLED = originalDatabaseEnabled;
  });

  it('authenticates the consumer and prevents tenant/environment header spoofing', async () => {
    const response = await fetch(`${await app.getUrl()}/api/v1/payments/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Idempotency-Key': 'e2e-idempotency-123456',
        'X-Tribe-ID': 'attacker-tribe',
        'X-APICenter-Environment': 'live',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        referenceId: 'order-e2e',
        amount: { amountMinor: 39900, currency: 'PHP' },
        successUrl: 'https://app.example.test/success',
        cancelUrl: 'https://app.example.test/cancel',
        tribeId: 'attacker-tribe',
        environment: 'live',
      }),
    });

    expect(response.status).toBe(201);
    const config = mockedAxios.request.mock.calls[0][0] as any;
    expect(config.headers['x-apicenter-owner-tribe-id']).toBe('tribe-alpha');
    expect(config.headers['x-apicenter-project-id']).toBe('project-alpha');
    expect(config.headers['x-apicenter-environment']).toBe('test');
  });

  it('replays a matching mutation without a second private-runtime call', async () => {
    const url = `${await app.getUrl()}/api/v1/payments/checkouts`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Idempotency-Key': 'e2e-replay-key-123456',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        referenceId: 'order-replay',
        amount: { amountMinor: 39900, currency: 'PHP' },
        successUrl: 'https://app.example.test/success',
        cancelUrl: 'https://app.example.test/cancel',
      }),
    };

    const first = await fetch(url, options);
    const second = await fetch(url, options);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual(await first.clone().json());
  });

  const post = async (path: string, body: unknown, key: string) => fetch(`${await app.getUrl()}/api/v1/payments${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Idempotency-Key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const runtimeBody = (call = 0) => (mockedAxios.request.mock.calls[call][0] as any).data;

  it('limits a checkout to the methods asked for and sends app links through the return page', async () => {
    const response = await post('/checkouts', { referenceId: 'booking-1', amount: { amountMinor: 39900, currency: 'PHP' },
      successUrl: 'serbizio-customer://booking/1?paid=1', cancelUrl: 'https://app.example.test/cancel',
      paymentMethods: ['gcash'] }, 'e2e-methods-key-123456');

    expect(response.status).toBe(201);
    const body = runtimeBody();
    expect(body.paymentMethodsAllowed).toEqual(['gcash']);
    expect(body.paymentMethods).toBeUndefined();
    expect(body.cancelUrl).toBe('https://app.example.test/cancel');
    expect(body.successUrl.startsWith(RETURN_PAGE)).toBe(true);

    const forwarded = await fetch(`${await app.getUrl()}${new URL(body.successUrl).pathname}`, { redirect: 'manual' });
    expect(forwarded.status).toBe(302);
    expect(forwarded.headers.get('location')).toBe('serbizio-customer://booking/1?paid=1');
  });

  it('forwards only to links the gateway signed', async () => {
    const forged = `${Buffer.from('evil-app://steal').toString('base64url')}.${Buffer.alloc(64).toString('base64url')}`;
    const response = await fetch(`${await app.getUrl()}/api/v1/payment-return/${forged}`, { redirect: 'manual' });
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('opens a wallet directly and rejects a wallet intent without a return link or with a disabled method', async () => {
    const intent = { referenceId: 'booking-2', amount: { amountMinor: 39900, currency: 'PHP' }, paymentMethod: 'gcash',
      returnUrl: 'serbizio-customer://booking/2' };
    expect((await post('/intents', intent, 'e2e-wallet-key-1234567')).status).toBe(201);
    expect(runtimeBody()).toMatchObject({ paymentMethod: 'gcash', amount: 39900, currency: 'PHP',
      returnUrl: expect.stringContaining(RETURN_PAGE) });

    const { returnUrl: _returnUrl, ...withoutReturn } = intent;
    const missing = await post('/intents', withoutReturn, 'e2e-wallet-key-2345678');
    expect(missing.status).toBe(400);

    process.env.APICENTER_PAYMENT_METHODS_TEST = 'card,qrph';
    try {
      const disabled = await post('/intents', { ...intent, referenceId: 'booking-3' }, 'e2e-wallet-key-3456789');
      expect(disabled.status).toBe(400);
      expect(await disabled.json()).toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE' });
      const capabilities = await fetch(`${await app.getUrl()}/api/v1/payments/capabilities`, {
        headers: { Authorization: `Bearer ${KEY}` } });
      expect(((await capabilities.json()) as { data: { paymentMethods: string[] } }).data.paymentMethods).toEqual(['card', 'qrph']);
    } finally { delete process.env.APICENTER_PAYMENT_METHODS_TEST; }
    expect(mockedAxios.request).toHaveBeenCalledTimes(1);
  });

  it('rejects calls without an application key before proxying', async () => {
    for (const headers of [{}, { Authorization: 'Bearer apic_test_legacy_payment_key' }] as Array<Record<string, string>>) {
      const response = await fetch(`${await app.getUrl()}/api/v1/payments/capabilities`, { headers });
      expect(response.status).toBe(401);
    }
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });
});
