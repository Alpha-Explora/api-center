// Verifies the payout ledger schema's guarantees: the parent merchant account is seeded, a payout can
// never have two attempts that may still move money, reference numbers are unique, a payout pays a
// positive amount, and the payments runtime cannot delete ledger rows.
//
//   DATABASE_URL=postgres://... node --test tests/db/payout-schema.test.cjs
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

async function inRollback(fn) {
  await client.query('BEGIN');
  try {
    await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function expectSqlState(promise, code) {
  await assert.rejects(promise, (error) => error.code === code);
}

async function seedPayout() {
  await client.query(`INSERT INTO shared_payment.payees (id, environment, organization_id, project_id, consumer_service_id, external_ref, legal_name)
    VALUES ('pye_1', 'test', 'org-1', 'project-1', 'app-1', 'ext-1', 'Juan Dela Cruz')`);
  await client.query(`INSERT INTO shared_payment.payouts (id, environment, organization_id, project_id, consumer_service_id, merchant_account_id,
      payee_id, gross, fee, net, trigger, status, destination)
    VALUES ('po_1', 'test', 'org-1', 'project-1', 'app-1', 'parent', 'pye_1', 72500, 1000, 72500, 'schedule', 'submitting', '{}')`);
}

test('both environments start with the parent merchant account', { skip }, async () => {
  const result = await client.query("SELECT environment FROM shared_payment.merchant_accounts WHERE id = 'parent' ORDER BY environment");
  assert.deepEqual(result.rows.map((row) => row.environment), ['live', 'test']);
});

test('a payout has at most one attempt that may still move money', { skip }, async () => {
  await inRollback(async () => {
    await seedPayout();
    const attempt = `INSERT INTO shared_payment.payout_transfer_attempts (id, environment, payout_id, reference_number, callback_token, provider_status)
      VALUES ($1, 'test', 'po_1', $2, $3, $4)`;
    await client.query(attempt, ['pta_1', 'REF1', 'a'.repeat(43), 'failed']);
    await client.query(attempt, ['pta_2', 'REF2', 'b'.repeat(43), null]);
    await expectSqlState(client.query(attempt, ['pta_3', 'REF3', 'c'.repeat(43), 'pending']), '23505');
  });
});

test('reference numbers are unique per environment', { skip }, async () => {
  await inRollback(async () => {
    await seedPayout();
    await client.query(`INSERT INTO shared_payment.payout_transfer_attempts (id, environment, payout_id, reference_number, callback_token, provider_status)
      VALUES ('pta_1', 'test', 'po_1', 'REF1', $1, 'failed')`, ['a'.repeat(43)]);
    await expectSqlState(client.query(`INSERT INTO shared_payment.payout_transfer_attempts (id, environment, payout_id, reference_number, callback_token)
      VALUES ('pta_2', 'test', 'po_1', 'REF1', $1)`, ['b'.repeat(43)]), '23505');
  });
});

test('a payout pays a positive amount', { skip }, async () => {
  await inRollback(async () => {
    await seedPayout();
    await expectSqlState(client.query("UPDATE shared_payment.payouts SET net = 0 WHERE id = 'po_1'"), '23514');
  });
});

test('the payments runtime can write but never delete ledger rows', { skip }, async () => {
  for (const table of ['payees', 'payout_allocations', 'payee_adjustments', 'payouts', 'payout_transfer_attempts']) {
    const result = await client.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'payments_runtime' AND table_schema = 'shared_payment' AND table_name = $1`, [table]);
    const privileges = result.rows.map((row) => row.privilege_type).sort();
    assert.deepEqual(privileges, ['INSERT', 'SELECT', 'UPDATE'], `shared_payment.${table}`);
  }
});
