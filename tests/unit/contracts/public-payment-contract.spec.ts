import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as Record<string, any>;
}

function readText(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('public payment contracts', () => {
  const openApi = parse(readFileSync(join(process.cwd(), 'contracts/public/apicenter.openapi.yaml'), 'utf8')) as Record<string, any>;
  const asyncApi = parse(readFileSync(join(process.cwd(), 'contracts/public/apicenter.asyncapi.yaml'), 'utf8')) as Record<string, any>;
  const requiredEnvelopeFields = ['eventId', 'contractVersion', 'eventType', 'environment', 'organizationId', 'projectId', 'applicationId', 'referenceId', 'aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', 'data'];

  it('exposes versioned HTTP and event contracts', () => {
    expect(openApi.openapi).toBe('3.2.0');
    expect(openApi.security).toEqual([{ ApplicationKey: [] }]);
    expect(Object.keys(openApi.components.securitySchemes)).toEqual(['ApplicationKey']);
    expect(openApi.components.securitySchemes.ApplicationKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'ApplicationKey',
    });
    expect(openApi.components.parameters.IdempotencyKey).toMatchObject({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: { type: 'string', minLength: 16, maxLength: 255 },
    });
    expect(asyncApi.asyncapi).toBe('3.1.0');
    expect(asyncApi.channels['apicenter.payment-events.{environment}']).toBeDefined();
    expect(asyncApi.components.schemas.PaymentEvent.required).toEqual(expect.arrayContaining(requiredEnvelopeFields));
    expect(asyncApi.components.messages.PaymentCheckoutPaid.payload.allOf[1].properties.data).toEqual({ $ref: '#/components/schemas/CheckoutPaid' });
  });

  it('keeps every HTTP mutation idempotent and inside the public payment namespace', () => {
    for (const [route, pathItem] of Object.entries<any>(openApi.paths)) {
      if (!route.startsWith('/api/v1/payments/')) continue;
      for (const [method, operation] of Object.entries<any>(pathItem)) {
        if (!['post', 'put', 'patch', 'delete'].includes(method)) continue;
        expect(operation.parameters).toEqual(expect.arrayContaining([
          { $ref: '#/components/parameters/IdempotencyKey' },
        ]));
        expect(operation.responses['409']).toEqual({ $ref: '#/components/responses/IdempotencyConflict' });
      }
    }
    expect(Object.keys(openApi.paths)).not.toContain('/api/v1/payments/payment-methods/setup');
    expect(openApi.components.schemas.CheckoutCreateRequest.properties.metadata.additionalProperties.type).toBe('string');
    expect(JSON.stringify(openApi).toLowerCase()).not.toContain('paymongo_');
  });

  it('maps each supported shared-service route to a contract-typed SDK method', () => {
    const shared = readJson('packages/contracts/shared-service-contract.json');
    const contracts = readText('packages/contracts/src/index.ts');
    const sources: Record<string, string> = {
      email: readText('packages/sdk/src/services/email.ts'),
      sms: readText('packages/sdk/src/services/sms.ts'),
      otp: readText('packages/sdk/src/services/otp.ts'),
      geo: readText('packages/sdk/src/services/geo.ts'),
      gauth: readText('packages/sdk/src/services/google-auth.ts'),
    };
    const operations = shared.sdkOperations as Array<Record<string, any>>;
    expect(operations.map((operation) => operation.operationId)).toEqual(expect.arrayContaining([
      'email.send', 'email.get', 'sms.send', 'sms.get',
      'otp.send', 'otp.verify', 'otp.get',
      'geo.geocode', 'geo.reverseGeocode', 'geo.checkGeofence',
      'auth.google.getAuthorizationUrl', 'auth.google.exchangeCode',
      'auth.google.refreshToken', 'auth.google.logout',
    ]));

    for (const operation of operations) {
      expect(operation.requiredScopes.length).toBeGreaterThan(0);
      expect(sources[operation.serviceId]).toContain(
        `@sdk-operation ${operation.operationId} ${operation.method} ${operation.path}`,
      );
      for (const typeName of [operation.requestType, operation.responseType].filter(Boolean)) {
        expect(contracts).toMatch(new RegExp(`\\b(?:interface|type) ${typeName}\\b`));
      }
      if (operation.idempotencyKey?.required) {
        expect(operation.idempotencyKey).toMatchObject({ minLength: 16, maxLength: 255 });
        expect(sources[operation.serviceId]).toContain('write: true, idempotencyKey: options?.idempotencyKey');
      }
    }
  });

  it('maps every supported payment operation in OpenAPI to a typed SDK resource method', () => {
    const sdk = readText('packages/sdk/src/services/payments.ts');
    const supportedIds = [
      'createCheckout', 'getCheckout', 'getCheckoutByReference', 'cancelCheckout',
      'createPaymentIntent', 'createQrPhPaymentIntent', 'getPaymentIntent', 'confirmPaymentIntent', 'cancelPaymentIntent',
      'createCustomer', 'getCustomer', 'createPlan', 'getPlan', 'listPlans',
      'createPaymentLink', 'listPaymentLinks', 'getPaymentLink', 'setPaymentLinkArchived',
      'createRefund', 'getRefund', 'createSubscription', 'getSubscription', 'cancelSubscription',
      'listSubscriptionInvoices', 'getInvoice', 'getPaymentCapabilities', 'listPaymentRecords',
    ];

    const discovered = new Set<string>();
    for (const [route, pathItem] of Object.entries<any>(openApi.paths)) {
      for (const [method, operation] of Object.entries<any>(pathItem)) {
        if (!['get', 'post', 'patch', 'put', 'delete'].includes(method)) continue;
        const operationId = operation.operationId as string;
        if (!supportedIds.includes(operationId)) continue;
        discovered.add(operationId);
        expect(sdk).toContain(`@sdk-operation ${operationId} ${method.toUpperCase()} ${route}`);
      }
    }
    expect([...discovered].sort()).toEqual([...supportedIds].sort());
  });

  it('ships a canonical contract 2.0 paid-checkout event example', () => {
    const paid = readJson('contracts/public/examples/payment-checkout-paid-event.json');
    for (const field of requiredEnvelopeFields) expect(paid[field]).toBeDefined();
    expect(paid.contractVersion).toBe('2.0');
    expect(paid.environment).toMatch(/^(test|live)$/);
    expect(paid.eventType).toBe('payment.checkout.paid');
    expect(paid.data).toEqual({ status: 'paid', checkoutId: 'chk_example_01', paymentId: 'pay_example_01', amount: 39900, currency: 'PHP' });
  });
});
