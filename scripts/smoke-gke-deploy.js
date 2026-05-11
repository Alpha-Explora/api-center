#!/usr/bin/env node

const requiredBaseEnv = ['APICENTER_URL'];
const tokenEnv = ['APICENTER_TRIBE_ID', 'APICENTER_TRIBE_SECRET'];

const args = new Set(process.argv.slice(2));
const checkConfigOnly = args.has('--check-config');

function mask(value) {
  if (!value) return '<unset>';
  return '<set>';
}

function requireEnv(names) {
  return names.filter((name) => !process.env[name]);
}

function buildUrl(path) {
  const baseUrl = process.env.APICENTER_URL.replace(/\/+$/, '');
  return `${baseUrl}${path}`;
}

async function request(path, options = {}) {
  const response = await fetch(buildUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

function validateConfig() {
  const missing = requireEnv(requiredBaseEnv);
  const hasTribeCredentials = tokenEnv.every((name) => process.env[name]);
  const hasAdminCredential = Boolean(
    process.env.APICENTER_PLATFORM_ADMIN_TOKEN || process.env.APICENTER_PLATFORM_ADMIN_SECRET,
  );

  const optionalKafkaConfigured = Boolean(process.env.APICENTER_KAFKA_SMOKE_TOPIC);

  console.log('Smoke config:');
  console.log(`  APICENTER_URL: ${mask(process.env.APICENTER_URL)}`);
  console.log(`  tribe credentials: ${hasTribeCredentials ? '<set>' : '<missing>'}`);
  console.log(`  admin credential: ${hasAdminCredential ? '<set>' : '<missing>'}`);
  console.log(`  kafka smoke topic: ${optionalKafkaConfigured ? '<set>' : '<skipped>'}`);

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }

  if (!hasTribeCredentials) {
    throw new Error(`Missing tribe token env: ${tokenEnv.join(', ')}`);
  }

  if (!hasAdminCredential) {
    throw new Error('Set APICENTER_PLATFORM_ADMIN_TOKEN or APICENTER_PLATFORM_ADMIN_SECRET');
  }
}

async function issueTribeToken() {
  const body = await request('/api/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({
      tribeId: process.env.APICENTER_TRIBE_ID,
      secret: process.env.APICENTER_TRIBE_SECRET,
    }),
  });

  const token = body.data?.accessToken;
  if (!token) {
    throw new Error('Token issue response did not include data.accessToken');
  }

  return token;
}

function adminHeaders() {
  if (process.env.APICENTER_PLATFORM_ADMIN_TOKEN) {
    return { Authorization: `Bearer ${process.env.APICENTER_PLATFORM_ADMIN_TOKEN}` };
  }

  return { 'X-Platform-Secret': process.env.APICENTER_PLATFORM_ADMIN_SECRET };
}

async function runSmoke() {
  validateConfig();
  if (checkConfigOnly) {
    console.log('Config check passed.');
    return;
  }

  console.log('Checking readiness...');
  await request('/api/v1/health/ready');

  console.log('Issuing tribe token...');
  const tribeToken = await issueTribeToken();

  console.log('Checking registry scopes...');
  await request('/api/v1/registry/scopes', {
    headers: adminHeaders(),
  });

  console.log('Checking shared-service discovery...');
  await request('/api/v1/shared', {
    headers: { Authorization: `Bearer ${tribeToken}` },
  });

  if (process.env.APICENTER_KAFKA_SMOKE_TOPIC) {
    console.log('Publishing governed Kafka smoke event...');
    await request('/api/v1/kafka/publish', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tribeToken}` },
      body: JSON.stringify({
        topic: process.env.APICENTER_KAFKA_SMOKE_TOPIC,
        key: 'deploy-smoke',
        eventType: 'deploy.smoke',
        payload: {
          source: 'scripts/smoke-gke-deploy.js',
          timestamp: new Date().toISOString(),
        },
      }),
    });
  } else {
    console.log('Skipping Kafka publish smoke; APICENTER_KAFKA_SMOKE_TOPIC is not set.');
  }

  console.log('GKE deploy smoke passed.');
}

runSmoke().catch((error) => {
  console.error(`GKE deploy smoke failed: ${error.message}`);
  process.exit(1);
});

