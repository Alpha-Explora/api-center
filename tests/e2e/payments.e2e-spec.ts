import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import axios from 'axios';
import { PaymentsController, PaymentApiKeyService } from '../../apps/gateway/src/domains/payments';
import { PaymentAuthGuard } from '../../apps/gateway/src/domains/payments/shared/payment-auth.guard';
import { PaymentIdempotencyService } from '../../apps/gateway/src/domains/payments/shared/payment-idempotency.service';
import { JwtAuthGuard } from '../../apps/gateway/src/domains/auth-security';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Payments facade (e2e)', () => {
  let app: INestApplication;
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRedisCacheUrl = process.env.REDIS_CACHE_URL;

  beforeAll(async () => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_CACHE_URL;
    process.env.APICENTER_PAYMENTS_URL = 'http://payments.internal';

    const moduleFixture = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        PaymentAuthGuard,
        PaymentIdempotencyService,
        {
          provide: PaymentApiKeyService,
          useValue: {
            resolve: jest.fn(async (key: string) => key === 'apic_test_valid'
              ? {
                ownerTribeId: 'tribe-alpha',
                consumerServiceId: 'service-alpha',
                environment: 'test',
                scopes: ['payments:read', 'payments:write'],
              }
              : null),
          },
        },
        { provide: JwtAuthGuard, useValue: { canActivate: jest.fn().mockReturnValue(false) } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);
  });

  beforeEach(() => {
    jest.clearAllMocks();
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
    (axios as unknown as jest.Mock).mockResolvedValue(mockResponse);
    mockedAxios.request.mockResolvedValue(mockResponse as any);
  });

  afterAll(async () => {
    await app.close();
    delete process.env.APICENTER_PAYMENTS_URL;
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = originalRedisUrl;
    if (originalRedisCacheUrl === undefined) delete process.env.REDIS_CACHE_URL; else process.env.REDIS_CACHE_URL = originalRedisCacheUrl;
  });

  it('authenticates the consumer and prevents tenant/environment header spoofing', async () => {
    const response = await fetch(`${await app.getUrl()}/api/v1/payments/checkouts`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer apic_test_valid',
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
    const config = (axios as unknown as jest.Mock).mock.calls[0][0] as any;
    expect(config.headers['x-apicenter-owner-tribe-id']).toBe('tribe-alpha');
    expect(config.headers['x-apicenter-environment']).toBe('test');
  });

  it('replays a matching mutation without a second private-runtime call', async () => {
    const url = `${await app.getUrl()}/api/v1/payments/checkouts`;
    const options = {
      method: 'POST',
      headers: {
        Authorization: 'Bearer apic_test_valid',
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
    expect(axios as unknown as jest.Mock).toHaveBeenCalledTimes(1);
    expect(await second.json()).toEqual(await first.clone().json());
  });

  it('rejects missing or invalid API keys before proxying', async () => {
    const response = await fetch(`${await app.getUrl()}/api/v1/payments/capabilities`, {
      headers: { Authorization: 'Bearer apic_test_invalid' },
    });

    expect(response.status).toBe(401);
    expect(mockedAxios.request).not.toHaveBeenCalled();
  });
});