// Migration 20261124001800 replaces provider SMS message IDs with APICenter IDs. Builds a fresh database up to
// the migration before it, seeds old-format data, applies the migration, and checks callbacks still match.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';

const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const testDatabase = adminUrl ? describe : describe.skip;
const MIGRATION = '20261124001800_owned_sms_ids.sql';
const migrations = join(__dirname, '../../supabase/migrations');

testDatabase('APICenter-owned SMS IDs', () => {
  const databaseName = `apicenter_owned_sms_${Date.now()}`;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  let databaseUrl: string;
  let pool: Pool;

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
    await pool.query(`INSERT INTO shared_sms.sms_messages (message_id, tribe_id, project_id, service_id, environment, recipient, message, status)
      VALUES ('SMold0001', 'org-a', 'prj-a', 'app-a', 'test', '+639171234567', 'Hello', 'queued')`);
    await pool.query(`INSERT INTO shared_sms.sms_delivery_events (provider_event_id, message_id, status, payload)
      VALUES ('evt-old', 'SMold0001', 'sent', '{}')`);
    await pool.query(`INSERT INTO shared_sms.idempotency_keys (key, fingerprint, state, response, expires_at)
      VALUES ('completed-key', 'f', 'completed', '{"status":201}', now() + interval '1 day')`);
    await pool.query(`INSERT INTO shared_sms.idempotency_keys (key, fingerprint, state, lease_until)
      VALUES ('processing-key', 'f', 'processing', now() + interval '1 minute')`);
    await pool.query(readFileSync(join(migrations, MIGRATION), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (adminUrl) await admin(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  });

  it('the migration leaves no provider message ID as a public ID', async () => {
    const { rows: [message] } = await pool.query('SELECT message_id, provider_message_id FROM shared_sms.sms_messages');
    expect(message.message_id).toMatch(/^sms_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(message.provider_message_id).toBe('SMold0001');
    const { rows: [event] } = await pool.query(`SELECT message_id FROM shared_sms.sms_delivery_events WHERE provider_event_id = 'evt-old'`);
    expect(event.message_id).toBe(message.message_id);
    const { rows } = await pool.query('SELECT key FROM shared_sms.idempotency_keys ORDER BY key');
    expect(rows).toEqual([{ key: 'processing-key' }]);
  });

  it('a delivery callback for a pre-migration message updates it', async () => {
    process.env.DATABASE_URL = databaseUrl;
    const { PostgresSmsStore } = await import('../../apps/sms/src/shared/postgres-sms-store');
    const store = new PostgresSmsStore(databaseUrl);
    await expect(store.applyDeliveryEvent({ providerEventId: 'evt-new', providerMessageId: 'SMold0001', status: 'delivered', payload: {} }))
      .resolves.toEqual({ duplicate: false });
    const { rows: [message] } = await pool.query('SELECT status FROM shared_sms.sms_messages');
    expect(message.status).toBe('delivered');
    await (store as unknown as { pool: Pool }).pool.end();
  });
});
