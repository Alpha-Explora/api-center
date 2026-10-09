// Checks that each shared-service runtime role runs its own queries and is refused on other schemas.
// Runs against a database built by "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:runtime-roles
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';

let client;

test.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
});

test.after(async () => {
  if (client) await client.end();
});

// Runs one statement as the given role inside a transaction that is always rolled back.
async function asRole(role, sql) {
  await client.query('begin');
  try {
    await client.query('set local role ' + role);
    return await client.query(sql);
  } finally {
    await client.query('rollback');
  }
}

test('the retired shared_services_app role no longer exists', { skip }, async () => {
  const { rows } = await client.query("select 1 from pg_roles where rolname = 'shared_services_app'");
  assert.equal(rows.length, 0);
});

test('sms_runtime runs the upsert the SMS store uses on its own schema', { skip }, async () => {
  const upsert = 'insert into shared_sms.sms_records (message_id, recipient, message, status, sender_id) ' +
    "values ('sms_role_check', '+639170000000', 'hello', 'queued', 'APICENTER') " +
    'on conflict (message_id) do update set status = excluded.status';
  await assert.doesNotReject(asRole('sms_runtime', upsert));
});

test('payments_runtime can read and write payment tables but cannot delete outbox rows or read SMS records', { skip }, async () => {
  await assert.doesNotReject(asRole('payments_runtime', 'select 1 from shared_payment.payment_event_outbox limit 1'));
  await assert.rejects(asRole('payments_runtime', 'delete from shared_payment.payment_event_outbox'), /permission denied/);
  await assert.rejects(asRole('payments_runtime', 'select 1 from shared_sms.sms_records'), /permission denied/);
});

test('otp_runtime cannot read payment or email tables', { skip }, async () => {
  await assert.rejects(asRole('otp_runtime', 'select 1 from shared_payment.resource_owners'), /permission denied/);
  await assert.rejects(asRole('otp_runtime', 'select 1 from shared_email.email_messages'), /permission denied/);
});

test('gauth_runtime can delete from its own schema, which sms_runtime may not do', { skip }, async () => {
  await assert.doesNotReject(asRole('gauth_runtime', 'delete from shared_gauth.oauth_sessions where false'));
  await assert.rejects(asRole('sms_runtime', 'delete from shared_sms.sms_records where false'), /permission denied/);
});
