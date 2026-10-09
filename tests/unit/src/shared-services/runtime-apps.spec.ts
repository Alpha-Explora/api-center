import path from 'node:path';

process.env.NODE_ENV = 'development';
delete process.env.DATABASE_URL;
process.env.SMS_PROVIDER_MODE = 'mock';
process.env.OTP_DELIVERY_MODE = 'mock';

const runtimeApps = new Map<string, { listen: (port: number, callback: () => void) => any }>();

beforeAll(() => {
  for (const service of ['email', 'sms', 'otp', 'gauth', 'geo']) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require(path.resolve(__dirname, `../../../../apps/${service}/src/server.ts`)) as { app: { listen: (port: number, callback: () => void) => any } };
    runtimeApps.set(service, app);
  }
}, 120000);

async function request(service: string, endpoint: string, init?: RequestInit): Promise<{ status: number; body: any; replayed: string | null }> {
  const app = runtimeApps.get(service);
  if (!app) throw new Error(`Runtime app '${service}' was not loaded before the test.`);
  const server = await new Promise<any>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const headers = new Headers(init?.headers);
    headers.set('X-APICenter-Source-Service-Id', 'runtime-test-client');
    headers.set('X-APICenter-Environment', 'test');
    headers.set('X-Tribe-Id', 'runtime-test-tribe');
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { ...init, headers });
    const responseText = await response.text();
    let body: any = responseText;
    try {
      body = JSON.parse(responseText);
    } catch {
      // Express' default not-found response is text/html.
    }
    return { status: response.status, body, replayed: response.headers.get('x-idempotency-replayed') };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('migrated shared-service runtimes', () => {
  it('serves health for every APICenter app', async () => {
    for (const service of ['email', 'sms', 'otp', 'gauth', 'geo']) {
      const result = await request(service, '/health');
      expect(result.status).toBe(200);
      expect(result.body.success).toBe(true);
    }
  }, 20000);

  it('sends and reads email and SMS messages in local mode', async () => {
    const emailKey = 'email-key-runtime-test-0001';
    const emailInput = { to: 'user@example.test', subject: 'Hello', text: 'World' };
    const email = await request('email', '/send', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': emailKey }, body: JSON.stringify(emailInput) });
    expect(email.status).toBe(201);
    const emailReplay = await request('email', '/send', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': emailKey }, body: JSON.stringify(emailInput) });
    expect(emailReplay.status).toBe(201);
    expect(emailReplay.body.data.messageId).toBe(email.body.data.messageId);
    expect(emailReplay.replayed).toBe('true');
    const emailMismatch = await request('email', '/send', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': emailKey }, body: JSON.stringify({ ...emailInput, subject: 'Changed' }) });
    expect(emailMismatch.status).toBe(409);
    expect(emailMismatch.body.error.code).toBe('IDEMPOTENCY_KEY_PAYLOAD_MISMATCH');
    const concurrentEmailKey = 'email-key-runtime-concurrent-0001';
    const concurrentEmails = await Promise.all([0, 1].map(() => request('email', '/send', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': concurrentEmailKey }, body: JSON.stringify(emailInput) })));
    expect(concurrentEmails.every(({ status }) => status === 201 || status === 409)).toBe(true);
    if (concurrentEmails.some(({ status }) => status === 409)) {
      expect(concurrentEmails.find(({ status }) => status === 409)?.body.error.code).toBe('IDEMPOTENCY_KEY_IN_PROGRESS');
    }
    expect(new Set(concurrentEmails.filter(({ status }) => status === 201).map(({ body }) => body.data.messageId)).size).toBe(1);
    expect(emailReplay.body.data.messageId).toBe(email.body.data.messageId);
    const emailStatus = await request('email', `/status/${encodeURIComponent(email.body.data.messageId)}`);
    expect(emailStatus.status).toBe(200);

    const smsKey = 'sms-key-runtime-test-0001';
    const smsInput = { to: '+63900000000', message: 'Hello' };
    const sms = await request('sms', '/send', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': smsKey }, body: JSON.stringify(smsInput) });
    expect(sms.status).toBe(201);
    const smsReplay = await request('sms', '/send', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': smsKey }, body: JSON.stringify(smsInput) });
    expect(smsReplay.status).toBe(201);
    expect(smsReplay.body.data.messageId).toBe(sms.body.data.messageId);
    expect(smsReplay.body).toEqual(sms.body);
    expect(smsReplay.replayed).toBe('true');
    const smsStatus = await request('sms', `/status/${encodeURIComponent(sms.body.data.messageId)}`);
    expect(smsStatus.status).toBe(200);
  });

  it('removes email and SMS template catalogs and rejects obsolete templateId requests', async () => {
    for (const service of ['email', 'sms']) {
      const catalog = await request(service, '/templates');
      expect(catalog.status).toBe(404);
    }

    const email = await request('email', '/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'user@example.test', subject: 'Hello', text: 'World', templateId: 'legacy' }),
    });
    expect(email.status).toBe(400);
    expect(email.body.error.code).toBe('UNSUPPORTED_TEMPLATE_ID');
    expect(email.body.error.message).toContain('send email content in html or text');

    const emailTemplateVariables = await request('email', '/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'user@example.test', subject: 'Hello', text: 'World', templateVariables: { name: 'Sam' } }),
    });
    expect(emailTemplateVariables.status).toBe(400);
    expect(emailTemplateVariables.body.error.code).toBe('UNSUPPORTED_TEMPLATE_FIELD');
    expect(emailTemplateVariables.body.error.message).toContain('send email content directly');

    const sms = await request('sms', '/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '+63900000000', message: 'Hello', templateId: 'legacy' }),
    });
    expect(sms.status).toBe(400);
    expect(sms.body.error.code).toBe('UNSUPPORTED_TEMPLATE_ID');
    expect(sms.body.error.message).toContain('send SMS content in message');
  });

  it('rejects email requests without meaningful HTML or text content', async () => {
    for (const content of [{}, { html: '' }, { text: '   ' }, { html: '\n\t', text: '  ' }]) {
      const result = await request('email', '/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'user@example.test', subject: 'Hello', ...content }),
      });
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('EMAIL_CONTENT_REQUIRED');
      expect(result.body.error.message).toContain('non-empty email content');
    }
  });

  it('generates and verifies a single-use OTP', async () => {
    const generateKey = 'otp-generate-runtime-0001';
    const generateInput = { target: 'user@example.test', channel: 'email' };
    const generated = await request('otp', '/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': generateKey }, body: JSON.stringify(generateInput) });
    expect(generated.status).toBe(201);
    const generatedReplay = await request('otp', '/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': generateKey }, body: JSON.stringify(generateInput) });
    expect(generatedReplay.body.data.otpId).toBe(generated.body.data.otpId);
    expect(generatedReplay.replayed).toBe('true');
    const verifyInput = { otpId: generated.body.data.otpId, code: generated.body.data.code };
    const verifyKey = 'otp-verify-runtime-0001';
    const verified = await request('otp', '/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': verifyKey }, body: JSON.stringify(verifyInput) });
    expect(verified.status).toBe(200);
    expect(verified.body.data.verified).toBe(true);
    const verifiedReplay = await request('otp', '/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': verifyKey }, body: JSON.stringify(verifyInput) });
    expect(verifiedReplay.status).toBe(200);
    expect(verifiedReplay.body.data.verified).toBe(true);
    expect(verifiedReplay.replayed).toBe('true');
    const reusedWithNewKey = await request('otp', '/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'otp-verify-runtime-0002' }, body: JSON.stringify(verifyInput) });
    expect(reusedWithNewKey.status).toBe(400);
  });

  it('supports deterministic geo behavior and rejects Google OAuth for unregistered projects', async () => {
    const geocode = await request('geo', '/geocode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: 'Manila' }) });
    expect(geocode.status).toBe(200);
    expect(geocode.body.data.formattedAddress).toBe('Manila');
    const fence = await request('geo', '/geofence/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latitude: 14.5995, longitude: 120.9842 }) });
    expect(fence.status).toBe(200);
    expect(fence.body.data.inside).toBe(true);
    const unscoped = await request('gauth', '/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(unscoped.status).toBe(400);
    expect(unscoped.body.error.code).toBe('INVALID_PROJECT_CONTEXT');
    const unregistered = await request('gauth', '/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/json', 'X-APICenter-Project-Id': 'unregistered-project', 'X-APICenter-Environment': 'live' }, body: JSON.stringify({}) });
    expect(unregistered.status).toBe(403);
    expect(unregistered.body.error.code).toBe('OAUTH_APP_NOT_REGISTERED');
  });
});
