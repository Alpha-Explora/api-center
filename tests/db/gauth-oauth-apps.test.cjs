// Runs the Postgres OAuth app store and the shared_gauth.oauth_apps constraints against a database built by
// "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:gauth-oauth-apps
const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
const skip = databaseUrl ? false : 'DATABASE_URL is not set';
const validSecretRef = 'projects/apicenter-prod/secrets/alphaci-google-client/versions/3';

let client;
let store;

test.before(async () => {
  if (skip) return;
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const { PostgresOAuthAppStore } = require('../../apps/gauth/dist/shared/postgres-oauth-app-store.js');
  store = new PostgresOAuthAppStore(databaseUrl);
});

test.after(async () => {
  if (store) await store.close();
  if (client) await client.end();
});

test.beforeEach(async () => {
  if (!client) return;
  await client.query('truncate shared_gauth.oauth_apps');
});

async function insertRow(values = {}) {
  await client.query(
    'insert into shared_gauth.oauth_apps (project_id, environment, redirect_uris, client_id, client_secret_ref, display_name, status, client_secret_updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8)',
    [
      values.projectId ?? 'alphaci',
      values.environment ?? 'live',
      values.redirectUris ?? ['https://alphaci.com/callback'],
      values.clientId ?? null,
      values.clientSecretRef ?? null,
      values.displayName ?? 'AlphaCI',
      values.status ?? 'active',
      values.clientSecretUpdatedAt ?? null,
    ],
  );
}

test('returns the registration with its own client, and null for an unregistered project', { skip }, async () => {
  await insertRow({
    clientId: 'alphaci-client-id',
    clientSecretRef: validSecretRef,
    clientSecretUpdatedAt: null,
    redirectUris: ['https://alphaci.com/callback', 'https://staging.alphaci.com/callback'],
  });

  assert.deepEqual(await store.findByProjectAndEnvironment('alphaci', 'live'), {
    projectId: 'alphaci',
    environment: 'live',
    redirectUris: ['https://alphaci.com/callback', 'https://staging.alphaci.com/callback'],
    clientId: 'alphaci-client-id',
    clientSecretRef: validSecretRef,
    displayName: 'AlphaCI',
    status: 'active',
  });
  assert.equal(await store.findByProjectAndEnvironment('alphaci', 'test'), null);
  assert.equal(await store.findByProjectAndEnvironment('other-project', 'live'), null);
});

test('saves and deletes an OAuth app with secret change metadata', { skip }, async () => {
  const changedAt = '2026-10-10T00:00:00.000Z';
  await store.save({
    projectId: 'alphaci',
    environment: 'live',
    redirectUris: ['https://alphaci.com/callback'],
    clientId: 'alphaci-client-id',
    clientSecretRef: validSecretRef,
    clientSecretUpdatedAt: changedAt,
    displayName: 'AlphaCI',
    status: 'active',
  });
  assert.equal((await store.findByProjectAndEnvironment('alphaci', 'live')).clientSecretUpdatedAt, changedAt);
  await store.delete('alphaci', 'live');
  assert.equal(await store.findByProjectAndEnvironment('alphaci', 'live'), null);
});

test('returns a registration without a client so the shared client applies', { skip }, async () => {
  await insertRow({ status: 'disabled' });
  const found = await store.findByProjectAndEnvironment('alphaci', 'live');
  assert.equal(found.clientId, null);
  assert.equal(found.clientSecretRef, null);
  assert.equal(found.status, 'disabled');
});

test('the constraints reject rows the resolver cannot use', { skip }, async () => {
  const rejected = [
    ['no redirect URI', { redirectUris: [] }],
    ['a client id without a secret reference', { clientId: 'alphaci-client-id' }],
    ['a secret reference without a client id', { clientSecretRef: validSecretRef }],
    ['a secret that is not a Secret Manager version name', { clientId: 'alphaci-client-id', clientSecretRef: 'alphaci-secret' }],
    ['an unknown environment', { environment: 'staging' }],
    ['an unknown status', { status: 'pending' }],
  ];
  for (const [label, values] of rejected) {
    await assert.rejects(insertRow(values), { code: '23514' }, label);
  }
});

test('a project has at most one registration per environment', { skip }, async () => {
  await insertRow({ environment: 'live' });
  await assert.rejects(insertRow({ environment: 'live' }), { code: '23505' });
  await insertRow({ environment: 'test' });
});

test('the three unused shared_gauth tables are gone', { skip }, async () => {
  const { rows } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'shared_gauth' order by table_name",
  );
  assert.deepEqual(rows.map((row) => row.table_name), ['oauth_apps']);
});
