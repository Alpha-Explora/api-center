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
  const upsert = 'insert into shared_sms.sms_messages as m ' +
    '(message_id, tribe_id, project_id, service_id, environment, recipient, message, status, sender_id, created_at) ' +
    "values ('sms_role_check', 'tribe-a', 'project-a', 'service-a', 'test', '+639170000000', 'hello', 'queued', 'APICENTER', now()) " +
    'on conflict (message_id) do update set status = excluded.status, updated_at = now() ' +
    'where m.project_id = excluded.project_id and m.environment = excluded.environment';
  await assert.doesNotReject(asRole('sms_runtime', upsert));
});

test('payments_runtime can read and write payment tables but cannot delete outbox rows or read SMS records', { skip }, async () => {
  await assert.doesNotReject(asRole('payments_runtime', 'select 1 from shared_payment.payment_event_outbox limit 1'));
  await assert.rejects(asRole('payments_runtime', 'delete from shared_payment.payment_event_outbox'), /permission denied/);
  await assert.rejects(asRole('payments_runtime', 'select 1 from shared_sms.sms_messages'), /permission denied/);
});

test('payments_runtime runs the owner-store upsert that writes and returns the PayMongo reference', { skip }, async () => {
  const upsert = 'insert into shared_payment.resource_owners ' +
    '(resource_type, resource_id, environment, tribe_id, project_id, consumer_service_id, reference_id, snapshot, provider_reference) ' +
    "values ('payment_link', 'pl_role_check', 'test', 'tribe-a', 'project-a', 'service-a', 'ORDER-1', '{}'::jsonb, 'PMREF-ROLE') " +
    'on conflict (environment, resource_type, resource_id) do update set snapshot = excluded.snapshot, ' +
    'provider_reference = coalesce(shared_payment.resource_owners.provider_reference, excluded.provider_reference) ' +
    'returning provider_reference';
  const { rows } = await asRole('payments_runtime', upsert);
  assert.equal(rows[0].provider_reference, 'PMREF-ROLE');
});

test('otp_runtime cannot read payment or email tables', { skip }, async () => {
  await assert.rejects(asRole('otp_runtime', 'select 1 from shared_payment.resource_owners'), /permission denied/);
  await assert.rejects(asRole('otp_runtime', 'select 1 from shared_email.email_messages'), /permission denied/);
});

test('gauth_runtime can delete from its own schema, which sms_runtime may not do', { skip }, async () => {
  await assert.doesNotReject(asRole('gauth_runtime', 'delete from shared_gauth.oauth_apps where false'));
  await assert.rejects(asRole('sms_runtime', 'delete from shared_sms.sms_messages where false'), /permission denied/);
});
