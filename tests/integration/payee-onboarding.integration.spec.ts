import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { z } from 'zod';
import { RuntimeContextSigner } from '../../apps/gateway/src/domains/control-plane/runtime-context.signer';
import { createPayoutStore } from '../../apps/payments/src/features/payouts/payout-store';
import { PaymentOwnerStore } from '../../apps/payments/src/shared/payment-owner-store';

const databaseUrl = process.env.LINKED_ACCOUNTS_TEST_DATABASE_URL;
const testDatabase = databaseUrl ? describe : describe.skip;
const payeeResult = z.object({ data: z.object({
  id: z.string(), destination: z.record(z.string(), z.unknown()).nullable(), destinationHoldUntil: z.string().nullable(),
}) }).transform(({ data }) => data);
const enrollmentResult = z.object({ data: z.object({ id: z.string(), verification: z.object({ url: z.url() }) }) })
  .transform(({ data }) => data);

testDatabase('payee onboarding through the payments runtime', () => {
  const tenant = randomUUID().replaceAll('-', '');
  const organizationId = randomUUID();
  const projectId = `prj_${tenant}`;
  const applicationId = `app_${tenant}`;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signer = new RuntimeContextSigner({
    APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'phase-b-test' }),
  });
  const original = { ...process.env };
  const config = {
    PAYMENT_PROVIDER_MODE: 'mock',
    APICENTER_PAYMENTS_INTERNAL_TOKEN: 'fixture-runtime-token',
    APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS: JSON.stringify([{ ...publicKey.export({ format: 'jwk' }), kid: 'phase-b-test' }]),
    PAYMONGO_TEST_WEBHOOK_SECRET: 'fixture-webhook-secret',
    SHARED_SERVICES_DATABASE_URL: databaseUrl,
  };
  let pool: Pool;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    if (!databaseUrl || new URL(databaseUrl).hostname !== '127.0.0.1') throw new Error('Use a disposable local database');
    Object.assign(process.env, config);
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`INSERT INTO shared_payment.project_feature_settings
      (environment, project_id, feature, enabled, updated_by) VALUES ('test', $1, 'payee_wallets', true, 'fixture')`, [projectId]);
    await pool.query(`UPDATE shared_payment.merchant_accounts SET wallet_account_number = '987654321',
      wallet_account_name = 'Mock merchant' WHERE environment = 'test' AND id = 'parent'`);
    const { app } = await import('../../apps/payments/src/server');
    server = await new Promise<Server>((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a listening TCP socket');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (pool) {
      await PaymentOwnerStore.getInstance().databasePool?.end();
      await pool.end();
    }
    for (const key of Object.keys(config)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  async function call(method: string, path: string, body?: unknown,
    scope: { projectId: string; organizationId: string; environment: 'test' | 'live' } = { projectId, organizationId, environment: 'test' },
    caller = applicationId) {
    const action = method === 'GET' ? 'payments:payouts:read' : 'payments:payouts:write';
    const signed = signer.sign({
      identity: { organizationId: scope.organizationId, projectId: scope.projectId, applicationId: caller,
        environmentKind: scope.environment, environmentId: `env_${tenant}`, credentialId: `crd_${tenant}` },
      resourceOwner: { groupId: scope.organizationId, projectId: scope.projectId },
      capability: 'payments', action, requestId: randomUUID(),
    });
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { authorization: `Bearer ${config.APICENTER_PAYMENTS_INTERNAL_TOKEN}`,
        'content-type': 'application/json', 'idempotency-key': randomUUID(), 'x-apicenter-context': signed },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() };
  }

  function webhook(type: string, data: Record<string, unknown>, id = randomUUID()) {
    const body = JSON.stringify({ data: { id, attributes: { type, data, livemode: false } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', config.PAYMONGO_TEST_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
    return fetch(`${baseUrl}/webhooks`, { method: 'POST', body, headers: { 'content-type': 'application/json',
      'x-apicenter-internal-token': config.APICENTER_PAYMENTS_INTERNAL_TOKEN, 'x-apicenter-environment': 'test',
      'paymongo-signature': `t=${timestamp},te=${signature}` } });
  }

  it('isolates two signed payees and attaches and detaches only the verified wallet', async () => {
    const first = await call('POST', '/payouts/payees', { externalRef: 'first', legalName: 'First Payee' });
    const second = await call('POST', '/payouts/payees', { externalRef: 'second', legalName: 'Second Payee' });
    expect(first).toMatchObject({ status: 201 });
    expect(second).toMatchObject({ status: 201 });
    const firstPayee = payeeResult.parse(first.body);
    const secondPayee = payeeResult.parse(second.body);
    const firstPath = `/payouts/payees/${firstPayee.id}`;
    const secondPath = `/payouts/payees/${secondPayee.id}`;
    const details = { firstName: 'Fixture', lastName: 'Payee', email: 'payee@example.test' };
    expect(await call('GET', `${firstPath}/onboarding`)).toMatchObject({ status: 404 });
    expect(await call('POST', `${firstPath}/onboarding`, details, { projectId, organizationId, environment: 'live' }))
      .toMatchObject({ status: 503 });
    expect(await call('POST', `${firstPath}/onboarding`, details, { projectId, organizationId: randomUUID(), environment: 'test' }))
      .toMatchObject({ status: 404 });
    expect(await call('POST', `${firstPath}/onboarding`, details, { projectId: 'other-project', organizationId, environment: 'test' }))
      .toMatchObject({ status: 404 });
    await pool.query("UPDATE shared_payment.project_feature_settings SET enabled = false WHERE project_id = $1 AND feature = 'payee_wallets'", [projectId]);
    expect(await call('POST', `${firstPath}/onboarding`, details)).toMatchObject({ status: 503 });
    await pool.query("UPDATE shared_payment.project_feature_settings SET enabled = true WHERE project_id = $1 AND feature = 'payee_wallets'", [projectId]);

    const enrollment = await call('POST', `${firstPath}/onboarding`, details);
    const other = await call('POST', `${secondPath}/onboarding`, details);
    expect(enrollment).toMatchObject({ status: 200, cacheControl: 'no-store', body: { data: {
      status: 'verification_pending', verification: { url: expect.stringMatching(/^https:/) },
    } } });
    const firstEnrollment = enrollmentResult.parse(enrollment.body);
    expect(enrollmentResult.parse(other.body).id).not.toBe(firstEnrollment.id);
    expect(await call('GET', `${firstPath}/onboarding`)).toMatchObject({ body: { data: { verification: null } } });
    const reissued = await call('POST', `${firstPath}/onboarding/verification-link`, {});
    expect(enrollmentResult.parse(reissued.body).verification.url).not.toBe(firstEnrollment.verification.url);
    const snapshot = await pool.query(`SELECT provider_account_id, verification_session_id
      FROM shared_payment.linked_accounts WHERE id = $1`, [firstEnrollment.id]);
    const consumerId = snapshot.rows[0].provider_account_id;
    const wallet = { consumer_id: consumerId, account: { first_name: 'Fixture', last_name: 'Payee' },
      wallet: { account_number: '123456789', status: 'activated', type: 'fully_verified_standard' } };
    expect(await (await webhook('consumer.activated', wallet)).json()).toMatchObject({ data: { event: 'ignored' } });
    expect((await webhook('account.identity_verification.passed', {
      account_id: consumerId, id: snapshot.rows[0].verification_session_id,
    })).status).toBe(200);
    expect(await call('POST', `${firstPath}/onboarding/activate`, {})).toMatchObject({ body: { data: {
      status: 'activation_pending', nextAction: 'await_activation',
    } } });
    const eventId = randomUUID();
    expect(await (await webhook('consumer.activated', wallet, eventId)).json()).toMatchObject({ data: { event: 'applied' } });
    const withWallet = payeeResult.parse((await call('GET', firstPath)).body);
    expect(withWallet.destination).toMatchObject({ type: 'wallet', accountNumber: '123456789' });
    expect(Date.parse(withWallet.destinationHoldUntil ?? '') - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    expect(await (await webhook('consumer.activated', wallet, eventId)).json()).toMatchObject({ data: { event: 'duplicate' } });
    expect(payeeResult.parse((await call('GET', firstPath)).body).destinationHoldUntil).toBe(withWallet.destinationHoldUntil);
    expect(payeeResult.parse((await call('GET', secondPath)).body).destination).toBeNull();

    await createPayoutStore(pool).insertAllocations({ environment: 'test', organizationId, projectId, consumerServiceId: applicationId },
      [{ payeeId: firstPayee.id, merchantAccountId: 'parent', resourceType: 'checkout', resourceId: `chk_${tenant}`,
        referenceId: 'fixture-order', paymentId: `pay_${tenant}`, template: false, amount: 30_000,
        grossAmount: 30_000, status: 'released', createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }]);
    expect(await call('POST', `${firstPath}/cash-out`, {})).toMatchObject({
      status: 409, body: { error: { code: 'DESTINATION_HOLD' } },
    });
    await pool.query("UPDATE shared_payment.payees SET destination_hold_until = now() - interval '1 minute' WHERE id = $1", [firstPayee.id]);
    const pausePath = '/admin/payouts/feature-pauses/payouts_sending';
    const pause = { paused: true, reason: 'Fixture pause', actor: 'operator@example.test' };
    const platform = { projectId: 'platform', organizationId: 'platform', environment: 'test' as const };
    expect(await call('PUT', pausePath, pause, undefined, 'console')).toMatchObject({ status: 403 });
    expect(await call('PUT', pausePath, pause, platform, 'platform-console')).toMatchObject({ status: 200 });
    try {
      expect(await call('POST', `${firstPath}/cash-out`, {})).toMatchObject({
        status: 409, body: { error: { code: 'PAYOUTS_PAUSED' } },
      });
    } finally {
      expect(await call('PUT', pausePath, { ...pause, paused: false }, platform, 'platform-console')).toMatchObject({ status: 200 });
    }
    const payout = await call('POST', `${firstPath}/cash-out`, {});
    expect(payout).toMatchObject({ status: 202, body: { data: { status: 'pending', payeeId: firstPayee.id } } });

    expect((await webhook('consumer.declined', { consumer_id: consumerId })).status).toBe(200);
    expect(payeeResult.parse((await call('GET', firstPath)).body).destination).toBeNull();
    expect(await call('GET', `${secondPath}/onboarding`)).toMatchObject({ body: { data: { status: 'verification_pending' } } });
    const events = await pool.query(`SELECT aggregate_version, payload FROM shared_payment.payment_event_outbox
      WHERE aggregate_id = $1 AND event_type = 'payee.onboarding.updated' ORDER BY aggregate_version`, [firstEnrollment.id]);
    expect(events.rows.map((row) => [row.aggregate_version, row.payload.status])).toEqual([
      [1, 'created'], [2, 'details_submitted'], [3, 'verification_pending'],
      [4, 'activation_pending'], [5, 'active'], [6, 'declined'],
    ]);
    expect(events.rows.every((row) => row.payload.consumerServiceId === applicationId &&
      row.payload.payeeId === firstPayee.id && row.payload.verification === undefined)).toBe(true);

    const explicitDestination = { type: 'instapay', bic: 'GXCHPHM2XXX', accountNumber: '09999999999', accountName: 'Second Payee' };
    expect(await call('PUT', `${secondPath}/destination`, explicitDestination)).toMatchObject({ status: 200 });
    const otherAccount = await pool.query(`SELECT provider_account_id, verification_session_id
      FROM shared_payment.linked_accounts WHERE payee_id = $1`, [secondPayee.id]);
    const otherId = otherAccount.rows[0].provider_account_id;
    await webhook('account.identity_verification.passed', {
      account_id: otherId, id: otherAccount.rows[0].verification_session_id,
    });
    expect(await (await webhook('consumer.activated', { ...wallet, consumer_id: otherId })).json())
      .toMatchObject({ data: { event: 'applied' } });
    expect((await webhook('consumer.declined', { consumer_id: otherId })).status).toBe(200);
    expect(payeeResult.parse((await call('GET', secondPath)).body).destination).toEqual(explicitDestination);
  });
});
