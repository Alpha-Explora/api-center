import path from 'node:path';

process.env.NODE_ENV = 'development';
process.env.SMS_STORE_MODE = 'memory';
process.env.OTP_STORE_MODE = 'memory';

async function request(service: string, endpoint: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require(path.resolve(__dirname, `../../../../apps/${service}/src/server.js`)) as { app: { listen: (port: number, callback: () => void) => any } };
  const server = await new Promise<any>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}`, init);
    return { status: response.status, body: await response.json() };
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
  });

  it('sends and reads email and SMS messages in local mode', async () => {
    const email = await request('email', '/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: 'user@example.test', subject: 'Hello', text: 'World' }) });
    expect(email.status).toBe(201);
    const emailStatus = await request('email', `/status/${encodeURIComponent(email.body.data.messageId)}`);
    expect(emailStatus.status).toBe(200);

    const sms = await request('sms', '/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: '+63900000000', message: 'Hello' }) });
    expect(sms.status).toBe(201);
    const smsStatus = await request('sms', `/status/${encodeURIComponent(sms.body.data.messageId)}`);
    expect(smsStatus.status).toBe(200);
  });

  it('generates and verifies a single-use OTP', async () => {
    const generated = await request('otp', '/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'user@example.test', channel: 'email' }) });
    expect(generated.status).toBe(201);
    const verified = await request('otp', '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ otpId: generated.body.data.otpId, code: generated.body.data.code }) });
    expect(verified.status).toBe(200);
    expect(verified.body.data.valid).toBe(true);
    const reused = await request('otp', '/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ otpId: generated.body.data.otpId, code: generated.body.data.code }) });
    expect(reused.status).toBe(400);
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