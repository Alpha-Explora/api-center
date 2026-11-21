import { ApiCenter, isPending } from '../../src';

const KEY = `ak_test_abcdefghijklmnop_${'B'.repeat(43)}`;
const BASE = 'https://api.apicenter.itsandbox.site';

function recorder(data: (url: string) => unknown = () => ({})) {
  const calls: Array<{ method: string; path: string; body: unknown; write: boolean }> = [];
  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      path: String(url).slice(BASE.length),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      write: headers.has('idempotency-key'),
    });
    return new Response(JSON.stringify({ success: true, data: data(String(url)) }), { status: 200 });
  });
  return { api: new ApiCenter({ apiKey: KEY, fetch: fetchImpl as unknown as typeof fetch }), calls };
}

describe('shared services', () => {
  it('maps each operation to its route, with idempotency keys only on writes', async () => {
    const { api, calls } = recorder();
    await api.email.send({ to: 'a@example.test', subject: 'S', text: 'T' });
    await api.email.get('msg/1');
    await api.sms.send({ to: '+639170000000', message: 'hi' });
    await api.sms.get('SM1');
    await api.otp.send({ channel: 'email', recipient: 'a@example.test' } as never);
    await api.otp.verify({ otpId: 'otp_1', code: '123456' } as never);
    await api.otp.get('otp_1');
    await api.geo.geocode({ address: 'Makati' });
    await api.geo.reverseGeocode({ latitude: 1, longitude: 2 });
    await api.geo.checkGeofence({ point: { latitude: 1, longitude: 2 } } as never);
    await api.auth.google.getAuthorizationUrl({ redirectUri: 'https://app.test/cb' } as never);
    await api.auth.google.exchangeCode({ code: 'c' } as never);
    await api.auth.google.refreshToken({ refreshToken: 'r' } as never);
    await api.auth.google.logout({ refreshToken: 'r' } as never);

    expect(calls.map(({ method, path, write }) => `${method} ${path}${write ? ' (write)' : ''}`)).toEqual([
      'POST /api/v1/shared/email/send (write)',
      'GET /api/v1/shared/email/status/msg%2F1',
      'POST /api/v1/shared/sms/send (write)',
      'GET /api/v1/shared/sms/status/SM1',
      'POST /api/v1/shared/otp/generate (write)',
      'POST /api/v1/shared/otp/verify (write)',
      'GET /api/v1/shared/otp/status/otp_1',
      'POST /api/v1/shared/geo/geocode',
      'POST /api/v1/shared/geo/reverse-geocode',
      'POST /api/v1/shared/geo/geofence/check',
      'POST /api/v1/shared/gauth/oauth/authorize',
      'POST /api/v1/shared/gauth/oauth/token',
      'POST /api/v1/shared/gauth/oauth/token/refresh',
      'POST /api/v1/shared/gauth/oauth/logout',
    ]);
    expect(calls[0].body).toEqual({ to: 'a@example.test', subject: 'S', text: 'T' });
  });
});

describe('payments', () => {
  it('maps resources to the published routes', async () => {
    const { api, calls } = recorder();
    const p = api.payments;
    await p.checkouts.create({ referenceId: 'o1', amount: { amountMinor: 100, currency: 'PHP' }, successUrl: 'https://a.test/s', cancelUrl: 'https://a.test/c' });
    await p.checkouts.get('chk_1');
    await p.checkouts.getByReference('order 1');
    await p.checkouts.cancel('chk_1', { reason: 'customer left' });
    await p.intents.create({} as never);
    await p.intents.createQrPh({} as never);
    await p.intents.get('pi_1');
    await p.intents.confirm('pi_1', {} as never);
    await p.intents.cancel('pi_1');
    await p.customers.create({} as never);
    await p.customers.get('cus_1');
    await p.plans.create({} as never);
    await p.plans.get('plan_1');
    await p.plans.list();
    await p.paymentLinks.create({} as never);
    await p.paymentLinks.list();
    await p.paymentLinks.get('pl_1');
    await p.paymentLinks.archive('pl_1');
    await p.paymentLinks.unarchive('pl_1');
    await p.refunds.create({} as never);
    await p.refunds.get('ref_1');
    await p.subscriptions.create({} as never);
    await p.subscriptions.get('sub_1');
    await p.subscriptions.cancel('sub_1');
    await p.subscriptions.listInvoices('sub_1');
    await p.invoices.get('inv_1');
    await p.capabilities.get();
    await p.payees.create({ externalRef: 'provider-1', legalName: 'Juan' });
    await p.payees.list({ limit: 10 });
    await p.payees.get('pye_1');
    await p.payees.setDestination('pye_1', { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan' });
    await p.payees.cashOut('pye_1');
    await p.allocations.release('pal_1');
    await p.allocations.cancel('pal_1');
    await p.payouts.list({ payeeId: 'pye_1' });
    await p.payouts.get('po_1');

    expect(calls.slice(-9).map(({ method, path, write }) => `${method} ${path}${write ? ' (write)' : ''}`)).toEqual([
      'POST /api/v1/payments/payees (write)',
      'GET /api/v1/payments/payees?limit=10',
      'GET /api/v1/payments/payees/pye_1',
      'PUT /api/v1/payments/payees/pye_1/destination (write)',
      'POST /api/v1/payments/payees/pye_1/cash-out (write)',
      'POST /api/v1/payments/allocations/pal_1/release (write)',
      'POST /api/v1/payments/allocations/pal_1/cancel (write)',
      'GET /api/v1/payments/payouts?payeeId=pye_1',
      'GET /api/v1/payments/payouts/po_1',
    ]);
    expect(calls.at(-6)!.body).toEqual({ type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09171234567', accountName: 'Juan' });
    calls.splice(-9);

    expect(calls.map(({ method, path, write }) => `${method} ${path}${write ? ' (write)' : ''}`)).toEqual([
      'POST /api/v1/payments/checkouts (write)',
      'GET /api/v1/payments/checkouts/chk_1',
      'GET /api/v1/payments/checkouts/by-reference/order%201',
      'POST /api/v1/payments/checkouts/chk_1/cancel (write)',
      'POST /api/v1/payments/intents (write)',
      'POST /api/v1/payments/intents/qrph (write)',
      'GET /api/v1/payments/intents/pi_1',
      'POST /api/v1/payments/intents/pi_1/confirm (write)',
      'POST /api/v1/payments/intents/pi_1/cancel (write)',
      'POST /api/v1/payments/customers (write)',
      'GET /api/v1/payments/customers/cus_1',
      'POST /api/v1/payments/plans (write)',
      'GET /api/v1/payments/plans/plan_1',
      'GET /api/v1/payments/plans',
      'POST /api/v1/payments/payment-links (write)',
      'GET /api/v1/payments/payment-links',
      'GET /api/v1/payments/payment-links/pl_1',
      'PATCH /api/v1/payments/payment-links/pl_1 (write)',
      'PATCH /api/v1/payments/payment-links/pl_1 (write)',
      'POST /api/v1/payments/refunds (write)',
      'GET /api/v1/payments/refunds/ref_1',
      'POST /api/v1/payments/subscriptions (write)',
      'GET /api/v1/payments/subscriptions/sub_1',
      'POST /api/v1/payments/subscriptions/sub_1/cancel (write)',
      'GET /api/v1/payments/subscriptions/sub_1/invoices',
      'GET /api/v1/payments/invoices/inv_1',
      'GET /api/v1/payments/capabilities',
    ]);
    expect(calls[3].body).toEqual({ reason: 'customer left' });
    expect(calls[17].body).toEqual({ archive: true });
    expect(calls[18].body).toEqual({ archive: false });
  });

  it('pages through records with listAll', async () => {
    const pages: Record<string, unknown> = {
      first: { records: [{ id: 'r1' }, { id: 'r2' }], nextCursor: 'c2' },
      c2: { records: [{ id: 'r3' }] },
    };
    const { api, calls } = recorder((url) => pages[new URL(url).searchParams.get('cursor') ?? 'first']);
    const ids: string[] = [];
    for await (const record of api.payments.records.listAll({ status: 'paid', limit: 2 })) ids.push((record as unknown as { id: string }).id);
    expect(ids).toEqual(['r1', 'r2', 'r3']);
    expect(calls.map((call) => call.path)).toEqual([
      '/api/v1/payments/records?status=paid&limit=2',
      '/api/v1/payments/records?status=paid&limit=2&cursor=c2',
    ]);
  });

  it('tells a pending write from a finished resource', () => {
    expect(isPending({ status: 'pending', resourceId: 'chk_1' })).toBe(true);
    expect(isPending({ checkoutId: 'chk_1', status: 'pending', referenceId: 'o1' } as never)).toBe(false);
  });
});
