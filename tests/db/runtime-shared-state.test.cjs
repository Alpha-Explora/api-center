// Runs the runtime idempotency and send-limit stores (which replaced Redis) as each runtime's own
// database role, against a database built by "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:shared-state
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { createSharedIdempotencyStore, createSharedRateLimitStore } = require('../../packages/runtime/src/sharedStores');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';
const runtimes = [
  { schema: 'shared_email', role: 'email_runtime' },
  { schema: 'shared_sms', role: 'sms_runtime' },
  { schema: 'shared_otp', role: 'otp_runtime' },
];

/** A connection that acts as the runtime's role, as the deployed runtime does. */
function urlAs(role) {
  const url = new URL(databaseUrl);
  url.searchParams.set('options', `-c role=${role}`);
  return url.toString();
}

let admin;
test.before(async () => {
  if (skip) return;
  admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
});
test.after(async () => {
  if (admin) await admin.end();
});
test.beforeEach(async () => {
  if (!admin) return;
  for (const { schema } of runtimes) await admin.query(`truncate ${schema}.idempotency_keys, ${schema}.rate_limit_windows`);
});

for (const { schema, role } of runtimes) {
  test(`${schema}: claim, replay, payload mismatch and release work as ${role}`, { skip }, async () => {
    const store = createSharedIdempotencyStore({ databaseUrl: urlAs(role), schema });
    const body = { to: 'a@example.test', text: 'hi' };

    assert.deepEqual(await store.claim('k1', body), { status: 'claimed' });
    assert.deepEqual(await store.claim('k1', body), { status: 'in_progress' });
    assert.deepEqual(await store.claim('k1', { ...body, text: 'other' }), { status: 'payload_mismatch' });

    await store.complete('k1', body, { messageId: 'm1' });
    assert.deepEqual(await store.claim('k1', body), { status: 'replay', response: { messageId: 'm1' } });
    // A second completion keeps the first response.
    await store.complete('k1', body, { messageId: 'other' });
    assert.deepEqual(await store.claim('k1', body), { status: 'replay', response: { messageId: 'm1' } });

    assert.deepEqual(await store.claim('k2', body), { status: 'claimed' });
    await assert.rejects(store.release('k2', { other: true }), /payload changed/);
    await store.release('k2', body);
    assert.deepEqual(await store.claim('k2', body), { status: 'claimed' });
  });
}

test('an expired lease becomes unknown and stays unknown until completed', { skip }, async () => {
  const store = createSharedIdempotencyStore({ databaseUrl: urlAs('email_runtime'), schema: 'shared_email' });
  const body = { to: 'a@example.test' };
  assert.deepEqual(await store.claim('lease', body, { leaseMs: 1 }), { status: 'claimed' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await store.claim('lease', body), { status: 'unknown' });
  assert.deepEqual(await store.claim('lease', body), { status: 'unknown' });
  await store.markUnknown('lease', body);
  const { rows } = await admin.query("select state, unknown_since is not null as since, expires_at from shared_email.idempotency_keys where key = 'lease'");
  assert.deepEqual(rows[0], { state: 'unknown', since: true, expires_at: null });
});

test('an expired completed key can be claimed again', { skip }, async () => {
  const store = createSharedIdempotencyStore({ databaseUrl: urlAs('sms_runtime'), schema: 'shared_sms' });
  const body = { to: '+639170000000' };
  await store.claim('again', body);
  await store.complete('again', body, { ok: true }, { ttlMs: 1000 });
  await admin.query("update shared_sms.idempotency_keys set expires_at = now() - interval '1 second' where key = 'again'");
  assert.deepEqual(await store.claim('again', { to: 'someone else' }), { status: 'claimed' });
});

test('of concurrent claims on one key, exactly one is claimed', { skip }, async () => {
  const store = createSharedIdempotencyStore({ databaseUrl: urlAs('otp_runtime'), schema: 'shared_otp' });
  const results = await Promise.all(Array.from({ length: 8 }, () => store.claim('race', { n: 1 })));
  assert.equal(results.filter((result) => result.status === 'claimed').length, 1);
  assert.ok(results.every((result) => ['claimed', 'in_progress'].includes(result.status)));
});

test('the send limit is shared across stores and resets with its window', { skip }, async () => {
  const first = createSharedRateLimitStore({ databaseUrl: urlAs('sms_runtime'), schema: 'shared_sms' });
  const second = createSharedRateLimitStore({ databaseUrl: urlAs('sms_runtime'), schema: 'shared_sms' });
  const limit = { limit: 2, windowMs: 60_000 };

  assert.equal((await first.consume('sms:+63917', limit)).allowed, true);
  assert.deepEqual(
    (({ allowed, remaining }) => ({ allowed, remaining }))(await second.consume('sms:+63917', limit)),
    { allowed: true, remaining: 0 },
  );
  assert.equal((await first.consume('sms:+63917', limit)).allowed, false);
  assert.equal((await first.consume('sms:other', limit)).allowed, true);

  await admin.query("update shared_sms.rate_limit_windows set reset_at = now() - interval '1 second' where key = 'sms:+63917'");
  const reset = await second.consume('sms:+63917', limit);
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 1);
  assert.ok(reset.resetAt > Date.now());
});

test('runtime roles cannot delete their state; the retention role can', { skip }, async () => {
  await admin.query("insert into shared_email.rate_limit_windows (key, count, reset_at) values ('old', 1, now() - interval '3 days')");
  await admin.query('begin');
  try {
    await admin.query('set local role email_runtime');
    await assert.rejects(admin.query("delete from shared_email.rate_limit_windows where key = 'old'"), /permission denied/);
  } finally {
    await admin.query('rollback');
  }
  const { purgeExpiredHistory } = require('../../scripts/purge-expired-history.cjs');
  await admin.query('set role api_center_retention');
  try {
    const results = await purgeExpiredHistory(admin);
    assert.equal(results.find((result) => result.table === 'shared_email.rate_limit_windows').deleted, 1);
  } finally {
    await admin.query('reset role');
  }
});
