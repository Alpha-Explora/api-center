// Migration 20261124001900 replaces email message IDs that the store had overwritten with the provider's ID.
// Builds a fresh database up to the migration before it, seeds old-format data, applies the migration, and
// checks delivery callbacks still match.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, Pool } from 'pg';

const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
const testDatabase = adminUrl ? describe : describe.skip;
const MIGRATION = '20261124001900_owned_email_ids.sql';
const migrations = join(__dirname, '../../supabase/migrations');
const EMAIL_ID = /^eml_[0-9a-hjkmnp-tv-z]{26}$/;

testDatabase('APICenter-owned email IDs', () => {
  const databaseName = `apicenter_owned_email_${Date.now()}`;
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
    // A sent message whose ID the store overwrote with the provider's, and a suppressed one that kept its local ID.
    await pool.query(`INSERT INTO shared_email.email_messages (message_id, tribe_id, project_id, service_id, environment, provider,
        status, recipients, recipient_count, sent_at)
      VALUES ('4ef9f2b1-0c3a-4bfa-9d0e-3f1c2b7a9d10', 'org-a', 'prj-a', 'app-a', 'test', 'resend', 'queued', ARRAY['a@example.test'], 1, now()),
             ('msg_0123456789abcdef0123456789abcdef', 'org-a', 'prj-a', 'app-a', 'test', 'suppressed', 'queued', ARRAY['b@example.test'], 1, now())`);
    await pool.query(`INSERT INTO shared_email.email_delivery_events (provider_event_id, message_id, status, payload)
      VALUES ('evt-old', '4ef9f2b1-0c3a-4bfa-9d0e-3f1c2b7a9d10', 'sent', '{}')`);
    await pool.query(`INSERT INTO shared_email.idempotency_keys (key, fingerprint, state, response, expires_at)
      VALUES ('completed-key', 'f', 'completed', '{"status":201}', now() + interval '1 day')`);
    await pool.query(`INSERT INTO shared_email.idempotency_keys (key, fingerprint, state, lease_until)
      VALUES ('processing-key', 'f', 'processing', now() + interval '1 minute')`);
    await pool.query(readFileSync(join(migrations, MIGRATION), 'utf8'));
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (adminUrl) await admin(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
  });

  it('the migration leaves no provider or local ID as a public ID', async () => {
    const { rows } = await pool.query('SELECT message_id, provider, provider_message_id FROM shared_email.email_messages ORDER BY provider');
    for (const row of rows) expect(row.message_id).toMatch(EMAIL_ID);
    expect(rows.map((row) => [row.provider, row.provider_message_id])).toEqual([
      ['resend', '4ef9f2b1-0c3a-4bfa-9d0e-3f1c2b7a9d10'], ['suppressed', null]]);
    const { rows: [event] } = await pool.query(`SELECT message_id FROM shared_email.email_delivery_events WHERE provider_event_id = 'evt-old'`);
    expect(event.message_id).toBe(rows.find((row) => row.provider === 'resend').message_id);
    const keys = await pool.query('SELECT key FROM shared_email.idempotency_keys ORDER BY key');
    expect(keys.rows).toEqual([{ key: 'processing-key' }]);
  });

  it('a delivery callback for a pre-migration message updates it', async () => {
    const { PostgresEmailStore } = await import('../../apps/email/src/shared/postgres-email-store');
    const store = new PostgresEmailStore(databaseUrl);
    await expect(store.applyDeliveryEvent({ providerEventId: 'evt-new', provider: 'resend',
      providerMessageId: '4ef9f2b1-0c3a-4bfa-9d0e-3f1c2b7a9d10', status: 'delivered', payload: {} }))
      .resolves.toEqual({ duplicate: false });
    const { rows: [message] } = await pool.query(`SELECT status FROM shared_email.email_messages WHERE provider = 'resend'`);
    expect(message.status).toBe('delivered');
    await (store as unknown as { pool: Pool }).pool.end();
  });
});
