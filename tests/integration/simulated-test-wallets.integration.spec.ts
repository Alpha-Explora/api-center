import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { RuntimeContextSigner } from '../../apps/gateway/src/domains/control-plane/runtime-context.signer';
import { PaymentOwnerStore } from '../../apps/payments/src/shared/payment-owner-store';

// The deployed test environment: provider test mode, where payee wallet onboarding runs on a simulated identity check.
const databaseUrl = process.env.LINKED_ACCOUNTS_TEST_DATABASE_URL;
const testDatabase = databaseUrl ? describe : describe.skip;

testDatabase('simulated payee wallets in the test environment', () => {
  const tenant = randomUUID().replaceAll('-', '');
  const organizationId = randomUUID();
  const projectId = `prj_${tenant}`;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signer = new RuntimeContextSigner({
    APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: 'jwk' }), kid: 'simulated-test' }),
  });
  const original = { ...process.env };
  const config = {
    PAYMENT_PROVIDER_MODE: 'test',
    PAYMONGO_TEST_SECRET_KEY: 'sk_test_simulated_fixture',
    APICENTER_PAYMENTS_INTERNAL_TOKEN: 'fixture-runtime-token',
    APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS: JSON.stringify([{ ...publicKey.export({ format: 'jwk' }), kid: 'simulated-test' }]),
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

  async function call(method: string, path: string, body?: unknown) {
    const signed = signer.sign({
      identity: { organizationId, projectId, applicationId: `app_${tenant}`, environmentKind: 'test',
        environmentId: `env_${tenant}`, credentialId: `crd_${tenant}` },
      resourceOwner: { groupId: organizationId, projectId },
      capability: 'payments', action: method === 'GET' ? 'payments:payouts:read' : 'payments:payouts:write', requestId: randomUUID(),
    });
    const response = await fetch(`${baseUrl}${path}`, {
      method, headers: { authorization: `Bearer ${config.APICENTER_PAYMENTS_INTERNAL_TOKEN}`, 'content-type': 'application/json',
        'idempotency-key': randomUUID(), 'x-apicenter-context': signed },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as { data: Record<string, any> } };
  }

  it('passes the identity check at once and attaches a wallet on activation', async () => {
    const payee = await call('POST', '/payouts/payees', { externalRef: 'simulated', legalName: 'Juan Dela Cruz' });
    expect(payee.status).toBe(201);
    const path = `/payouts/payees/${payee.body.data.id}`;

    const started = await call('POST', `${path}/onboarding`, { firstName: 'Juan', lastName: 'Dela Cruz', email: 'juan@example.test' });
    expect(started).toMatchObject({ status: 200, body: { data: { nextAction: 'activate', verification: { url: expect.stringMatching(/^https:/) } } } });

    const activated = await call('POST', `${path}/onboarding/activate`, {});
    expect(activated).toMatchObject({ status: 200, body: { data: { status: 'active' } } });

    const after = await call('GET', path);
    expect(after.body.data).toMatchObject({
      destination: { type: 'wallet', accountName: 'Juan Dela Cruz', accountNumber: expect.stringMatching(/^\d{12}$/) },
      destinationHoldUntil: expect.any(String),
    });
  });
});
