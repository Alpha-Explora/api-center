import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { PaymentsController } from '../../apps/gateway/src/domains/payments';
import { PaymentIdempotencyService } from '../../apps/gateway/src/domains/payments/shared/payment-idempotency.service';
import { PaymentLimitsService } from '../../apps/gateway/src/domains/payments/features/payment-limits/payment-limits.service';
import { ApplicationAccessService } from '../../apps/gateway/src/domains/control-plane/application-access.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const KEY = 'ak_test_aaaaaaaaaaaaaaaa_' + 'b'.repeat(43);
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
      controllers: [PaymentsController],
      providers: [
        PaymentIdempotencyService,
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

  it('rejects calls without an application key before proxying', async () => {
    for (const headers of [{}, { Authorization: 'Bearer apic_test_legacy_payment_key' }] as Array<Record<string, string>>) {
      const response = await fetch(`${await app.getUrl()}/api/v1/payments/capabilities`, { headers });
      expect(response.status).toBe(401);
    }
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });
});
