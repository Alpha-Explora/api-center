import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';

const databaseUrl = process.env.LINKED_ACCOUNTS_TEST_DATABASE_URL;
const testDatabase = databaseUrl ? describe : describe.skip;

testDatabase('linked-account collection routing through the payments runtime', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  const calls: Array<{ path: string; account?: string }> = [];
  let pool: Pool;
  let server: Server;
  let closeOwnerPool: (() => Promise<void>) | undefined;
  let baseUrl: string;

  beforeAll(async () => {
    if (new URL(databaseUrl!).hostname !== '127.0.0.1') throw new Error('Use a disposable local payments database');
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`INSERT INTO shared_payment.merchant_accounts (environment, id, kind)
      VALUES ('test', 'org_routingFixture', 'child')`);
    await pool.query(`INSERT INTO shared_payment.project_linked_account_settings (environment, project_id, enabled, updated_by)
      VALUES ('test', 'linked-routing-fixture', true, 'fixture')`);
    await pool.query(`INSERT INTO shared_payment.project_merchant_accounts (environment, project_id, effective_from, merchant_account_id)
      VALUES ('test', 'linked-routing-fixture', now(), 'org_routingFixture')`);
    Object.assign(process.env, {
      SHARED_SERVICES_DATABASE_URL: databaseUrl, NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'test',
      APICENTER_PAYMENTS_INTERNAL_TOKEN: 'fixture-token', PAYMONGO_TEST_SECRET_KEY: 'sk_test_routing_fixture',
    });
    delete process.env.APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS;
    const { app } = await import('../../apps/payments/src/server');
    const { PaymentOwnerStore } = await import('../../apps/payments/src/shared/payment-owner-store');
    closeOwnerPool = async () => { await PaymentOwnerStore.getInstance().databasePool?.end(); };
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeOwnerPool?.();
    await pool?.end();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  function request(path: string, method = 'GET', body?: object, key?: string) {
    return originalFetch(baseUrl + path, {
      method, headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json',
        'x-apicenter-owner-tribe-id': 'org-fixture', 'x-apicenter-project-id': 'linked-routing-fixture',
        'x-apicenter-consumer-service-id': 'app-fixture', 'x-apicenter-environment': 'test',
        ...(key ? { 'idempotency-key': key } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  it('pins retries and refunds to the original child while new collections return to the parent', async () => {
    global.fetch = jest.fn(async (url, init) => {
      const path = new URL(String(url)).pathname;
      const account = new Headers(init?.headers).get('account-id') ?? undefined;
      calls.push({ path, account });
      const refund = path === '/v1/refunds';
      const read = init?.method === 'GET';
      const checkoutId = path.endsWith('/checkout_sessions') && !account ? 'cs_routingParent' : 'cs_routingChild';
      return new Response(JSON.stringify({
        data: refund ? { id: 'ref_routingChild', attributes: { status: 'succeeded', amount: 100, payment_id: 'pay_routingChild' } }
          : { id: checkoutId, attributes: { status: 'active', checkout_url: 'https://checkout.example.test/pay',
            ...(read ? { payments: [{ id: 'pay_routingChild', type: 'payment',
              attributes: { status: 'paid', amount: 100, currency: 'PHP' } }] } : {}) } },
      }));
    });

    const checkout = { referenceId: 'linked-fixture', amount: 100, currency: 'PHP' };
    const original = await request('/checkout/sessions', 'POST', checkout, 'linked-original-key');
    expect(original.status).toBe(201);
    const { data: { checkoutId } } = await original.json() as { data: { checkoutId: string } };

    await pool.query("UPDATE shared_payment.project_linked_account_settings SET enabled = false WHERE environment = 'test' AND project_id = 'linked-routing-fixture'");
    expect((await request('/checkout/sessions', 'POST', checkout, 'linked-original-key')).status).toBe(201);
    expect((await request('/checkout/sessions', 'POST', { ...checkout, referenceId: 'parent-fixture' }, 'linked-new-parent-key')).status).toBe(201);
    expect((await request(`/checkout/sessions/${checkoutId}`)).status).toBe(200);
    const { rows: [paid] } = await pool.query(`SELECT resource_id FROM shared_payment.resource_owners
      WHERE resource_type = 'payment' AND provider_resource_id = 'pay_routingChild'`);
    expect((await request(`/payments/${paid.resource_id}/refunds`, 'POST', { amount: 100 }, 'linked-refund-key')).status).toBe(201);
    expect(calls.map((call) => call.account)).toEqual([
      'org_routingFixture', 'org_routingFixture', undefined, 'org_routingFixture', 'org_routingFixture',
    ]);
    const { rows } = await pool.query(`SELECT DISTINCT merchant_account_id FROM shared_payment.resource_owners
      WHERE project_id = 'linked-routing-fixture' AND resource_type IN ('refund', 'payment')`);
    expect(rows).toEqual([{ merchant_account_id: 'org_routingFixture' }]);
  });
});
