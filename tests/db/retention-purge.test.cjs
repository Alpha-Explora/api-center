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

// One insert per managed table. The age argument is how many days old the row's dated column should be.
const inserts = {
  'apic_audit.audit_events': (days) => client.query(
    "insert into apic_audit.audit_events (environment, action, resource_type, created_at) values ('test', 'a', 'r', now() - make_interval(days => $1))", [days]),
  'apic_runtime.quota_evaluations': (days) => client.query(
    "insert into apic_runtime.quota_evaluations (owner_tribe_id, scope, route_family, window_start, window_end, request_count, max_requests, mode, outcome, environment, created_at) values ('t', 'all', 'tribes', now(), now(), 1, 10, 'observe', 'allowed', 'test', now() - make_interval(days => $1))", [days]),
  'apic_runtime.usage_rollups': (days) => client.query(
    "insert into apic_runtime.usage_rollups (window_start, window_end, route_family, environment) values (now() - make_interval(days => $1 + 1), now() - make_interval(days => $1), 'tribes', 'test')", [days]),
  'apic_runtime.health_snapshots': (days) => client.query(
    "insert into apic_runtime.health_snapshots (healthy, environment, checked_at) values (true, 'test', now() - make_interval(days => $1))", [days]),
  'apic_runtime.smoke_test_runs': (days) => client.query(
    "insert into apic_runtime.smoke_test_runs (test_type, status, environment, created_at) values ('t', 'passed', 'test', now() - make_interval(days => $1))", [days]),
  'apic_runtime.pipeline_feedback_actions': (days) => client.query(
    "insert into apic_runtime.pipeline_feedback_actions (action, environment, target_type, target_id, reason, actor_id, actor_role, status, created_at) values ('evidence.reviewed', 'test', 'topic', 'x', 'r', 'a', 'admin', 'pending', now() - make_interval(days => $1))", [days]),
  'apic_governance.promotion_evidence_bundles': (days) => client.query(
    "insert into apic_governance.promotion_evidence_bundles (service_id, source_environment, target_environment, bundle, created_at) values ('s', 'test', 'live', '{}', now() - make_interval(days => $1))", [days]),
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
  await inserts['apic_runtime.health_snapshots'](1000);
  await inserts['apic_runtime.health_snapshots'](1);

  const results = await purgeExpiredHistory(client, { dryRun: true });
  assert.equal(results.find((result) => result.table === 'apic_runtime.health_snapshots').eligible, 1);
  assert.equal(await count('apic_runtime.health_snapshots'), 2);
});

test('a table without a retention comment is never purged', { skip }, async () => {
  await inserts['apic_runtime.smoke_test_runs'](5000);
  await client.query("comment on table apic_runtime.smoke_test_runs is 'no retention here'");
  try {
    const results = await purgeExpiredHistory(client);
    assert.match(results.find((result) => result.table === 'apic_runtime.smoke_test_runs').skipped, /no retention policy/);
    assert.equal(await count('apic_runtime.smoke_test_runs'), 1);
  } finally {
    await client.query("comment on table apic_runtime.smoke_test_runs is 'retention=180d; partition=row_count_threshold_1000000_per_180d'");
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

