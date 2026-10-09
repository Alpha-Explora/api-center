// Exercises webhook handling against a real PostgreSQL database built by "npm run db:verify:replay".
// It runs the compiled payments runtime (apps/payments/dist).
//
//   DATABASE_URL=postgres://... npm run db:test:payment-webhook
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';
const SECRET = 'test-webhook-secret';
process.env.PAYMONGO_TEST_WEBHOOK_SECRET = SECRET;

const dist = path.resolve(__dirname, '../../apps/payments/dist');
let pool;
let owners;
let webhooks;
if (!skip) {
  pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const { PaymentOwnerStore } = require(path.join(dist, 'shared/payment-owner-store.js'));
  const { WebhooksService } = require(path.join(dist, 'features/webhooks/webhooks.service.js'));
  owners = new PaymentOwnerStore(databaseUrl);
  webhooks = new WebhooksService(owners);
}

const owner = { tribeId: 'tribe-a', projectId: 'project-a', consumerServiceId: 'service-a', environment: 'test' };

test.after(async () => { if (pool) await pool.end(); });
test.beforeEach(async () => {
  if (!pool) return;
  await pool.query('TRUNCATE shared_payment.payment_event_outbox, shared_payment.payment_webhook_events, shared_payment.resource_owners');
  await owners.save({ ...owner, resourceType: 'checkout', resourceId: 'chk_123', referenceId: 'ORDER-1',
    snapshot: { checkoutId: 'chk_123' } });
});

function checkoutPaid(eventId, amount = 10000) {
  return { data: { id: eventId, attributes: { type: 'checkout_session.payment.paid', livemode: false, created_at: 1760000000,
    data: { id: 'cs_123', attributes: { payments: [{ id: 'pay_123', type: 'payment',
      attributes: { status: 'paid', amount, currency: 'php' } }] } } } } };
}

function signed(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = '1760000000';
  const signature = crypto.createHmac('sha256', SECRET).update(timestamp + '.' + rawBody.toString('utf8')).digest('hex');
  return { rawBody, signatureHeader: 't=' + timestamp + ',te=' + signature, environment: 'test' };
}

const count = async (table) => Number((await pool.query('SELECT count(*) FROM shared_payment.' + table)).rows[0].count);

test('a paid checkout updates the owner, records the receipt and queues one event together', { skip }, async () => {
  const payload = checkoutPaid('evt_1');
  const result = await webhooks.processWebhook(payload, signed(payload));
  assert.deepEqual(result, { event: 'processed', data: { eventType: 'checkout_session.payment.paid', updated: 1, queued: true } });

  const checkout = (await pool.query("SELECT snapshot, aggregate_version FROM shared_payment.resource_owners WHERE resource_id = 'chk_123'")).rows[0];
  assert.equal(checkout.snapshot.status, 'paid');
  assert.equal(checkout.aggregate_version, 2);
  assert.equal(await count('payment_webhook_events'), 1);

  const events = (await pool.query('SELECT * FROM shared_payment.payment_event_outbox')).rows;
  assert.equal(events.length, 1);
  assert.equal(events[0].provider_event_id, 'evt_1');
  assert.equal(events[0].event_type, 'payment.checkout.paid');
  assert.equal(events[0].aggregate_id, 'chk_123');
  assert.equal(events[0].aggregate_version, 2);
  assert.equal(events[0].status, 'pending');
  assert.equal(events[0].owner_tribe_id, 'tribe-a');
  assert.equal(events[0].consumer_service_id, 'service-a');
  assert.equal(events[0].reference_id, 'ORDER-1');
  assert.equal(events[0].project_id, 'project-a');
  assert.equal(events[0].payload.amount, 10000);
});

test('a duplicate delivery changes nothing and queues no second event', { skip }, async () => {
  const payload = checkoutPaid('evt_1');
  await webhooks.processWebhook(payload, signed(payload));
  const again = await webhooks.processWebhook(payload, signed(payload));

  assert.deepEqual(again, { event: 'duplicate', data: { eventType: 'checkout_session.payment.paid', updated: 0, queued: false } });
  assert.equal(await count('payment_event_outbox'), 1);
  assert.equal(await count('payment_webhook_events'), 1);
  const checkout = (await pool.query("SELECT aggregate_version FROM shared_payment.resource_owners WHERE resource_id = 'chk_123'")).rows[0];
  assert.equal(checkout.aggregate_version, 2);
});

test('two deliveries of the same event at once queue one event', { skip }, async () => {
  const payload = checkoutPaid('evt_1');
  const results = await Promise.all([
    webhooks.processWebhook(payload, signed(payload)),
    webhooks.processWebhook(payload, signed(payload)),
  ]);
  assert.deepEqual(results.map((r) => r.event).sort(), ['duplicate', 'processed']);
  assert.equal(await count('payment_event_outbox'), 1);
  const checkout = (await pool.query("SELECT aggregate_version FROM shared_payment.resource_owners WHERE resource_id = 'chk_123'")).rows[0];
  assert.equal(checkout.aggregate_version, 2);
});

test('an event ID reused with different content is rejected and leaves state alone', { skip }, async () => {
  const first = checkoutPaid('evt_1');
  await webhooks.processWebhook(first, signed(first));
  const tampered = checkoutPaid('evt_1', 99900);
  await assert.rejects(webhooks.processWebhook(tampered, signed(tampered)), { statusCode: 409 });
  assert.equal(await count('payment_event_outbox'), 1);
});

test('another project in the same tribe cannot read or reference-look-up a checkout', { skip }, async () => {
  const otherProject = { ...owner, projectId: 'project-b' };
  await assert.rejects(owners.assertOwned('checkout', 'chk_123', otherProject), { statusCode: 404 });
  await assert.rejects(owners.findByReference('checkout', 'ORDER-1', otherProject), { statusCode: 404 });
  const found = await owners.findByReference('checkout', 'ORDER-1', owner);
  assert.equal(found.resourceId, 'chk_123');
});

test('a failure part way rolls back the receipt, the state change and the event', { skip }, async () => {
  // The payment record already belongs to another tribe, so the owner update inside the transaction fails.
  await owners.save({ tribeId: 'tribe-b', projectId: 'project-b', consumerServiceId: 'service-b', environment: 'test',
    resourceType: 'payment', resourceId: 'pay_123', snapshot: {} });
  const payload = checkoutPaid('evt_1');
  await assert.rejects(webhooks.processWebhook(payload, signed(payload)), { statusCode: 403 });

  assert.equal(await count('payment_event_outbox'), 0);
  assert.equal(await count('payment_webhook_events'), 0, 'a failed event can be delivered again');
  const checkout = (await pool.query("SELECT snapshot, aggregate_version FROM shared_payment.resource_owners WHERE resource_id = 'chk_123'")).rows[0];
  assert.equal(checkout.snapshot.status, undefined);
  assert.equal(checkout.aggregate_version, 1);
});

test('a checkout without a merchant reference is flagged for reconciliation and queues nothing', { skip }, async () => {
  await pool.query("UPDATE shared_payment.resource_owners SET reference_id = NULL WHERE resource_id = 'chk_123'");
  const warn = console.warn;
  console.warn = () => {};
  try {
    const payload = checkoutPaid('evt_1');
    const result = await webhooks.processWebhook(payload, signed(payload));
    assert.equal(result.data.queued, false);
  } finally { console.warn = warn; }
  assert.equal(await count('payment_event_outbox'), 0);
  const receipt = (await pool.query('SELECT status FROM shared_payment.payment_webhook_events')).rows[0];
  assert.equal(receipt.status, 'needs_reconciliation');
});
