// Runs the compiled Postgres SMS and OTP stores against a database built by "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:shared-stores
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';

let client;
let smsStore;
let otpStore;
let hashOtpCode;

test.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const { PostgresSmsStore } = require('../../apps/sms/dist/shared/postgres-sms-store.js');
  const { PostgresOtpStore } = require('../../apps/otp/dist/shared/postgres-otp-store.js');
  ({ hashOtpCode } = require('../../apps/otp/dist/shared/otp-hash.js'));
  smsStore = new PostgresSmsStore(databaseUrl);
  otpStore = new PostgresOtpStore(databaseUrl);
});

test.after(async () => {
  if (smsStore) await smsStore.pool.end();
  if (otpStore) await otpStore.pool.end();
  if (client) await client.end();
});

test.beforeEach(async () => {
  if (!client) return;
  await client.query('truncate shared_sms.sms_records, shared_otp.otp_records');
});

test('stores and reads back an SMS record, updating its status on save', { skip }, async () => {
  const record = { messageId: 'sms_1', to: '+639170000000', message: 'hello', status: 'queued', senderId: 'APICENTER', createdAt: new Date().toISOString() };
  await smsStore.save(record);
  assert.equal((await smsStore.findById('sms_1')).to, '+639170000000');

  await smsStore.save({ ...record, status: 'delivered' });
  assert.equal((await smsStore.findById('sms_1')).status, 'delivered');
  assert.equal(await smsStore.findById('missing'), null);
});

test('stores an OTP challenge whose code hash is a 64-character HMAC and verifies it once', { skip }, async () => {
  const otpId = 'otp_hash_1';
  const codeHash = hashOtpCode(otpId, '123456');
  assert.equal(codeHash.length, 64, 'the hash that used to overflow varchar(32)');

  await otpStore.save({ otpId, target: '+639170000000', channel: 'sms', codeHash, expiresAt: Date.now() + 60_000, status: 'pending' });

  assert.equal(await otpStore.consume(otpId, hashOtpCode(otpId, '000000')), 'OTP_INVALID');
  assert.equal(await otpStore.consume(otpId, codeHash), 'VERIFIED');
  assert.equal(await otpStore.consume(otpId, codeHash), 'OTP_ALREADY_USED');
});

test('reports expired and unknown OTP challenges', { skip }, async () => {
  const otpId = 'otp_expired_1';
  const codeHash = hashOtpCode(otpId, '123456');
  await otpStore.save({ otpId, target: 't', channel: 'email', codeHash, expiresAt: Date.now() - 1000, status: 'pending' });

  assert.equal(await otpStore.consume(otpId, codeHash), 'OTP_EXPIRED');
  assert.equal(await otpStore.consume('otp_missing', codeHash), 'OTP_NOT_FOUND');
});

test('the migration repairs an otp_records table the runtime created with varchar(32)', { skip }, async () => {
  await client.query('drop table shared_otp.otp_records');
  await client.query(`create table shared_otp.otp_records (
    otp_id varchar(64) primary key, target varchar(255) not null, channel varchar(16) not null,
    code varchar(32) not null, expires_at bigint not null, status varchar(32) not null,
    created_at timestamp with time zone default current_timestamp)`);
  await client.query("insert into shared_otp.otp_records (otp_id, target, channel, code, expires_at, status) values ('legacy_1', 't', 'sms', 'short', 1, 'pending')");
  await assert.rejects(client.query("insert into shared_otp.otp_records (otp_id, target, channel, code, expires_at, status) values ('legacy_2', 't', 'sms', repeat('a', 64), 1, 'pending')"), /value too long/);

  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261009000700_sms_otp_record_tables.sql'), 'utf8');
  await client.query(sql);

  const column = await client.query("select data_type from information_schema.columns where table_schema = 'shared_otp' and table_name = 'otp_records' and column_name = 'code'");
  assert.equal(column.rows[0].data_type, 'text');
  const kept = await client.query("select count(*)::int as n from shared_otp.otp_records where otp_id = 'legacy_1'");
  assert.equal(kept.rows[0].n, 1, 'existing rows survive the repair');
  await client.query("insert into shared_otp.otp_records (otp_id, target, channel, code, expires_at, status) values ('legacy_3', 't', 'sms', repeat('a', 64), 1, 'pending')");
});

