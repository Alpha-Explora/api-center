import { generateKeyPairSync, sign } from 'node:crypto';
import { ApiCenter, ApiCenterContextError, createContextVerifier, DEFAULT_BASE_URL, parsePaymentEvent } from '../../src';

const KEY = `ak_test_abcdefghijklmnop_${'B'.repeat(43)}`;

function okResponse(body: unknown) {
  return new Response(JSON.stringify({ success: true, data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('application key auth', () => {
  it('sends the application key for service and payment operations', async () => {
    const fetchImpl = jest.fn(async () => okResponse({ messageId: 'm1', status: 'queued', recipientCount: 1, sentAt: '2026-11-14T00:00:00Z' }));
    const client = new ApiCenter({ baseUrl: 'https://api.example.test', auth: { apiKey: KEY }, fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.email.send({ to: 'a@example.test', subject: 'Hi', text: 'Hello' }, { idempotencyKey: 'idempotency-key-0001' });
    const emailHeaders = new Headers((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(emailHeaders.get('authorization')).toBe(`Bearer ${KEY}`);

    fetchImpl.mockResolvedValueOnce(okResponse({ checkoutId: 'chk_1', referenceId: 'r', status: 'open', amount: { amountMinor: 100, currency: 'PHP' }, checkoutUrl: 'https://pay.example.test' }));
    await client.payments.checkouts.get('chk_1').catch(() => undefined);
    const paymentHeaders = new Headers((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].headers);
    expect(paymentHeaders.get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('rejects anything that is not an application key', () => {
    for (const apiKey of ['apic_test_legacy', 'ak_prod_abcdefghijklmnop_' + 'B'.repeat(43), '']) {
      expect(() => new ApiCenter({ baseUrl: 'https://api.example.test', auth: { apiKey } })).toThrow('application key');
    }
  });

  describe('configuration from the environment', () => {
    const saved = { url: process.env.APICENTER_URL, key: process.env.APICENTER_API_KEY };
    afterEach(() => {
      for (const [name, value] of [['APICENTER_URL', saved.url], ['APICENTER_API_KEY', saved.key]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    async function firstCall(client: ApiCenter, fetchImpl: jest.Mock) {
      fetchImpl.mockResolvedValueOnce(okResponse({ results: [] }));
      await client.geo.reverseGeocode({ latitude: 14.55, longitude: 121.02 }).catch(() => undefined);
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      return { url, authorization: new Headers(init.headers).get('authorization') };
    }

    it('needs only APICENTER_API_KEY and calls the hosted gateway', async () => {
      delete process.env.APICENTER_URL;
      process.env.APICENTER_API_KEY = KEY;
      const fetchImpl = jest.fn();
      const call = await firstCall(new ApiCenter({ fetchImpl: fetchImpl as unknown as typeof fetch }), fetchImpl);
      expect(call.url).toBe(`${DEFAULT_BASE_URL}/api/v1/shared/geo/reverse-geocode`);
      expect(call.authorization).toBe(`Bearer ${KEY}`);
    });

    it('lets APICENTER_URL and explicit options override the defaults', async () => {
      process.env.APICENTER_URL = 'https://env.example.test';
      process.env.APICENTER_API_KEY = `ak_live_abcdefghijklmnop_${'C'.repeat(43)}`;
      const fromEnv = jest.fn();
      expect((await firstCall(new ApiCenter({ fetchImpl: fromEnv as unknown as typeof fetch }), fromEnv)).url)
        .toBe('https://env.example.test/api/v1/shared/geo/reverse-geocode');

      const explicit = jest.fn();
      const call = await firstCall(
        new ApiCenter({ baseUrl: 'https://api.example.test', auth: { apiKey: KEY }, fetchImpl: explicit as unknown as typeof fetch }),
        explicit,
      );
      expect(call).toEqual({ url: 'https://api.example.test/api/v1/shared/geo/reverse-geocode', authorization: `Bearer ${KEY}` });
    });

    it('explains what to set when no credential is configured', () => {
      delete process.env.APICENTER_API_KEY;
      expect(() => new ApiCenter()).toThrow('Set APICENTER_API_KEY');
    });

    it('rejects a malformed APICENTER_API_KEY', () => {
      process.env.APICENTER_API_KEY = 'apic_test_legacy';
      expect(() => new ApiCenter()).toThrow('application key');
    });
  });

  it('does not let callers set the signed context header', async () => {
    const client = new ApiCenter({ baseUrl: 'https://api.example.test', auth: { apiKey: KEY }, fetchImpl: jest.fn() as unknown as typeof fetch });
    await expect(
      client.email.send({ to: 'a@example.test', subject: 'Hi', text: 'x' }, { idempotencyKey: 'idempotency-key-0001', headers: { 'X-APICenter-Context': 'forged' } }),
    ).rejects.toThrow('managed by the APICenter SDK');
  });
});

describe('payment events', () => {
  const base = {
    eventId: 'evt_1',
    eventType: 'payment.checkout.paid',
    ownerTribeId: 'org-1',
    consumerServiceId: 'app_x',
    referenceId: 'ORDER-1',
    aggregateType: 'checkout',
    aggregateId: 'chk_1',
    aggregateVersion: 1,
    occurredAt: '2026-11-14T00:00:00.000Z',
    data: { environment: 'test', aggregateVersion: 1 },
  };

  it('exposes the owner for contract 1.1 and 1.0 events alike', () => {
    expect(parsePaymentEvent({ ...base, contractVersion: '1.1', ownerGroupId: 'org-1', ownerProjectId: 'prj_1' }).owner).toEqual({ groupId: 'org-1', projectId: 'prj_1' });
    expect(parsePaymentEvent({ ...base, contractVersion: '1.0' }).owner).toEqual({ groupId: 'org-1' });
    expect(() => parsePaymentEvent({ ...base, contractVersion: '2.0' })).toThrow();
  });
});

describe('createContextVerifier', () => {
  const apiId = `api_${'a'.repeat(24)}`;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeys = [{ ...(publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string }), kid: 'k1' }];
  const now = Date.parse('2026-11-14T10:00:00Z');

  function token(claims: Record<string, unknown>, kid = 'k1') {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'EdDSA', typ: 'apicenter-context+jwt', kid })}.${encode(claims)}`;
    return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
  }
  const claims = {
    iss: 'apicenter-gateway',
    aud: `apicenter-api:${apiId}`,
    iat: now / 1000,
    exp: now / 1000 + 60,
    jti: 'req-1',
    org: 'org-1',
    prj: 'prj_1',
    env: 'env_1',
    env_kind: 'test',
    app: 'app_1',
    act: 'orders:read',
    own_grp: 'org-1',
    own_prj: 'prj_1',
  };
  const verifyContext = createContextVerifier({ apiId, publicKeys, now: () => now });

  it('returns the authorized caller', () => {
    expect(verifyContext(token(claims))).toEqual({
      requestId: 'req-1',
      organizationId: 'org-1',
      projectId: 'prj_1',
      environmentId: 'env_1',
      environment: 'test',
      applicationId: 'app_1',
      action: 'orders:read',
      owner: { groupId: 'org-1', projectId: 'prj_1' },
    });
  });

  it.each([
    ['missing', undefined],
    ['another API', token({ ...claims, aud: 'apicenter-api:api_bbbbbbbbbbbbbbbbbbbbbbbb' })],
    ['expired', token({ ...claims, iat: now / 1000 - 600, exp: now / 1000 - 300 })],
    ['untrusted key', token(claims, 'other')],
    ['tampered', (() => { const [h, , s] = token(claims).split('.'); return `${h}.${Buffer.from(JSON.stringify({ ...claims, app: 'app_evil' })).toString('base64url')}.${s}`; })()],
  ])('rejects a %s context', (_label, value) => {
    expect(() => verifyContext(value)).toThrow(ApiCenterContextError);
  });

  it('refuses a key set with private key material', () => {
    const privateJwk = { ...(privateKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string }), kid: 'k1' };
    expect(() => createContextVerifier({ apiId, publicKeys: [privateJwk] })).toThrow('private key material');
  });
});
