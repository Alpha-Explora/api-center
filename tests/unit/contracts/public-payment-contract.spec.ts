import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(process.cwd(), relativePath), 'utf8')) as Record<string, any>;
}

describe('public payment contracts', () => {
  const openApi = parse(readFileSync(join(process.cwd(), 'contracts/public/apicenter.openapi.yaml'), 'utf8')) as Record<string, any>;
  const asyncApi = parse(readFileSync(join(process.cwd(), 'contracts/public/apicenter.asyncapi.yaml'), 'utf8')) as Record<string, any>;
  const requiredEnvelopeFields = ['eventId', 'contractVersion', 'eventType', 'ownerTribeId', 'consumerServiceId', 'referenceId', 'aggregateType', 'aggregateId', 'aggregateVersion', 'occurredAt', 'data'];

  it('exposes versioned HTTP and event contracts', () => {
    expect(openApi.openapi).toBe('3.2.0');
    expect(openApi.security[0].ApiKeyAuth).toEqual([]);
    expect(openApi.components.headers['Idempotency-Key']).toBeDefined();
    expect(asyncApi.asyncapi).toBe('3.1.0');
    expect(asyncApi.channels['apicenter.payment-events.{environment}']).toBeDefined();
    expect(asyncApi.components.schemas.PaymentEvent.required).toEqual(expect.arrayContaining(requiredEnvelopeFields));
    expect(asyncApi.components.messages.PaymentCheckoutPaid.payload.properties.aggregateVersion).toBeDefined();
  });

  it('keeps every HTTP mutation idempotent and inside the public payment namespace', () => {
    for (const [route, pathItem] of Object.entries<any>(openApi.paths)) {
      expect(route).toMatch(/^\/api\/v1\/payments\//);
      for (const [method, operation] of Object.entries<any>(pathItem)) {
        if (!['post', 'put', 'patch', 'delete'].includes(method)) continue;
        expect(operation.parameters).toEqual(expect.arrayContaining([
          { $ref: '#/components/headers/Idempotency-Key' },
        ]));
      }
    }
    expect(openApi.components.schemas.CheckoutCreateRequest.properties.metadata.additionalProperties.type).toBe('string');
    expect(JSON.stringify(openApi).toLowerCase()).not.toContain('paymongo_');
  });

  it('ships canonical created and paid event examples', () => {
    const created = readJson('contracts/public/examples/payment-checkout-created.json');
    const paid = readJson('contracts/public/examples/payment-checkout-paid-event.json');
    for (const event of [created, paid]) {
      for (const field of requiredEnvelopeFields) expect(event[field]).toBeDefined();
      expect(event.contractVersion).toBe('1.0');
      expect(event.data.environment).toMatch(/^(test|live)$/);
      expect(event.data.aggregateVersion).toBe(event.aggregateVersion);
    }
    expect(paid.eventType).toBe('payment.checkout.paid');
    expect(paid.data.status).toBe('paid');
    expect(paid.data.amount).toEqual({ amountMinor: 39900, currency: 'PHP' });
  });
});