#!/usr/bin/env node

const crypto = require('node:crypto');

const args = new Set(process.argv.slice(2));
const checkConfigOnly = args.has('--check-config');

const config = {
  baseUrl: (process.env.APICENTER_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  tribeId: process.env.TRIBE_BOUNDARY_TRIBE_ID || 'logistics',
  sourceServiceId: process.env.TRIBE_BOUNDARY_SOURCE_SERVICE_ID || 'logistics-orders',
  secret:
    process.env.TRIBE_BOUNDARY_SECRET ||
    process.env.LOGISTICS_TRIBE_SECRET ||
    process.env.APICENTER_TRIBE_SECRET,
  goodTopic: process.env.TRIBE_BOUNDARY_GOOD_TOPIC || 'tribe.logistics.events',
  badTopic:
    process.env.TRIBE_BOUNDARY_BAD_TOPIC || 'tribe.logistics-orders.events',
};

function mask(value) {
  return value ? '<set>' : '<unset>';
}

function secretEnvKey(serviceId) {
  return `TRIBE_SECRET_${serviceId.toUpperCase().replaceAll('-', '_')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function adminHeaders() {
  if (process.env.APICENTER_PLATFORM_ADMIN_TOKEN) {
    return { Authorization: `Bearer ${process.env.APICENTER_PLATFORM_ADMIN_TOKEN}` };
  }

  const secret =
    process.env.APICENTER_PLATFORM_ADMIN_SECRET ||
    process.env.PLATFORM_ADMIN_SECRET;
  if (secret) {
    return { 'X-Platform-Secret': secret };
  }

  return {};
}

function validateConfig() {
  const adminConfigured = Object.keys(adminHeaders()).length > 0;
  const legacySecretHash = process.env[secretEnvKey(config.tribeId)];
  const missing = [];

  if (!config.secret) missing.push('TRIBE_BOUNDARY_SECRET or LOGISTICS_TRIBE_SECRET');
  if (!adminConfigured) {
    missing.push(
      'APICENTER_PLATFORM_ADMIN_TOKEN, APICENTER_PLATFORM_ADMIN_SECRET, or PLATFORM_ADMIN_SECRET',
    );
  }

  console.log('Tribe boundary smoke config:');
  console.log(`  APICENTER_URL: ${config.baseUrl}`);
  console.log(`  tribeId: ${config.tribeId}`);
  console.log(`  sourceServiceId: ${config.sourceServiceId}`);
  console.log(`  plaintext tribe secret: ${mask(config.secret)}`);
  console.log(`  admin credential: ${adminConfigured ? '<set>' : '<unset>'}`);
  console.log(`  good topic: ${config.goodTopic}`);
  console.log(`  rejected topic: ${config.badTopic}`);
  console.log(`  ${secretEnvKey(config.tribeId)}: ${mask(legacySecretHash)}`);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  if (legacySecretHash) {
    const expectedHash = sha256(config.secret);
    if (legacySecretHash.toLowerCase() !== expectedHash) {
      throw new Error(
        `${secretEnvKey(config.tribeId)} does not match the supplied plaintext tribe secret`,
      );
    }
  } else {
    console.log(
      `  note: set ${secretEnvKey(config.tribeId)}=${sha256(
        config.secret,
      )} before starting a local API Center process that uses env-backed tribe secrets.`,
    );
  }
}

function url(path) {
  return `${config.baseUrl}${path}`;
}

async function request(path, options = {}) {
  const response = await fetch(url(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = parseBody(text);

  if (!response.ok) {
    const method = options.method || 'GET';
    throw new Error(`${method} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return { response, body };
}

async function requestExpectingFailure(path, options = {}) {
  const response = await fetch(url(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, body: parseBody(text) };
}

function parseBody(text) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

async function registerService(manifest) {
  const { body } = await request('/api/v1/registry/register', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify(manifest),
  });
  return body.data;
}

async function issueToken() {
  const { body } = await request('/api/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({
      tribeId: config.tribeId,
      secret: config.secret,
    }),
  });

  const token = body.data?.accessToken;
  if (!token) {
    throw new Error('Token response did not include data.accessToken');
  }

  const scopes = body.data?.scopes || [];
  assertIncludes(scopes, 'logistics:read', 'token scopes');
  assertIncludes(scopes, 'orders:read', 'token scopes');
  assertIncludes(scopes, 'external:kafka:write', 'token scopes');

  return token;
}

async function publish(token, topic) {
  const { body } = await request('/api/v1/kafka/publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      topic,
      key: 'phase7-tribe-boundary-smoke',
      eventType: 'order.created',
      sourceServiceId: config.sourceServiceId,
      payload: {
        orderId: 'ord_phase7_smoke',
        source: 'scripts/smoke-tribe-boundary.js',
        timestamp: new Date().toISOString(),
      },
    }),
  });

  if (body.data?.accepted !== true) {
    throw new Error(`Kafka publish did not return accepted=true: ${JSON.stringify(body)}`);
  }

  return body.data;
}

async function assertRejectedPublish(token) {
  const { response, body } = await requestExpectingFailure('/api/v1/kafka/publish', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      topic: config.badTopic,
      key: 'phase7-tribe-boundary-reject',
      eventType: 'order.created',
      sourceServiceId: config.sourceServiceId,
      payload: { orderId: 'ord_phase7_reject' },
    }),
  });

  if (response.ok) {
    throw new Error(`Expected ${config.badTopic} to be rejected, but publish succeeded.`);
  }

  const message = JSON.stringify(body);
  if (!message.includes('outside tenant boundary')) {
    throw new Error(
      `Expected tenant-boundary rejection for ${config.badTopic}; got ${response.status}: ${message}`,
    );
  }
}

function assertIncludes(values, expected, label) {
  if (!Array.isArray(values) || !values.includes(expected)) {
    throw new Error(`${label} missing '${expected}': ${JSON.stringify(values)}`);
  }
}

function ownerManifest() {
  return {
    serviceId: config.tribeId,
    ownerTribeId: config.tribeId,
    name: 'Logistics Tribe',
    baseUrl: 'http://logistics-control:3000',
    requiredScopes: ['logistics:read'],
    exposes: ['/health'],
    consumes: ['payment', 'kafka'],
    serviceType: 'tribe',
  };
}

function ownedServiceManifest() {
  return {
    serviceId: config.sourceServiceId,
    ownerTribeId: config.tribeId,
    name: 'Logistics Orders',
    baseUrl: 'http://logistics-orders:3000',
    requiredScopes: ['orders:read'],
    exposes: ['/orders', '/health'],
    consumes: [],
    serviceType: 'tribe',
  };
}

async function run() {
  validateConfig();
  if (checkConfigOnly) {
    console.log('Config check passed.');
    return;
  }

  console.log('Checking API Center liveness...');
  await request('/api/v1/health/live');

  console.log(`Registering owner tribe ${config.tribeId}...`);
  await registerService(ownerManifest());

  console.log(`Registering owned service ${config.sourceServiceId}...`);
  await registerService(ownedServiceManifest());

  console.log(`Issuing token for tribe ${config.tribeId}...`);
  const token = await issueToken();

  console.log(`Publishing accepted event to ${config.goodTopic}...`);
  await publish(token, config.goodTopic);

  console.log(`Verifying ${config.badTopic} is rejected...`);
  await assertRejectedPublish(token);

  console.log('Tribe boundary smoke passed.');
}

run().catch((error) => {
  console.error(`Tribe boundary smoke failed: ${error.message}`);
  process.exit(1);
});
