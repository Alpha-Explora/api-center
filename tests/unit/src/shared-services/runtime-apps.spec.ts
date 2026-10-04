import path from 'node:path';

process.env.NODE_ENV = 'development';
process.env.SMS_STORE_MODE = 'memory';
process.env.OTP_STORE_MODE = 'memory';
process.env.SMS_PROVIDER_MODE = 'mock';
process.env.OTP_DELIVERY_MODE = 'mock';

async function request(service: string, endpoint: string, init?: RequestInit): Promise<{ status: number; body: any; replayed: string | null }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require(path.resolve(__dirname, `../../../../apps/${service}/src/server.ts`)) as { app: { listen: (port: number, callback: () => void) => any } };
  const server = await new Promise<any>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const headers = new Headers(init?.headers);
    headers.set('X-APICenter-Source-Service-Id', 'runtime-test-client');
    headers.set('X-APICenter-Environment', 'test');
    headers.set('X-Tribe-Id', 'runtime-test-tribe');
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, { ...init, headers });
    return { status: response.status, body: await response.json(), replayed: response.headers.get('x-idempotency-replayed') };
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

  it('supports deterministic geo behavior and rejects unconfigured Google OAuth', async () => {
    const geocode = await request('geo', '/geocode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: 'Manila' }) });
    expect(geocode.status).toBe(200);
    expect(geocode.body.data.formattedAddress).toBe('Manila');
    const fence = await request('geo', '/geofence/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ latitude: 14.5995, longitude: 120.9842 }) });
    expect(fence.status).toBe(200);
    expect(fence.body.data.inside).toBe(true);
    const oauth = await request('gauth', '/oauth/authorize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    expect(oauth.status).toBe(500);
    expect(oauth.body.error.code).toBe('GOOGLE_CONFIG_ERROR');
  });
});
