import { ApiCenter } from '../../src';

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify({ success: true, data }),
  } as Response;
}

function calls(fetchImpl: jest.Mock): Array<[string, RequestInit]> {
  return fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
}

describe('ApiCenter payments namespace', () => {
  it('maps payment resources to the published routes and applies payment auth only there', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => jsonResponse({ status: 'pending', resourceId: 'pending-1' }, 202));
    const api = new ApiCenter({
      baseUrl: 'https://gateway.example.test',
      auth: { getAccessToken: async () => 'service-token' },
      paymentApiKey: 'apic_payment_key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const idem = { idempotencyKey: 'payment-operation-0001' };

    await api.payments.checkouts.create({
      referenceId: 'order-1', amount: { amountMinor: 500, currency: 'PHP' },
      successUrl: 'https://app.example.test/success', cancelUrl: 'https://app.example.test/cancel',
    }, idem);
    await api.payments.checkouts.get('checkout / 1');
    await api.payments.checkouts.getByReference('order 1');
    await api.payments.checkouts.cancel('checkout-1', idem);
    await api.payments.intents.create({ referenceId: 'order-2', amount: { amountMinor: 500, currency: 'PHP' } }, idem);
    await api.payments.intents.createQrPh({ referenceId: 'order-3', amount: { amountMinor: 500, currency: 'PHP' } }, idem);
    await api.payments.intents.get('intent-1');
    const confirmation = { paymentMethodId: 'pm_1', clientKey: 'pi_1_client', returnUrl: 'https://app.example.test/return' };
    await api.payments.intents.confirm('intent-1', confirmation, idem);
    await api.payments.intents.cancel('intent-1', idem);
    await api.payments.customers.create({ customerReference: 'cust-1', email: 'person@example.com' }, idem);
    await api.payments.customers.get('customer-1');
    await api.payments.plans.create({ name: 'Monthly', amount: 500, interval: 'monthly' }, idem);
    await api.payments.plans.get('plan-1');
    await api.payments.plans.list();
    await api.payments.paymentLinks.create({
      referenceId: 'order-4', amount: { amountMinor: 500, currency: 'PHP' }, description: 'Order',
    }, idem);
    await api.payments.paymentLinks.list();
    await api.payments.paymentLinks.get('link-1');
    await api.payments.paymentLinks.archive('link-1', idem);
    await api.payments.paymentLinks.unarchive('link-1', idem);
    await api.payments.refunds.create({ paymentId: 'payment-1', amount: { amountMinor: 500, currency: 'PHP' } }, idem);
    await api.payments.refunds.get('refund-1');
    await api.payments.subscriptions.create({ customerId: 'customer-1', referenceId: 'sub-1', planId: 'plan-1' }, idem);
    await api.payments.subscriptions.get('sub-1');
    await api.payments.subscriptions.cancel('sub-1', idem);
    await api.payments.subscriptions.listInvoices('sub-1');
    await api.payments.invoices.get('invoice-1');
    await api.payments.records.list({ type: 'payment', status: 'paid', cursor: 'page / +' });
    await api.payments.capabilities.get();

    expect(calls(fetchImpl).map(([url, init]) => [url, init.method])).toEqual([
      ['https://gateway.example.test/api/v1/payments/checkouts', 'POST'],
      ['https://gateway.example.test/api/v1/payments/checkouts/checkout%20%2F%201', 'GET'],
      ['https://gateway.example.test/api/v1/payments/checkouts/by-reference/order%201', 'GET'],
      ['https://gateway.example.test/api/v1/payments/checkouts/checkout-1/cancel', 'POST'],
      ['https://gateway.example.test/api/v1/payments/intents', 'POST'],
      ['https://gateway.example.test/api/v1/payments/intents/qrph', 'POST'],
      ['https://gateway.example.test/api/v1/payments/intents/intent-1', 'GET'],
      ['https://gateway.example.test/api/v1/payments/intents/intent-1/confirm', 'POST'],
      ['https://gateway.example.test/api/v1/payments/intents/intent-1/cancel', 'POST'],
      ['https://gateway.example.test/api/v1/payments/customers', 'POST'],
      ['https://gateway.example.test/api/v1/payments/customers/customer-1', 'GET'],
      ['https://gateway.example.test/api/v1/payments/plans', 'POST'],
      ['https://gateway.example.test/api/v1/payments/plans/plan-1', 'GET'],
      ['https://gateway.example.test/api/v1/payments/plans', 'GET'],
      ['https://gateway.example.test/api/v1/payments/payment-links', 'POST'],
      ['https://gateway.example.test/api/v1/payments/payment-links', 'GET'],
      ['https://gateway.example.test/api/v1/payments/payment-links/link-1', 'GET'],
      ['https://gateway.example.test/api/v1/payments/payment-links/link-1', 'PATCH'],
      ['https://gateway.example.test/api/v1/payments/payment-links/link-1', 'PATCH'],
      ['https://gateway.example.test/api/v1/payments/refunds', 'POST'],
      ['https://gateway.example.test/api/v1/payments/refunds/refund-1', 'GET'],
      ['https://gateway.example.test/api/v1/payments/subscriptions', 'POST'],
      ['https://gateway.example.test/api/v1/payments/subscriptions/sub-1', 'GET'],
      ['https://gateway.example.test/api/v1/payments/subscriptions/sub-1/cancel', 'POST'],
      ['https://gateway.example.test/api/v1/payments/subscriptions/sub-1/invoices', 'GET'],
      ['https://gateway.example.test/api/v1/payments/invoices/invoice-1', 'GET'],
      [expect.stringContaining('/api/v1/payments/records?'), 'GET'],
      ['https://gateway.example.test/api/v1/payments/capabilities', 'GET'],
    ]);

    for (const [url, init] of calls(fetchImpl)) {
      expect(new Headers(init.headers).get('authorization')).toBe(
        url.includes('/api/v1/payments/') ? 'Bearer apic_payment_key' : 'Bearer service-token',
      );
    }
    for (const index of [0, 3, 4, 5, 7, 8, 9, 11, 14, 17, 18, 19, 21, 23]) {
      expect(new Headers(calls(fetchImpl)[index]?.[1].headers).get('idempotency-key')).toBe('payment-operation-0001');
    }
    expect(JSON.parse(String(calls(fetchImpl)[7]?.[1].body))).toEqual(confirmation);
    expect(new URL(calls(fetchImpl)[26]?.[0] ?? '').searchParams.get('cursor')).toBe('page / +');
  });

  it('returns 202 pending resources and can use service auth when no payment key is set', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ status: 'pending', resourceId: 'pending-1' }, 202));
    const api = new ApiCenter({
      baseUrl: 'https://gateway.example.test',
      auth: { getAccessToken: async () => 'service-token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(api.payments.checkouts.create({
      referenceId: 'order-1', amount: { amountMinor: 500, currency: 'PHP' },
      successUrl: 'https://app.example.test/success', cancelUrl: 'https://app.example.test/cancel',
    }, { idempotencyKey: 'checkout-pending-0001' })).resolves.toEqual({
      status: 'pending', resourceId: 'pending-1',
    });
    expect(new Headers(calls(fetchImpl)[0]?.[1].headers).get('authorization')).toBe('Bearer service-token');
  });
});
