import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { PaymentsController } from '../../apps/gateway/src/domains/payments/features/payment-facade/payments.controller';
import { PaymentIdempotencyService } from '../../apps/gateway/src/domains/payments/shared/payment-idempotency.service';
import { PaymentLimitsService } from '../../apps/gateway/src/domains/payments/features/payment-limits/payment-limits.service';
import { ApplicationAccessService } from '../../apps/gateway/src/domains/control-plane/application-access.service';

const KEY = 'ak_test_aaaaaaaaaaaaaaaa_' + 'b'.repeat(43);
// The control plane accepts KEY for the integration application, organization and project.
const applications = {
  authorizeAction: jest.fn(async ({ bearer, action }: { bearer: string; action: string }) => {
    if (bearer !== KEY) throw Object.assign(new Error('Invalid application key'), { status: 401 });
    return {
      identity: { organizationId: 'org-integration', projectId: 'project-integration', environmentId: 'env_1', environmentKind: 'test', applicationId: 'app-integration', credentialId: 'crd_1' },
      resourceOwner: { groupId: 'org-integration', projectId: 'project-integration' },
      requestKey: 'req:1',
      capability: 'payments',
      action,
      signedContext: 'unused',
    };
  }),
  recordOutcome: jest.fn().mockResolvedValue(undefined),
};

describe('payment gateway to runtime integration', () => {
  const envKeys = [
    'APICENTER_PAYMENTS_URL',
    'APICENTER_PAYMENTS_INTERNAL_TOKEN',
    'APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST',
    'PAYMENT_PROVIDER_MODE',
    'DATABASE_URL',
    'PAYMENT_DATABASE_URL',
    'SHARED_SERVICES_DATABASE_URL',
    'DATABASE_ENABLED',
    'NODE_ENV',
  ];
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  let gateway: INestApplication;
  let gatewayUrl: string;
  let paymentServer: Server;
  let paymentUrl: string;

  beforeAll(async () => {
    for (const key of envKeys) delete process.env[key];
    process.env.NODE_ENV = 'test';
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN = 'integration-runtime-token';
    process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST = 'integration-runtime-token';

    const { app: paymentApp } = await import('../../apps/payments/src/server');
    paymentServer = paymentApp.listen(0);
    await new Promise<void>((resolve) => paymentServer.once('listening', resolve));
    paymentUrl = `http://127.0.0.1:${(paymentServer.address() as AddressInfo).port}`;
    process.env.APICENTER_PAYMENTS_URL = paymentUrl;

    const module = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        PaymentIdempotencyService,
        // Without DATABASE_ENABLED the real limits service applies plan defaults in memory.
        { provide: PaymentLimitsService, useFactory: () => new PaymentLimitsService({} as never) },
        { provide: ApplicationAccessService, useValue: applications },
      ],
    }).compile();

    gateway = module.createNestApplication();
    gateway.setGlobalPrefix('api/v1');
    await gateway.listen(0);
    gatewayUrl = await gateway.getUrl();
  });

  afterAll(async () => {
    await gateway?.close();
    if (paymentServer?.listening) {
      await new Promise<void>((resolve, reject) => paymentServer.close((error) => error ? reject(error) : resolve()));
    }
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('creates, replays, and reads an owned checkout through both HTTP servers', async () => {
    const request = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Idempotency-Key': 'integration-checkout-key-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        referenceId: 'integration-order-1',
        amount: { amountMinor: 39900, currency: 'PHP' },
        successUrl: 'https://shop.example.test/success',
        cancelUrl: 'https://shop.example.test/cancel',
      }),
    };

    const created = await fetch(`${gatewayUrl}/api/v1/payments/checkouts`, request);
    expect(created.status).toBe(201);
    const payload = await created.json() as { data: { checkoutId: string; referenceId: string; status: string } };
    expect(payload.data).toMatchObject({ referenceId: 'integration-order-1', status: 'pending' });

    const replay = await fetch(`${gatewayUrl}/api/v1/payments/checkouts`, request);
    expect(replay.status).toBe(201);
    expect(replay.headers.get('x-idempotency-replayed')).toBe('true');
    expect(await replay.json()).toEqual(payload);

    const found = await fetch(`${gatewayUrl}/api/v1/payments/checkouts/by-reference/integration-order-1`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({ data: payload.data });
  });
});
