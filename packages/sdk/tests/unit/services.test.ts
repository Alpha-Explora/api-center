import { ApiCenter } from '../../src';

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => JSON.stringify({ success: true, data }),
  } as Response;
}

function calls(fetchImpl: jest.Mock): Array<[string, RequestInit]> {
  return fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
}

describe('ApiCenter shared-service namespaces', () => {
  it('maps each supported operation to its route and preserves contract payloads', async () => {
    const fetchImpl = jest.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    const api = new ApiCenter({
      baseUrl: 'https://gateway.example.test/',
      auth: { getAccessToken: async () => 'service-token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await api.email.send({ to: 'person@example.com', subject: 'Hello', text: 'Welcome' }, {
      idempotencyKey: 'email-send-000001',
    });
    await api.email.getStatus('message id/1');
    await api.sms.send({ to: '+639171234567', message: 'Hello' }, {
      idempotencyKey: 'sms-send-00000001',
    });
    await api.sms.getStatus('sms-1');
    await api.otp.generate({ channel: 'email', recipient: 'person@example.com', purpose: 'login' }, {
      idempotencyKey: 'otp-generate-0001',
    });
    await api.otp.verify({ otpId: 'otp-1', code: '123456' }, {
      idempotencyKey: 'otp-verify-00001',
    });
    await api.otp.getStatus('otp 1');
    await api.geo.geocodeAddress({ address: 'Manila, Philippines' });
    await api.geo.reverseGeocode({ latitude: 14.5995, longitude: 120.9842 });
    await api.geo.checkFence({ latitude: 14.5995, longitude: 120.9842, fenceId: 'metro-manila' });
    await api.googleAuth.getAuthorizationUrl({ scopes: ['openid', 'email'] });
    await api.googleAuth.exchangeCode({ code: 'code', state: 'state' });
    await api.googleAuth.refreshToken({ refreshToken: 'google-refresh-token' });
    await api.googleAuth.logout({ refreshToken: 'google-refresh-token' });

    expect(calls(fetchImpl).map(([url, init]) => [url, init.method])).toEqual([
      ['https://gateway.example.test/api/v1/shared/email/send', 'POST'],
      ['https://gateway.example.test/api/v1/shared/email/status/message%20id%2F1', 'GET'],
      ['https://gateway.example.test/api/v1/shared/sms/send', 'POST'],
      ['https://gateway.example.test/api/v1/shared/sms/status/sms-1', 'GET'],
      ['https://gateway.example.test/api/v1/shared/otp/generate', 'POST'],
      ['https://gateway.example.test/api/v1/shared/otp/verify', 'POST'],
      ['https://gateway.example.test/api/v1/shared/otp/status/otp%201', 'GET'],
      ['https://gateway.example.test/api/v1/shared/geo/geocode', 'POST'],
      ['https://gateway.example.test/api/v1/shared/geo/reverse-geocode', 'POST'],
      ['https://gateway.example.test/api/v1/shared/geo/geofence/check', 'POST'],
      ['https://gateway.example.test/api/v1/shared/gauth/oauth/authorize', 'POST'],
      ['https://gateway.example.test/api/v1/shared/gauth/oauth/token', 'POST'],
      ['https://gateway.example.test/api/v1/shared/gauth/oauth/token/refresh', 'POST'],
      ['https://gateway.example.test/api/v1/shared/gauth/oauth/logout', 'POST'],
    ]);

    for (const [, init] of calls(fetchImpl)) {
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer service-token');
    }
    for (const index of [0, 2, 4, 5]) {
      expect(new Headers(calls(fetchImpl)[index]?.[1].headers).get('idempotency-key')).toBeTruthy();
    }
  });

  it('acquires and caches registered service credentials through the gateway', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse({
        accessToken: 'service-access-token', refreshToken: 'service-refresh-token', expiresIn: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({ messageId: 'msg-1' }));
    const api = new ApiCenter({
      baseUrl: 'https://gateway.example.test',
      auth: { serviceId: 'orders-api', environment: 'test', secret: 'service-secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await api.email.getStatus('msg-1');

    expect(calls(fetchImpl)[0]?.[0]).toBe('https://gateway.example.test/api/v1/auth/token');
    expect(JSON.parse(String(calls(fetchImpl)[0]?.[1].body))).toEqual({
      serviceId: 'orders-api', environment: 'test', secret: 'service-secret',
    });
    expect(new Headers(calls(fetchImpl)[1]?.[1].headers).get('authorization'))
      .toBe('Bearer service-access-token');
  });

  it('supports payment-only setup but fails shared-service calls without service auth', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = new ApiCenter({
      baseUrl: 'https://gateway.example.test',
      paymentApiKey: 'apic_test_key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await api.payments.capabilities.get();
    await expect(api.email.getStatus('msg-1')).rejects.toThrow('This operation requires service auth');
    expect(calls(fetchImpl)).toHaveLength(1);
    expect(new Headers(calls(fetchImpl)[0]?.[1].headers).get('authorization'))
      .toBe('Bearer apic_test_key');
  });
});
