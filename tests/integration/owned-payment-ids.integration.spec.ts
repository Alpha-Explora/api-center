// Migration 20261124001700 replaces provider-derived payment IDs with APICenter IDs. This spec builds a fresh
// database up to the migration before it, seeds old-format data, applies the migration, checks every stored
// copy, then runs the payments runtime against the result.
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Client, Pool } from 'pg';

const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const testDatabase = adminUrl ? describe : describe.skip;
const MIGRATION = '20261124001700_owned_payment_ids.sql';
const MINTED = /^(chk|pi|pay|ref|cus|plan|pl|sub|inv)_[0-9a-hjkmnp-tv-z]{26}$/;
const migrations = join(__dirname, '../../supabase/migrations');

testDatabase('APICenter-owned payment IDs', () => {
  const databaseName = `apicenter_owned_ids_${Date.now()}`;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };
  let databaseUrl: string;
  let pool: Pool;
  let server: Server | undefined;
  let baseUrl: string;
  let closeOwnerPool: (() => Promise<void>) | undefined;

  async function admin(sql: string) {
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    try { await client.query(sql); } finally { await client.end(); }
  }

  beforeAll(async () => {
    const url = new URL(adminUrl!);
    if (url.hostname !== '127.0.0.1') throw new Error('Use a disposable local database server');
    await admin(`CREATE DATABASE ${databaseName}`);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    pool = new Pool({ connectionString: databaseUrl, max: 2 });
    for (const role of ['anon', 'authenticated', 'service_role', 'api_center_app']) {
      const found = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      if (!found.rowCount) await pool.query(`CREATE ROLE ${role} NOLOGIN`);
    }
    for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql') && name < MIGRATION).sort()) {
      await pool.query(readFileSync(join(migrations, file), 'utf8'));
    }
    await pool.query(`INSERT INTO shared_payment.resource_owners
      (resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot, status)
      VALUES
      ('checkout', 'chk_OldCheckout1', 'test', 'org-ids', 'prj-ids', 'app-ids', 'order-1',
        '{"checkoutId":"chk_OldCheckout1","paymentId":"pay_OldPayment1","status":"paid"}', 'paid'),
      ('payment', 'pay_OldPayment1', 'test', 'org-ids', 'prj-ids', 'app-ids', NULL,
        '{"paymentId":"pay_OldPayment1","checkoutId":"chk_OldCheckout1","sourceId":"chk_OldCheckout1","paymentIntentId":"pi_InternalIntent","status":"paid","amount":10000,"currency":"PHP"}', 'paid'),
      ('refund', 'ref_OldRefund1', 'test', 'org-ids', 'prj-ids', 'app-ids', NULL,
        '{"refundId":"ref_OldRefund1","paymentId":"pay_OldPayment1","status":"succeeded","amount":500}', 'succeeded'),
      ('payment_link', 'pl_OldLink1', 'test', 'org-ids', 'prj-ids', 'app-ids', 'link-1',
        '{"paymentLinkId":"pl_OldLink1","status":"active"}', 'active'),
      ('invoice', 'inv_OldInvoice1', 'test', 'org-ids', 'prj-ids', 'app-ids', NULL, '{"invoiceId":"inv_OldInvoice1"}', 'open')`);
    await pool.query(`INSERT INTO shared_payment.payees (id, environment, organization_id, project_id, consumer_service_id, external_ref, legal_name)
      VALUES ('pye_ids', 'test', 'org-ids', 'prj-ids', 'app-ids', 'worker-1', 'Juan Dela Cruz')`);
    await pool.query(`INSERT INTO shared_payment.payout_allocations (id, environment, organization_id, project_id, consumer_service_id,
        merchant_account_id, payee_id, resource_type, resource_id, reference_id, payment_id, amount, gross_amount, status)
      VALUES ('pal_ids', 'test', 'org-ids', 'prj-ids', 'app-ids', 'parent', 'pye_ids', 'checkout', 'chk_OldCheckout1', 'order-1',
        'pay_OldPayment1', 1000, 10000, 'held')`);
    await pool.query(`INSERT INTO shared_payment.payee_adjustments (id, environment, project_id, merchant_account_id, payee_id, amount, reason, source_refund_id)
      VALUES ('padj_ids', 'test', 'prj-ids', 'parent', 'pye_ids', -100, 'clawback', 'ref_OldRefund1')`);
    await pool.query(`INSERT INTO shared_payment.payment_event_outbox (environment, provider_event_id, event_type, aggregate_type, aggregate_id, project_id, payload)
      VALUES ('test', 'evt_old', 'payment.checkout.paid', 'checkout', 'chk_OldCheckout1', 'prj-ids',
        '{"checkoutId":"chk_OldCheckout1","paymentId":"pay_OldPayment1"}')`);
    await pool.query(`INSERT INTO apic_governance.payment_idempotency_keys (storage_key, fingerprint, response, expires_at)
      VALUES ('stored', 'f', '{"status":201,"body":"{\\"checkoutId\\":\\"chk_OldCheckout1\\"}"}', now() + interval '1 day'),
             ('unresolved', 'f', NULL, NULL)`);
    await pool.query(readFileSync(join(migrations, MIGRATION), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    global.fetch = originalFetch;
    if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await closeOwnerPool?.();
    await pool?.end();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    if (adminUrl) await admin(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  });

  async function newId(oldId: string): Promise<string> {
    const { rows } = await pool.query('SELECT new_id FROM shared_payment.payment_id_replacements WHERE old_id = $1', [oldId]);
    return rows[0].new_id;
  }

  it('the migration leaves no provider-derived ID in any table or snapshot', async () => {
    const owners = await pool.query(`SELECT resource_type, resource_id, provider_resource_id, snapshot
      FROM shared_payment.resource_owners ORDER BY resource_type`);
    for (const row of owners.rows) expect(row.resource_id).toMatch(MINTED);
    const provider = Object.fromEntries(owners.rows.map((row) => [row.resource_type, row.provider_resource_id]));
    expect(provider).toEqual({ checkout: 'cs_OldCheckout1', invoice: 'in_OldInvoice1', payment: 'pay_OldPayment1',
      payment_link: 'link_OldLink1', refund: 'ref_OldRefund1' });

    const [checkout, payment, refund] = await Promise.all(['chk_OldCheckout1', 'pay_OldPayment1', 'ref_OldRefund1'].map(newId));
    const snapshots = Object.fromEntries(owners.rows.map((row) => [row.resource_type, row.snapshot]));
    expect(snapshots.checkout).toMatchObject({ checkoutId: checkout, paymentId: payment });
    expect(snapshots.payment).toEqual({ paymentId: payment, checkoutId: checkout, sourceId: checkout, status: 'paid',
      amount: 10000, currency: 'PHP' });
    expect(snapshots.refund).toMatchObject({ refundId: refund, paymentId: payment });

    const allocation = await pool.query(`SELECT resource_id, payment_id FROM shared_payment.payout_allocations WHERE id = 'pal_ids'`);
    expect(allocation.rows[0]).toEqual({ resource_id: checkout, payment_id: payment });
    const adjustment = await pool.query(`SELECT source_refund_id FROM shared_payment.payee_adjustments WHERE id = 'padj_ids'`);
    expect(adjustment.rows[0].source_refund_id).toBe(refund);
    const event = await pool.query(`SELECT aggregate_id, payload FROM shared_payment.payment_event_outbox WHERE provider_event_id = 'evt_old'`);
    expect(event.rows[0]).toEqual({ aggregate_id: checkout, payload: { checkoutId: checkout, paymentId: payment } });
    const idempotency = await pool.query('SELECT storage_key FROM apic_governance.payment_idempotency_keys ORDER BY storage_key');
    expect(idempotency.rows).toEqual([{ storage_key: 'unresolved' }]);
  });

  describe('through the runtime', () => {
    const calls: Array<{ path: string; body?: any }> = [];
    function request(path: string, method = 'GET', body?: object, key?: string, extra: Record<string, string> = {}) {
      return originalFetch(baseUrl + path, {
        method, headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json',
          'x-apicenter-owner-tribe-id': 'org-ids', 'x-apicenter-project-id': 'prj-ids',
          'x-apicenter-consumer-service-id': 'app-ids', 'x-apicenter-environment': 'test',
          ...(key ? { 'idempotency-key': key } : {}), ...extra },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }

    beforeAll(async () => {
      Object.assign(process.env, {
        SHARED_SERVICES_DATABASE_URL: databaseUrl, NODE_ENV: 'test', PAYMENT_PROVIDER_MODE: 'test',
        APICENTER_PAYMENTS_INTERNAL_TOKEN: 'fixture-token', PAYMONGO_TEST_SECRET_KEY: 'sk_test_owned_ids',
        PAYMONGO_TEST_WEBHOOK_SECRET: 'whsk_owned_ids',
      });
      delete process.env.APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS;
      global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ path, body });
        const data = path.endsWith('/refunds') ? { id: 'ref_NewRefund1', attributes: { status: 'pending', amount: 500, payment_id: 'pay_OldPayment1' } }
          : { id: 'cs_NewCheckout1', attributes: { status: 'active', checkout_url: 'https://checkout.example.test/pay' } };
        return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;
      const { app } = await import('../../apps/payments/src/server');
      const { PaymentOwnerStore } = await import('../../apps/payments/src/shared/payment-owner-store');
      closeOwnerPool = async () => { await PaymentOwnerStore.getInstance().databasePool?.end(); };
      server = app.listen(0);
      await new Promise<void>((resolve) => server!.once('listening', resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    it('an old ID returns 404 NOT_FOUND', async () => {
      const response = await request('/payments/pay_OldPayment1/refunds', 'POST', { amount: 500 }, 'old-id-refund');
      expect(response.status).toBe(404);
      expect(((await response.json()) as any).error.code).toBe('NOT_FOUND');
    });

    it('refunds a migrated payment through the provider with the provider\'s payment ID', async () => {
      const payment = await newId('pay_OldPayment1');
      const response = await request(`/payments/${payment}/refunds`, 'POST', { amount: 500 }, 'migrated-refund');
      expect(response.status).toBe(201);
      const { data } = (await response.json()) as any;
      expect(data.refundId).toMatch(MINTED);
      expect(data.paymentId).toBe(payment);
      expect(calls.at(-1)).toMatchObject({ path: '/v1/refunds', body: { data: { attributes: { payment_id: 'pay_OldPayment1' } } } });
      expect(JSON.stringify(data)).not.toContain('ref_NewRefund1');
    });

    it('mints a new checkout ID and keeps the provider\'s beside it; a retry reuses it', async () => {
      const first: any = await (await request('/checkout/sessions', 'POST', { referenceId: 'order-2', amount: 10000, currency: 'PHP' }, 'new-checkout')).json();
      expect(first.data.checkoutId).toMatch(MINTED);
      const again: any = await (await request('/checkout/sessions', 'POST', { referenceId: 'order-2', amount: 10000, currency: 'PHP' }, 'new-checkout')).json();
      expect(again.data.checkoutId).toBe(first.data.checkoutId);
      const { rows } = await pool.query(`SELECT provider_resource_id FROM shared_payment.resource_owners WHERE resource_id = $1`, [first.data.checkoutId]);
      expect(rows[0].provider_resource_id).toBe('cs_NewCheckout1');
    });

    it('a webhook for a pre-migration payment link marks it paid', async () => {
      const raw = JSON.stringify({ data: { id: 'evt_link_paid', attributes: { type: 'link.payment.paid', livemode: false,
        data: { id: 'link_OldLink1', type: 'link', attributes: { payments: [{ data: { id: 'pay_LinkPaid1', type: 'payment',
          attributes: { status: 'paid', amount: 2500, currency: 'PHP' } } }] } } } } });
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', 'whsk_owned_ids').update(`${timestamp}.${raw}`).digest('hex');
      const response = await originalFetch(`${baseUrl}/webhooks`, { method: 'POST', body: raw, headers: {
        authorization: 'Bearer fixture-token', 'content-type': 'application/json',
        'x-apicenter-owner-tribe-id': 'org-ids', 'x-apicenter-project-id': 'prj-ids',
        'x-apicenter-consumer-service-id': 'app-ids', 'x-apicenter-internal-token': 'fixture-token',
        'paymongo-signature': `t=${timestamp},te=${signature}`, 'x-apicenter-environment': 'test' } });
      expect(response.status).toBe(200);
      const link = await pool.query(`SELECT status, snapshot FROM shared_payment.resource_owners WHERE resource_id = $1`, [await newId('pl_OldLink1')]);
      expect(link.rows[0].status).toBe('paid');
      expect(link.rows[0].snapshot.paymentId).toMatch(MINTED);
      const payment = await pool.query(`SELECT provider_resource_id FROM shared_payment.resource_owners WHERE resource_id = $1`, [link.rows[0].snapshot.paymentId]);
      expect(payment.rows[0].provider_resource_id).toBe('pay_LinkPaid1');
    });
  });
});
