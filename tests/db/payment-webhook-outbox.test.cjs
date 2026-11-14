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

// PayMongo's documented payment.paid event for a payment made through a payment link.
function linkPaymentPaid(eventId, reference) {
  return { data: { id: eventId, type: 'event', attributes: { type: 'payment.paid', livemode: false, created_at: 1760000000,
    data: { id: 'pay_link_1', type: 'payment', attributes: { amount: 25000, currency: 'PHP', status: 'paid', origin: 'links',
      payment_intent_id: 'pi_paymongo_link', external_reference_number: reference, metadata: { pm_reference_number: reference } } } } } };
}

const count = async (table) => Number((await pool.query('SELECT count(*) FROM shared_payment.' + table)).rows[0].count);

test('fresh intent reads clear redirects, preserve terminal status and do not version unchanged facts', { skip }, async () => {
  await owners.save({ ...owner, resourceType: 'intent', resourceId: 'pi_fresh', referenceId: 'ORDER-FRESH',
    snapshot: { status: 'awaiting_next_action', clientKey: 'client-key',
      nextAction: { type: 'redirect', redirectUrl: 'https://provider.example/authorize' } } });
  const completed = await owners.reconcileFreshRead('intent', 'pi_fresh', owner, { status: 'succeeded', nextAction: undefined });
  assert.equal(completed.aggregateVersion, 2);
  assert.equal(Object.hasOwn(completed.snapshot, 'nextAction'), false);
  assert.equal(completed.referenceId, 'ORDER-FRESH');
  assert.equal(completed.snapshot.clientKey, 'client-key');
  const before = (await pool.query("SELECT updated_at FROM shared_payment.resource_owners WHERE resource_id = 'pi_fresh'")).rows[0];
  const results = await Promise.all([
    owners.reconcileFreshRead('intent', 'pi_fresh', owner, { status: 'succeeded' }),
    owners.reconcileFreshRead('intent', 'pi_fresh', owner, { status: 'awaiting_next_action',
      nextAction: { type: 'redirect', redirectUrl: 'https://provider.example/stale' } }),
  ]);
  for (const result of results) {
    assert.equal(result.aggregateVersion, 2);
    assert.equal(result.status, 'succeeded');
    assert.equal(Object.hasOwn(result.snapshot, 'nextAction'), false);
  }
  const after = (await pool.query("SELECT updated_at FROM shared_payment.resource_owners WHERE resource_id = 'pi_fresh'")).rows[0];
  assert.equal(after.updated_at.toISOString(), before.updated_at.toISOString());
  await assert.rejects(owners.reconcileFreshRead('intent', 'pi_fresh', { ...owner, projectId: 'foreign-project' },
    { status: 'succeeded' }), { statusCode: 403 });
});

test('unchanged invoice and subscription reads preserve versions regardless of object key order', { skip }, async () => {
  for (const type of ['invoice', 'subscription']) {
    await owners.save({ ...owner, resourceType: type, resourceId: type + '_fresh',
      snapshot: { status: 'pending', amount: 100, currency: 'PHP' } });
    const result = await owners.reconcileFreshRead(type, type + '_fresh', owner,
      { currency: 'PHP', amount: 100, status: 'pending' });
    assert.equal(result.aggregateVersion, 1);
  }
});

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

test('polling persists paid checkout facts once without fabricating a webhook receipt or event', { skip }, async () => {
  const fresh = { checkoutId: 'chk_123', status: 'paid', provider: 'paymongo' };
  const first = await owners.reconcileCheckout('chk_123', owner, fresh);
  const second = await owners.reconcileCheckout('chk_123', owner, fresh);
  assert.equal(first.aggregateVersion, 2);
  assert.equal(second.aggregateVersion, 2);
  assert.equal(second.referenceId, 'ORDER-1');
  assert.equal(second.consumerServiceId, 'service-a');
  assert.equal(second.snapshot.status, 'paid');
  assert.equal(await count('payment_webhook_events'), 0);
  assert.equal(await count('payment_event_outbox'), 0);
  const records = await owners.listRecords(owner, { type: 'checkout', status: 'paid' });
  assert.equal(records.records[0].id, 'chk_123');
  assert.equal(records.records[0].status, 'paid');
});

test('reconciliation permits another service in the project but denies foreign owners and environments', { skip }, async () => {
  for (const context of [{ ...owner, projectId: 'project-b' }, { ...owner, tribeId: 'tribe-b' },
    { ...owner, environment: 'live' }]) {
    await assert.rejects(owners.reconcileCheckout('chk_123', context, { status: 'paid' }), { statusCode: 404 });
  }
  const updated = await owners.reconcileCheckout('chk_123', { ...owner, consumerServiceId: 'service-b' }, { status: 'pending' });
  assert.equal(updated.snapshot.status, 'pending');
  assert.equal(updated.consumerServiceId, 'service-a');
  assert.equal(updated.referenceId, 'ORDER-1');
  const unchanged = await owners.reconcileCheckout('chk_123', owner, { status: 'pending' });
  assert.equal(unchanged.aggregateVersion, updated.aggregateVersion);
});

test('a stale poll cannot regress a paid webhook and repeated recovery still allows one later event', { skip }, async () => {
  const payload = checkoutPaid('evt_reconciled');
  await owners.reconcileCheckout('chk_123', owner, { status: 'paid' });
  await webhooks.processWebhook(payload, signed(payload));
  await webhooks.processWebhook(payload, signed(payload));
  const stale = await owners.reconcileCheckout('chk_123', owner, { status: 'pending' });
  assert.equal(stale.snapshot.status, 'paid');
  assert.equal(stale.aggregateVersion, 3);
  assert.equal(await count('payment_webhook_events'), 1);
  assert.equal(await count('payment_event_outbox'), 1);
});

test('a concurrent provider poll and webhook always leave the checkout paid', { skip }, async () => {
  const payload = checkoutPaid('evt_racing');
  await Promise.all([
    owners.reconcileCheckout('chk_123', owner, { status: 'pending' }),
    webhooks.processWebhook(payload, signed(payload)),
  ]);
  const current = await owners.assertOwned('checkout', 'chk_123', owner);
  assert.equal(current.snapshot.status, 'paid');
  assert.equal(await count('payment_event_outbox'), 1);
});

test('a paid link payment updates only the link whose PayMongo reference was saved', { skip }, async () => {
  await owners.save({ ...owner, resourceType: 'payment_link', resourceId: 'pl_a', referenceId: 'ORDER-A',
    providerReference: 'PMREF-A', snapshot: { paymentLinkId: 'pl_a', status: 'active' } });
  // Another project chose PMREF-X as its own referenceId. That must never match a PayMongo reference.
  await owners.save({ ...owner, projectId: 'project-b', resourceType: 'payment_link', resourceId: 'pl_b', referenceId: 'PMREF-X',
    providerReference: 'PMREF-B', snapshot: { paymentLinkId: 'pl_b', status: 'active' } });

  const unknown = linkPaymentPaid('evt_link_unknown', 'PMREF-X');
  assert.equal((await webhooks.processWebhook(unknown, signed(unknown))).event, 'ignored');
  const paid = linkPaymentPaid('evt_link_paid', 'PMREF-A');
  assert.deepEqual(await webhooks.processWebhook(paid, signed(paid)),
    { event: 'processed', data: { eventType: 'payment.paid', updated: 1 } });
  assert.equal((await webhooks.processWebhook(paid, signed(paid))).event, 'duplicate');

  const links = (await pool.query("SELECT resource_id, status, provider_reference, aggregate_version, snapshot FROM shared_payment.resource_owners WHERE resource_type = 'payment_link' ORDER BY resource_id")).rows;
  assert.deepEqual(links.map((row) => [row.resource_id, row.status, row.provider_reference, row.aggregate_version]),
    [['pl_a', 'paid', 'PMREF-A', 2], ['pl_b', 'active', 'PMREF-B', 1]]);
  assert.equal(links[0].snapshot.paymentId, 'pay_link_1');
  assert.equal(await count('payment_webhook_events'), 1);
});
