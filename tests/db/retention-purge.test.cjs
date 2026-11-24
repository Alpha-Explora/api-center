// Verifies scripts/purge-expired-history.cjs against a database built by "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:retention
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { MANAGED_TABLES, parseRetentionDays, purgeExpiredHistory } = require('../../scripts/purge-expired-history.cjs');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';

let client;
test.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
});
test.after(async () => { if (client) await client.end(); });
test.beforeEach(async () => {
  if (!client) return;
  await client.query('reset role');
  for (const { schema, table } of MANAGED_TABLES) await client.query('truncate ' + schema + '.' + table);
});

// Control-plane rows reference an organization, project, environment, application and credential.
const CP = {
  org: '6f1c1d1e-0000-4000-8000-000000000ee1',
  project: 'prj_retentionretentionretent',
  environment: 'env_retentionretentionretent',
  application: 'app_retentionretentionretent',
  credential: 'crd_retentionretentionretent',
};
async function controlPlaneParents() {
  await client.query("insert into apic_catalog.organizations (id, slug, name) values ($1, 'retention-org', 'Retention') on conflict do nothing", [CP.org]);
  await client.query("insert into apic_catalog.cp_projects (id, organization_id, slug, name, created_by) values ($1, $2, 'retention', 'Retention', 'test') on conflict do nothing", [CP.project, CP.org]);
  await client.query("insert into apic_catalog.cp_environments (id, organization_id, project_id, kind) values ($1, $2, $3, 'test') on conflict do nothing", [CP.environment, CP.org, CP.project]);
  await client.query("insert into apic_catalog.cp_applications (id, organization_id, project_id, environment_id, slug, name, created_by) values ($1, $2, $3, $4, 'retention', 'Retention', 'test') on conflict do nothing", [CP.application, CP.org, CP.project, CP.environment]);
  await client.query("insert into apic_catalog.cp_credentials (id, organization_id, project_id, environment_id, application_id, environment_kind, lookup_prefix, verifier_sha256, expires_at, created_by) values ($1, $2, $3, $4, $5, 'test', 'ak_test_retentionretenti', repeat('b', 64), now() + interval '1 day', 'test') on conflict do nothing", [CP.credential, CP.org, CP.project, CP.environment, CP.application]);
}

// One insert per managed table. The age argument is how many days old the row's dated column should be.
const inserts = {
  'apic_runtime.verification_runs': (days) => client.query(
    "insert into apic_runtime.verification_runs (service_id, project_id, environment, fingerprint, gateway_revision, requested_by, status, created_at) values ('svc', 'prj', 'test', 'f', 'g', 'a', 'passed', now() - make_interval(days => $1))", [days]),
  'apic_runtime.request_diagnostics': (days) => client.query(
    "insert into apic_runtime.request_diagnostics (request_id, correlation_id, route, method, status_code, duration_ms, created_at) values (gen_random_uuid(), 'c', '/r', 'GET', 200, 1, now() - make_interval(days => $1))", [days]),
  'apic_runtime.verification_reports': (days) => client.query(
    "insert into apic_runtime.verification_reports (run_id, service_row_id, service_id, project_id, environment, runner, observed_at, report, created_at) values (gen_random_uuid(), gen_random_uuid(), 'svc', 'prj', 'test', 'runner', now(), '{}'::jsonb, now() - make_interval(days => $1))", [days]),
  'apic_audit.audit_events': (days) => client.query(
    "insert into apic_audit.audit_events (environment, action, resource_type, created_at) values ('test', 'a', 'r', now() - make_interval(days => $1))", [days]),
  'apic_runtime.quota_evaluations': (days) => client.query(
    "insert into apic_runtime.quota_evaluations (owner_tribe_id, scope, route_family, window_start, window_end, request_count, max_requests, mode, outcome, environment, created_at) values ('t', 'all', 'tribes', now(), now(), 1, 10, 'observe', 'allowed', 'test', now() - make_interval(days => $1))", [days]),
  'apic_runtime.usage_rollups': (days) => client.query(
    "insert into apic_runtime.usage_rollups (window_start, window_end, route_family, environment) values (now() - make_interval(days => $1 + 1), now() - make_interval(days => $1), 'tribes', 'test')", [days]),
  'apic_runtime.pipeline_feedback_actions': (days) => client.query(
    "insert into apic_runtime.pipeline_feedback_actions (action, environment, target_type, target_id, reason, actor_id, actor_role, status, created_at) values ('evidence.reviewed', 'test', 'topic', 'x', 'r', 'a', 'admin', 'pending', now() - make_interval(days => $1))", [days]),
  'shared_email.email_delivery_events': (days) => client.query(
    "insert into shared_email.email_delivery_events (provider_event_id, message_id, status, payload, received_at) values ($1, 'msg_retention', 'delivered', '{}'::jsonb, now() - make_interval(days => $2))", [`email_retention_${Date.now()}_${Math.random()}`, days]),
  'shared_sms.sms_delivery_events': (days) => client.query(
    "insert into shared_sms.sms_delivery_events (provider_event_id, message_id, status, payload, received_at) values ($1, 'SMretention', 'delivered', '{}'::jsonb, now() - make_interval(days => $2))", [`sms_retention_${Date.now()}_${Math.random()}`, days]),
  'shared_webhooks.webhook_deliveries': (days) => client.query(
    "insert into shared_webhooks.webhook_deliveries (destination_id, event_id, attempt, outcome, status_code, latency_ms, attempted_at) values ('dst_retentionretentionretent', 'evt_retention', 1, 'delivered', 204, 5, now() - make_interval(days => $1))", [days]),
  ...Object.fromEntries(['shared_email', 'shared_sms', 'shared_otp'].flatMap((schema) => [
    [schema + '.idempotency_keys', (days) => client.query(
      'insert into ' + schema + ".idempotency_keys (key, fingerprint, state, expires_at) values ($1, 'f', 'completed', now() - make_interval(days => $2))", [`retention_${Math.random()}`, days])],
    [schema + '.rate_limit_windows', (days) => client.query(
      'insert into ' + schema + '.rate_limit_windows (key, count, reset_at) values ($1, 1, now() - make_interval(days => $2))', [`retention_${Math.random()}`, days])],
  ])),
  'apic_identity.refresh_tokens': (days) => client.query(
    "insert into apic_identity.refresh_tokens (jti, subject, record, expires_at) values ($1, 's', '{}'::jsonb, now() - make_interval(days => $2))", [`retention_${Math.random()}`, days]),
  'apic_catalog.cp_usage_records': async (days) => {
    await controlPlaneParents();
    await client.query(
      "insert into apic_catalog.cp_usage_records (organization_id, request_key, project_id, environment_id, application_id, capability, action, created_at) values ($1, $2, $3, $4, $5, 'email', 'email:send', now() - make_interval(days => $6))",
      [CP.org, `req:retention_${Math.random()}`, CP.project, CP.environment, CP.application, days]);
  },
  'apic_catalog.cp_quota_counters': async (days) => {
    await controlPlaneParents();
    await client.query(
      "insert into apic_catalog.cp_quota_counters (organization_id, budget_key, window_start, request_count) values ($1, $2, now() - make_interval(days => $3), 1)",
      [CP.org, `plan:retention_${Math.random()}`, days]);
  },
  'apic_catalog.cp_credential_operations': async (days) => {
    await controlPlaneParents();
    await client.query(
      "insert into apic_catalog.cp_credential_operations (operation_id, organization_id, application_id, fingerprint, credential_id, created_at) values (gen_random_uuid(), $1, $2, repeat('a', 64), $3, now() - make_interval(days => $4))",
      [CP.org, CP.application, CP.credential, days]);
  },
  'apic_governance.payment_idempotency_keys': (days) => client.query(
    "insert into apic_governance.payment_idempotency_keys (storage_key, fingerprint, expires_at) values ($1, 'f', now() - make_interval(days => $2))", [`retention_${Math.random()}`, days]),
  'shared_payment.collection_account_routes': (days) => client.query(
    "insert into shared_payment.collection_account_routes (environment, project_id, application_id, request_key, merchant_account_id, created_at) values ('test', 'p', 'a', encode(sha256(convert_to($1, 'utf8')), 'hex'), 'parent', now() - make_interval(days => $2))", [`retention_${Math.random()}`, days]),
  'shared_payment.payment_id_replacements': (days) => client.query(
    "insert into shared_payment.payment_id_replacements (environment, project_id, resource_type, old_id, new_id, replaced_at) values ('test', 'p', 'checkout', $1, shared_payment.mint_public_id('chk'), now() - make_interval(days => $2))", [`chk_retention_${Math.random()}`, days]),
};

async function count(qualified) {
  return (await client.query('select count(*)::int as n from ' + qualified)).rows[0].n;
}

test('parses the retention window from a table comment', () => {
  assert.equal(parseRetentionDays('retention=400d; partition=monthly'), 400);
  assert.equal(parseRetentionDays('retention=90d'), 90);
  assert.equal(parseRetentionDays('Durable evidence; retention=30d; more'), 30);
  assert.equal(parseRetentionDays('no policy here'), null);
  assert.equal(parseRetentionDays('retention=0d'), null);
  assert.equal(parseRetentionDays(null), null);
});

test('every managed table declares a retention policy', { skip }, async () => {
  for (const { schema, table } of MANAGED_TABLES) {
    const row = await client.query("select obj_description(to_regclass($1), 'pg_class') as comment", [schema + '.' + table]);
    assert.ok(parseRetentionDays(row.rows[0].comment), schema + '.' + table + ' has no retention comment');
  }
});

test('deletes rows past each table window and keeps the rest', { skip }, async () => {
  const windows = new Map();
  for (const { schema, table } of MANAGED_TABLES) {
    const qualified = schema + '.' + table;
    const row = await client.query("select obj_description(to_regclass($1), 'pg_class') as comment", [qualified]);
    windows.set(qualified, parseRetentionDays(row.rows[0].comment));
    await inserts[qualified](windows.get(qualified) + 5);
    await inserts[qualified](windows.get(qualified) - 5);
  }

  const results = await purgeExpiredHistory(client);

  for (const { schema, table } of MANAGED_TABLES) {
    const qualified = schema + '.' + table;
    assert.equal(await count(qualified), 1, qualified + ' keeps only the row inside its window');
    assert.equal(results.find((result) => result.table === qualified).deleted, 1);
  }
});

test('deletes in batches until nothing expired is left', { skip }, async () => {
  for (let i = 0; i < 25; i += 1) await inserts['apic_audit.audit_events'](1000);
  await inserts['apic_audit.audit_events'](1);

  const results = await purgeExpiredHistory(client, { batchSize: 10 });
  assert.equal(results.find((result) => result.table === 'apic_audit.audit_events').deleted, 25);
  assert.equal(await count('apic_audit.audit_events'), 1);
});

test('a dry run counts expired rows without deleting them', { skip }, async () => {
  await inserts['apic_runtime.pipeline_feedback_actions'](1000);
  await inserts['apic_runtime.pipeline_feedback_actions'](1);

  const results = await purgeExpiredHistory(client, { dryRun: true });
  assert.equal(results.find((result) => result.table === 'apic_runtime.pipeline_feedback_actions').eligible, 1);
  assert.equal(await count('apic_runtime.pipeline_feedback_actions'), 2);
});

test('a table without a retention comment is never purged', { skip }, async () => {
  await inserts['apic_runtime.pipeline_feedback_actions'](5000);
  const qualified = 'apic_runtime.pipeline_feedback_actions';
  await client.query("comment on table apic_runtime.pipeline_feedback_actions is 'no retention here'");
  try {
    const results = await purgeExpiredHistory(client);
    assert.match(results.find((result) => result.table === qualified).skipped, /no retention policy/);
    assert.equal(await count(qualified), 1);
  } finally {
    await client.query("comment on table apic_runtime.pipeline_feedback_actions is 'retention=365d; partition=row_count_threshold_100000_per_month'");
  }
});

test('the retention role can purge and the application role cannot delete audit events', { skip }, async () => {
  await inserts['apic_audit.audit_events'](1000);

  await client.query('set role api_center_app');
  await assert.rejects(client.query('delete from apic_audit.audit_events'), /permission denied/);
  await client.query('reset role');

  await client.query('set role api_center_retention');
  const results = await purgeExpiredHistory(client);
  await client.query('reset role');

  assert.equal(results.find((result) => result.table === 'apic_audit.audit_events').deleted, 1);
});


test('the retention role purges control-plane rows despite row-level security', { skip }, async () => {
  await inserts['apic_catalog.cp_usage_records'](1000);
  await inserts['apic_catalog.cp_quota_counters'](1000);

  // The application role sees no rows without a tenant setting.
  await client.query('set role api_center_app');
  assert.equal((await client.query('select count(*)::int as n from apic_catalog.cp_usage_records')).rows[0].n, 0);
  await client.query('reset role');

  await client.query('set role api_center_retention');
  const results = await purgeExpiredHistory(client);
  await client.query('reset role');

  assert.equal(results.find((result) => result.table === 'apic_catalog.cp_usage_records').deleted, 1);
  assert.equal(results.find((result) => result.table === 'apic_catalog.cp_quota_counters').deleted, 1);
  assert.equal(await count('apic_catalog.cp_usage_records'), 0);
});
