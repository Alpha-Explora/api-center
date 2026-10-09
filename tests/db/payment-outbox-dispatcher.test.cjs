// Exercises the payment event dispatcher against a real PostgreSQL database built by
// "npm run db:verify:replay". It runs the compiled artifact (apps/payments/dist) that the Cloud Run Job uses.
//
//   DATABASE_URL=postgres://... npm run db:test:payment-outbox
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';
process.env.PUBSUB_DISPATCHER_ENABLED = 'true';

const dispatcherPath = path.resolve(__dirname, '../../apps/payments/dist/events/paymentEventDispatcher.js');
const silent = { error() {} };

let pool;
let dispatcher;
if (!skip) {
  pool = new Pool({ connectionString: databaseUrl, max: 6 });
  dispatcher = require(dispatcherPath);
}

test.after(async () => { if (pool) await pool.end(); });
test.beforeEach(async () => { if (pool) await pool.query('TRUNCATE shared_payment.payment_event_outbox'); });

async function insertEvent(overrides = {}) {
  const row = {
    environment: 'test',
    project_id: 'project-a',
    provider_event_id: 'evt_' + Math.random().toString(36).slice(2),
    event_type: 'payment.checkout.paid',
    aggregate_type: 'checkout',
    aggregate_id: 'chk_1',
    status: 'pending',
    attempts: 0,
    max_attempts: 8,
    ...overrides,
  };
  const columns = Object.keys(row);
  const sql = 'INSERT INTO shared_payment.payment_event_outbox (' + columns.join(', ') + ') VALUES ('
    + columns.map((_, index) => '$' + (index + 1)).join(', ') + ') RETURNING id, provider_event_id';
  const result = await pool.query(sql, columns.map((column) => row[column]));
  return result.rows[0];
}

async function readEvent(id) {
  const result = await pool.query('SELECT * FROM shared_payment.payment_event_outbox WHERE id = $1', [id]);
  return result.rows[0];
}

const ok = async () => ({ messageId: 'msg-1' });

test('publishes a pending event and records the acknowledgement', { skip }, async () => {
  const event = await insertEvent();
  const published = [];
  const result = await dispatcher.drainPaymentEventOutbox({
    pool, logger: silent, publish: async (e) => { published.push(e.providerEventId); return { messageId: 'm' }; },
  });

  assert.deepEqual(result, { claimed: 1, published: 1, failed: 0 });
  assert.deepEqual(published, [event.provider_event_id]);
  const row = await readEvent(event.id);
  assert.equal(row.status, 'published');
  assert.equal(row.attempts, 1);
  assert.equal(row.claim_token, null);
  assert.ok(row.published_at);
});

test('a claimed event carries the project that owns it', { skip }, async () => {
  const event = await insertEvent({ project_id: 'project-b' });
  const [claimed] = await dispatcher.claimPendingPaymentEvents(pool, 1);
  assert.equal(claimed.id, event.id);
  assert.equal(claimed.ownerProjectId, 'project-b');
});

test('does not claim an event that is not yet available', { skip }, async () => {
  await insertEvent({ available_at: new Date(Date.now() + 60_000) });
  const result = await dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish: ok });
  assert.equal(result.claimed, 0);
});

test('a failed publish backs off and keeps the event pending', { skip }, async () => {
  const event = await insertEvent();
  const result = await dispatcher.drainPaymentEventOutbox({
    pool, logger: silent, publish: async () => { throw new Error('pubsub unavailable'); },
  });

  assert.deepEqual(result, { claimed: 1, published: 0, failed: 1 });
  const row = await readEvent(event.id);
  assert.equal(row.status, 'pending');
  assert.equal(row.attempts, 1);
  assert.equal(row.last_error, 'pubsub unavailable');
  assert.equal(row.claim_token, null);
  assert.ok(new Date(row.available_at).getTime() > Date.now(), 'retry is scheduled in the future');
});

test('an event is quarantined when it fails at its last attempt', { skip }, async () => {
  const event = await insertEvent({ max_attempts: 1 });
  await dispatcher.drainPaymentEventOutbox({
    pool, logger: silent, publish: async () => { throw new Error('rejected'); },
  });

  const row = await readEvent(event.id);
  assert.equal(row.status, 'quarantined');
  assert.equal(row.quarantine_reason, 'rejected');
  assert.equal(row.quarantine_attempts, 1);
  assert.ok(row.quarantined_at);
  assert.ok(row.quarantine_expires_at);

  const again = await dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish: ok });
  assert.equal(again.claimed, 0, 'a quarantined event is not retried automatically');
});

test('a claim older than the lease is reclaimed', { skip }, async () => {
  const event = await insertEvent({ status: 'processing', attempts: 1, claimed_at: new Date(Date.now() - 10 * 60_000) });
  const result = await dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish: ok });

  assert.equal(result.published, 1);
  const row = await readEvent(event.id);
  assert.equal(row.status, 'published');
  assert.equal(row.attempts, 2);
});

test('a fresh claim held by another job is left alone', { skip }, async () => {
  await insertEvent({ status: 'processing', attempts: 1, claimed_at: new Date() });
  const result = await dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish: ok });
  assert.equal(result.claimed, 0);
});

test('an expired claim at its last attempt is quarantined instead of retried', { skip }, async () => {
  const event = await insertEvent({ status: 'processing', attempts: 3, max_attempts: 3, claimed_at: new Date(Date.now() - 10 * 60_000) });
  const result = await dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish: ok });

  assert.equal(result.claimed, 0);
  const row = await readEvent(event.id);
  assert.equal(row.status, 'quarantined');
  assert.match(row.quarantine_reason, /Claim lease expired/);
});

test('concurrent jobs never publish the same event twice', { skip }, async () => {
  for (let i = 0; i < 24; i += 1) await insertEvent();
  const seen = new Map();
  const publish = async (event) => {
    seen.set(event.providerEventId, (seen.get(event.providerEventId) || 0) + 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { messageId: 'm' };
  };

  const results = await Promise.all([
    dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish, limit: 24 }),
    dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish, limit: 24 }),
    dispatcher.drainPaymentEventOutbox({ pool, logger: silent, publish, limit: 24 }),
  ]);

  assert.equal(results.reduce((total, r) => total + r.published, 0), 24);
  assert.equal(seen.size, 24);
  assert.ok([...seen.values()].every((count) => count === 1), 'each event was published exactly once');
});

test('a stale claim token cannot acknowledge a row', { skip }, async () => {
  const event = await insertEvent();
  const [claimed] = await dispatcher.claimPendingPaymentEvents(pool, 1);
  assert.equal(claimed.id, event.id);

  await assert.rejects(
    dispatcher.markPaymentEventPublished(pool, { id: claimed.id, claimToken: '00000000-0000-4000-8000-000000000000' }),
    /claim was lost/,
  );
  assert.equal((await readEvent(event.id)).status, 'processing');

  await dispatcher.markPaymentEventPublished(pool, claimed);
  assert.equal((await readEvent(event.id)).status, 'published');
});

test('queue statistics report depth and age', { skip }, async () => {
  await insertEvent();
  await insertEvent({ status: 'processing', claimed_at: new Date() });
  await insertEvent({ status: 'quarantined' });
  await pool.query("UPDATE shared_payment.payment_event_outbox SET created_at = now() - interval '90 seconds' WHERE status = 'pending'");

  const stats = await dispatcher.readPaymentEventOutboxStats(pool);
  assert.equal(stats.pending, 1);
  assert.equal(stats.processing, 1);
  assert.equal(stats.quarantined, 1);
  assert.ok(stats.oldestPendingSeconds >= 90);
});
