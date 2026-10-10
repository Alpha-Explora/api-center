// Runs the compiled Postgres SMS, OTP, and email stores against a database built by "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:shared-stores
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';

// Two services in one project share records. The other project and the live environment do not.
const alice = { tribeId: 'tribe-a', projectId: 'project-a', serviceId: 'service-a', environment: 'test' };
const sibling = { tribeId: 'tribe-a', projectId: 'project-a', serviceId: 'service-b', environment: 'test' };
const otherProject = { tribeId: 'tribe-b', projectId: 'project-b', serviceId: 'service-b', environment: 'test' };
const aliceLive = { ...alice, environment: 'live' };

let client;
let smsStore;
let otpStore;
let emailStore;
let hashOtpCode;

test.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const { PostgresSmsStore } = require('../../apps/sms/dist/shared/postgres-sms-store.js');
  const { PostgresOtpStore } = require('../../apps/otp/dist/shared/postgres-otp-store.js');
  const { PostgresEmailStore } = require('../../apps/email/dist/shared/postgres-email-store.js');
  ({ hashOtpCode } = require('../../apps/otp/dist/shared/otp-hash.js'));
  smsStore = new PostgresSmsStore(databaseUrl);
  otpStore = new PostgresOtpStore(databaseUrl);
  emailStore = new PostgresEmailStore(databaseUrl);
});

test.after(async () => {
  for (const store of [smsStore, otpStore, emailStore]) {
    if (store) await store.pool.end();
  }
  if (client) await client.end();
});

test.beforeEach(async () => {
  if (!client) return;
  await client.query('truncate shared_sms.sms_messages, shared_otp.otp_challenges, shared_email.email_messages, shared_email.project_senders');
});

function smsRecord(messageId) {
  return { messageId, to: '+639170000000', message: 'hello', status: 'queued', senderId: 'APICENTER', createdAt: new Date().toISOString() };
}

function emailMessage(overrides = {}) {
  return {
    requestedFrom: undefined,
    defaultFrom: 'default@example.test',
    defaultDailyLimit: 500,
    provider: 'resend',
    recipients: ['a@example.test'],
    ...overrides,
  };
}

function approveAliceSender(dailyLimit) {
  return emailStore.setProjectSender({
    projectId: alice.projectId,
    environment: alice.environment,
    fromAddress: 'approved@example.test',
    dailyLimit,
  });
}

// Counts advisory locks and connections idle inside an open transaction in this test database.
async function heldLocksAndTransactions() {
  const { rows } = await client.query(
    `select
       (select count(*)::int from pg_locks l join pg_database d on d.oid = l.database
         where l.locktype = 'advisory' and d.datname = current_database()) as advisory_locks,
       (select count(*)::int from pg_stat_activity
         where datname = current_database() and state like 'idle in transaction%') as open_transactions`,
  );
  return rows[0];
}

test('the retired record tables are gone and the owned record and sender tables remain', { skip }, async () => {
  const result = await client.query(
    "select table_schema || '.' || table_name as name from information_schema.tables where table_schema in ('shared_sms', 'shared_otp', 'shared_email') order by 1",
  );
  assert.deepEqual(result.rows.map((row) => row.name), ['shared_email.email_messages', 'shared_email.project_senders', 'shared_otp.otp_challenges', 'shared_sms.sms_messages']);
});

test('SMS: a second service in the same project reads the record; another project does not', { skip }, async () => {
  await smsStore.save(smsRecord('sms_1'), alice);
  assert.equal((await smsStore.findById('sms_1', alice)).to, '+639170000000');
  assert.equal((await smsStore.findById('sms_1', sibling)).to, '+639170000000', 'a sibling service in the project can read it');
  assert.equal(await smsStore.findById('sms_1', otherProject), null, 'another project cannot read the record');
  assert.equal(await smsStore.findById('sms_1', aliceLive), null, 'live cannot read a test record');
  assert.equal(await smsStore.findById('missing', alice), null);
});

test('SMS: a sibling service can update status, and another project cannot overwrite the record', { skip }, async () => {
  await smsStore.save(smsRecord('sms_2'), alice);
  await smsStore.save({ ...smsRecord('sms_2'), status: 'delivered' }, sibling);
  assert.equal((await smsStore.findById('sms_2', alice)).status, 'delivered');

  await assert.rejects(smsStore.save(smsRecord('sms_2'), otherProject), /another project/);
  assert.equal((await smsStore.findById('sms_2', alice)).status, 'delivered');
});

function otpRecord(otpId, codeHash, expiresAt = Date.now() + 60_000) {
  return { otpId, target: '+639170000000', channel: 'sms', codeHash, expiresAt, status: 'pending', attemptCount: 0 };
}

test('OTP: stores a 64-character hash and no code column, and counts failed attempts', { skip }, async () => {
  const otpId = 'otp_hash_1';
  const codeHash = hashOtpCode(otpId, '123456');
  assert.equal(codeHash.length, 64);
  await otpStore.save(otpRecord(otpId, codeHash), alice);

  const columns = await client.query("select column_name from information_schema.columns where table_schema = 'shared_otp' and table_name = 'otp_challenges'");
  const names = columns.rows.map((row) => row.column_name);
  assert.ok(!names.includes('code'), 'the plaintext code is never stored');
  assert.ok(names.includes('code_hash'));

  assert.equal(await otpStore.consume(otpId, hashOtpCode(otpId, '000000'), alice), 'OTP_INVALID');
  const row = await client.query('select status, attempt_count, code_hash from shared_otp.otp_challenges where otp_id = $1', [otpId]);
  assert.equal(row.rows[0].status, 'pending');
  assert.equal(row.rows[0].attempt_count, 1);
  assert.equal(row.rows[0].code_hash, codeHash);
});

test('OTP: a sibling service in the project verifies once; a second attempt reports it used', { skip }, async () => {
  const otpId = 'otp_single_use';
  const codeHash = hashOtpCode(otpId, '123456');
  await otpStore.save(otpRecord(otpId, codeHash), alice);

  assert.equal(await otpStore.consume(otpId, codeHash, sibling), 'VERIFIED');
  assert.equal(await otpStore.consume(otpId, codeHash, alice), 'OTP_ALREADY_USED');
});

test('OTP: of two concurrent verifications with the right code, exactly one succeeds', { skip }, async () => {
  const otpId = 'otp_race';
  const codeHash = hashOtpCode(otpId, '654321');
  await otpStore.save(otpRecord(otpId, codeHash), alice);

  const outcomes = await Promise.all([otpStore.consume(otpId, codeHash, alice), otpStore.consume(otpId, codeHash, sibling)]);
  assert.deepEqual(outcomes.sort(), ['OTP_ALREADY_USED', 'VERIFIED']);
});

test('OTP: another project sees the challenge as not found, and an expired challenge is reported', { skip }, async () => {
  const otpId = 'otp_owner';
  const codeHash = hashOtpCode(otpId, '123456');
  await otpStore.save(otpRecord(otpId, codeHash), alice);
  assert.equal(await otpStore.consume(otpId, codeHash, otherProject), 'OTP_NOT_FOUND');

  const expiredId = 'otp_expired';
  const expiredHash = hashOtpCode(expiredId, '123456');
  await otpStore.save(otpRecord(expiredId, expiredHash, Date.now() - 1000), alice);
  assert.equal(await otpStore.consume(expiredId, expiredHash, alice), 'OTP_EXPIRED');
});

test('email: a sibling service reads the recipients; another project does not', { skip }, async () => {
  const record = {
    messageId: 'msg_1',
    provider: 'resend',
    status: 'queued',
    recipient: ['a@example.test', 'b@example.test'],
    recipientCount: 2,
    sentAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  await emailStore.save(record, alice);

  const found = await emailStore.findById('msg_1', sibling);
  assert.deepEqual(found.recipient, record.recipient);
  assert.equal(found.recipientCount, 2);
  assert.equal(await emailStore.findById('msg_1', otherProject), null);
});

test('email: approved sender and daily limit are enforced from persisted project policy and messages', { skip }, async () => {
  await approveAliceSender(1);
  const sent = [];
  const send = async (fromAddress) => {
    sent.push(fromAddress);
    return `msg_policy_${sent.length}`;
  };

  await assert.rejects(
    emailStore.sendWithinDailyLimit(alice, emailMessage({ requestedFrom: 'other@example.test' }), send),
    (error) => error.code === 'SENDER_NOT_APPROVED',
  );
  await emailStore.sendWithinDailyLimit(alice, emailMessage(), send);
  await assert.rejects(
    emailStore.sendWithinDailyLimit(alice, emailMessage({ requestedFrom: 'approved@example.test' }), send),
    (error) => error.code === 'DAILY_LIMIT_REACHED',
  );
  assert.deepEqual(sent, ['approved@example.test']);
  assert.equal(await emailStore.findById('msg_policy_1', otherProject), null);
});

test('email: a send reserves a pending row, calls the provider with no lock or transaction held, then stores the provider id', { skip }, async () => {
  await approveAliceSender(1);
  let duringSend;
  const record = await emailStore.sendWithinDailyLimit(alice, emailMessage(), async (fromAddress) => {
    duringSend = {
      fromAddress,
      rows: (await client.query('select message_id, status from shared_email.email_messages')).rows,
      ...(await heldLocksAndTransactions()),
    };
    return 're_provider_1';
  });

  assert.equal(duringSend.fromAddress, 'approved@example.test');
  assert.equal(duringSend.rows.length, 1, 'the reservation is committed before the provider call');
  assert.match(duringSend.rows[0].message_id, /^msg_[0-9a-f]{32}$/);
  assert.equal(duringSend.rows[0].status, 'pending');
  assert.equal(duringSend.advisory_locks, 0, 'the project lock is released before the provider call');
  assert.equal(duringSend.open_transactions, 0, 'no pooled connection waits inside a transaction');

  assert.equal(record.messageId, 're_provider_1');
  assert.equal(record.status, 'queued');
  const { rows } = await client.query('select message_id, status, project_id, environment from shared_email.email_messages');
  assert.deepEqual(rows, [{ message_id: 're_provider_1', status: 'queued', project_id: 'project-a', environment: 'test' }]);
  assert.equal((await emailStore.findById('re_provider_1', sibling)).status, 'queued');
  assert.equal(await emailStore.findById(duringSend.rows[0].message_id, alice), null);
});

test('email: a provider failure marks the reservation failed and does not use up the daily limit', { skip }, async () => {
  await approveAliceSender(1);
  await assert.rejects(
    emailStore.sendWithinDailyLimit(alice, emailMessage(), async () => { throw new Error('provider down'); }),
    /provider down/,
  );
  const failed = (await client.query('select message_id, status from shared_email.email_messages')).rows;
  assert.equal(failed.length, 1);
  assert.match(failed[0].message_id, /^msg_[0-9a-f]{32}$/);
  assert.equal(failed[0].status, 'failed');

  // A provider that returns no ID keeps the local ID.
  const record = await emailStore.sendWithinDailyLimit(alice, emailMessage(), async () => undefined);
  assert.match(record.messageId, /^msg_[0-9a-f]{32}$/);
  assert.equal(record.status, 'queued');
  await assert.rejects(
    emailStore.sendWithinDailyLimit(alice, emailMessage(), async () => 're_over_limit'),
    (error) => error.code === 'DAILY_LIMIT_REACHED',
  );
});

test('email: of two concurrent sends under a daily limit of one, exactly one reaches the provider', { skip }, async () => {
  await approveAliceSender(1);
  let providerCalls = 0;
  const send = async () => {
    providerCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return `re_concurrent_${providerCalls}`;
  };

  const outcomes = await Promise.allSettled([
    emailStore.sendWithinDailyLimit(alice, emailMessage(), send),
    emailStore.sendWithinDailyLimit(sibling, emailMessage(), send),
  ]);

  assert.equal(providerCalls, 1);
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.code, 'DAILY_LIMIT_REACHED');
});

test('email: messages from an earlier UTC day do not count toward the daily limit', { skip }, async () => {
  await approveAliceSender(1);
  await client.query(
    `insert into shared_email.email_messages
       (message_id, tribe_id, project_id, service_id, environment, provider, status, recipients, recipient_count, sent_at, created_at)
     values ('re_yesterday', 'tribe-a', 'project-a', 'service-a', 'test', 'resend', 'queued', '{a@example.test}', 1,
       date_trunc('day', now(), 'UTC') - interval '1 second', date_trunc('day', now(), 'UTC') - interval '1 second')`,
  );

  const record = await emailStore.sendWithinDailyLimit(alice, emailMessage(), async () => 're_today');
  assert.equal(record.messageId, 're_today');
});

