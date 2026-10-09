// Verifies the shared payment schema keeps APICenter ownership/event data without
// mirroring PayMongo's provider-owned resource tables.
//
//   DATABASE_URL=postgres://... npm run db:test:payment-schema
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';
let client;

const retainedTables = ['resource_owners', 'payment_webhook_events', 'payment_event_outbox'];
const removedPayMongoTables = [
  'customers',
  'products',
  'prices',
  'subscriptions',
  'subscription_events',
  'invoices',
  'invoice_line_items',
  'checkout_sessions',
  'payments',
  'refunds',
  'receipts',
  'receipt_line_items',
];

test.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
});

test.after(async () => {
  if (client) await client.end();
});

test('shared_payment keeps APICenter records and removes copied PayMongo resources', { skip }, async () => {
  const result = await client.query(
    "select table_name from information_schema.tables where table_schema = 'shared_payment' and table_type = 'BASE TABLE'",
  );
  const tables = new Set(result.rows.map((row) => row.table_name));

  for (const table of retainedTables) {
    assert.ok(tables.has(table), `shared_payment.${table} must remain`);
  }
  for (const table of removedPayMongoTables) {
    assert.ok(!tables.has(table), `shared_payment.${table} must be dropped`);
  }
});

test('retained payment ownership and listing facts remain project scoped', { skip }, async () => {
  const result = await client.query(
    "select column_name, is_nullable, data_type from information_schema.columns where table_schema = 'shared_payment' and table_name = 'resource_owners'",
  );
  const columns = new Map(result.rows.map((row) => [row.column_name, row]));

  assert.equal(columns.get('project_id')?.is_nullable, 'NO');
  assert.equal(columns.get('amount_minor')?.data_type, 'bigint');
  assert.ok(columns.has('currency'));
  assert.ok(columns.has('status'));
});
