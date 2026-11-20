import {
  ApiCenter,
  ApiCenterError,
  AuthenticationError,
  ConnectionError,
  IdempotencyError,
  NotFoundError,
  PermissionError,
  QuotaExceededError,
  RateLimitError,
  ServerError,
  ValidationError,
  type ResponseInfo,
} from '../../src';

const KEY = `ak_test_abcdefghijklmnop_${'B'.repeat(43)}`;
const LIVE_KEY = `ak_live_abcdefghijklmnop_${'C'.repeat(43)}`;

type Call = { url: string; init: RequestInit; headers: Headers };

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const ok = (data: unknown) => respond(200, { success: true, data });
const failure = (status: number, code: string, message = 'failed', headers: Record<string, string> = {}) =>
  respond(status, { success: false, error: { code, message }, meta: { correlationId: 'corr-1' } }, headers);

function client(responses: Array<Response | Error>, options: ConstructorParameters<typeof ApiCenter>[0] = {}) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, headers: new Headers(init?.headers) });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const api = new ApiCenter({ apiKey: KEY, maxRetries: 2, ...options, fetch: fetchImpl as unknown as typeof fetch });
  return { api, calls };
}

beforeEach(() => jest.spyOn(Math, 'random').mockReturnValue(0));
afterEach(() => jest.restoreAllMocks());

describe('configuration', () => {
  const saved = process.env.APICENTER_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.APICENTER_API_KEY;
    else process.env.APICENTER_API_KEY = saved;
  });

  it('needs only APICENTER_API_KEY, and takes the environment from the key', () => {
    process.env.APICENTER_API_KEY = LIVE_KEY;
    expect(new ApiCenter().environment).toBe('live');
    expect(new ApiCenter({ apiKey: KEY }).environment).toBe('test');
  });

  it('explains what to set, and rejects anything that is not an application key', () => {
    delete process.env.APICENTER_API_KEY;
    expect(() => new ApiCenter()).toThrow('Set APICENTER_API_KEY or pass apiKey');
    for (const apiKey of ['apic_test_legacy', `ak_prod_abcdefghijklmnop_${'B'.repeat(43)}`]) {
      expect(() => new ApiCenter({ apiKey })).toThrow('application key');
    }
  });

  it('has no base URL or legacy credential options', () => {
    // @ts-expect-error baseUrl was removed in 3.0
    expect(() => new ApiCenter({ apiKey: KEY, baseUrl: 'https://elsewhere.test' })).not.toThrow();
    // @ts-expect-error service credentials were removed in 3.0
    void new ApiCenter({ apiKey: KEY, auth: { serviceId: 'x', environment: 'test', secret: 's' } });
  });
});

describe('requests', () => {
  it('calls the hosted gateway with the key and version headers', async () => {
    const { api, calls } = client([ok({ results: [] })]);
    await api.geo.reverseGeocode({ latitude: 14.55, longitude: 121.02 });
    expect(calls[0].url).toBe('https://api.apicenter.itsandbox.site/api/v1/shared/geo/reverse-geocode');
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0].headers.get('apicenter-version')).toBe('2026-11-19');
    expect(calls[0].headers.get('apicenter-sdk')).toBe('apicenter-sdk-js/3.2.0');
    expect(calls[0].headers.get('idempotency-key')).toBeNull();
  });

  it('gives every write an idempotency key and reuses it on retries', async () => {
    const { api, calls } = client([respond(503, { success: false }), ok({ messageId: 'm1' })]);
    await api.email.send({ to: 'a@example.test', subject: 'Hi', text: 'Hello' });
    const [first, second] = calls.map((call) => call.headers.get('idempotency-key'));
    expect(first).toMatch(/^sdk_[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it('uses a caller key as given, and validates its length', async () => {
    const { api, calls } = client([ok({})]);
    await api.email.send({ to: 'a@example.test', subject: 'Hi', text: 'x' }, { idempotencyKey: 'order-1234-email-receipt' });
    expect(calls[0].headers.get('idempotency-key')).toBe('order-1234-email-receipt');
    await expect(api.email.send({ to: 'a@example.test', subject: 'Hi', text: 'x' }, { idempotencyKey: 'short' })).rejects.toThrow('between 16 and 255');
  });

  it('keeps the headers it manages out of callers\' hands', async () => {
    const { api } = client([]);
    for (const name of ['Authorization', 'Idempotency-Key', 'APICenter-Version', 'X-APICenter-Context']) {
      await expect(api.geo.geocode({ address: 'Makati' }, { headers: { [name]: 'x' } })).rejects.toThrow('managed by the APICenter SDK');
    }
  });

  it('reads the key\'s identity from /whoami', async () => {
    const me = { application: { id: 'app_1', slug: 'api', name: 'API' }, project: { id: 'prj_1' }, organizationId: 'org', environment: 'test', grants: ['email:send'] };
    const { api, calls } = client([ok(me)]);
    await expect(api.whoami()).resolves.toEqual(me);
    expect(calls[0].url).toBe('https://api.apicenter.itsandbox.site/api/v1/whoami');
  });
});

describe('retries', () => {
  it('retries network errors, 429 and 5xx, then succeeds', async () => {
    const { api, calls } = client([new TypeError('fetch failed'), respond(429, { success: false }, { 'retry-after': '0' }), ok({ id: 'x' })]);
    await expect(api.geo.geocode({ address: 'Makati' })).resolves.toEqual({ id: 'x' });
    expect(calls).toHaveLength(3);
  });

  it('stops after maxRetries and reports the last failure', async () => {
    const { api, calls } = client([respond(502, ''), respond(502, ''), respond(502, '')]);
    await expect(api.geo.geocode({ address: 'Makati' })).rejects.toBeInstanceOf(ServerError);
    expect(calls).toHaveLength(3);
    const none = client([respond(503, '')], { maxRetries: 0 });
    await expect(none.api.geo.geocode({ address: 'Makati' })).rejects.toBeInstanceOf(ServerError);
    expect(none.calls).toHaveLength(1);
  });

  it('does not retry client errors, an exhausted budget, or a long Retry-After', async () => {
    const invalid = client([failure(400, 'INVALID_REQUEST')]);
    await expect(invalid.api.geo.geocode({ address: '' })).rejects.toBeInstanceOf(ValidationError);
    expect(invalid.calls).toHaveLength(1);

    const quota = client([failure(429, 'QUOTA_EXCEEDED', 'budget', { 'retry-after': '3600' })]);
    const error = await quota.api.geo.geocode({ address: 'x' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QuotaExceededError);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ retryAfterSeconds: 3600, requestId: 'corr-1' });
    expect(quota.calls).toHaveLength(1);

    const slow = client([failure(429, 'RATE_LIMITED', 'slow down', { 'retry-after': '120' })]);
    await expect(slow.api.geo.geocode({ address: 'x' })).rejects.toMatchObject({ retryAfterSeconds: 120 });
    expect(slow.calls).toHaveLength(1);
  });

  it('times out each attempt and reports a ConnectionError', async () => {
    const hang = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    }));
    const api = new ApiCenter({ apiKey: KEY, timeoutMs: 20, maxRetries: 1, fetch: hang as unknown as typeof fetch });
    await expect(api.geo.geocode({ address: 'x' })).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: 0 });
    expect(hang).toHaveBeenCalledTimes(2);
  });

  it('stops at once when the caller aborts', async () => {
    const controller = new AbortController();
    const { api, calls } = client([respond(503, '')]);
    const pending = api.geo.geocode({ address: 'x' }, { signal: controller.signal });
    controller.abort(new Error('caller gave up'));
    await expect(pending).rejects.toThrow('caller gave up');
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it('reports every attempt to the hooks', async () => {
    const seen: ResponseInfo[] = [];
    const { api } = client([respond(503, ''), ok({})], { hooks: { onResponse: (info) => seen.push(info) } });
    await api.email.send({ to: 'a@example.test', subject: 'Hi', text: 'x' });
    expect(seen.map((info) => [info.attempt, info.status])).toEqual([[1, 503], [2, 200]]);
    expect(seen[0].error).toBeInstanceOf(ServerError);
  });
});

describe('errors', () => {
  it.each([
    [401, 'CREDENTIAL_REVOKED', AuthenticationError],
    [403, 'ACTION_NOT_GRANTED', PermissionError],
    [404, 'NOT_FOUND', NotFoundError],
    [409, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH', IdempotencyError],
    [422, 'INVALID_REQUEST', ValidationError],
  ])('maps %i %s to its class', async (status, code, type) => {
    const { api } = client([failure(status, code)]);
    const error = await api.geo.geocode({ address: 'x' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(type);
    expect(error).toBeInstanceOf(ApiCenterError);
    expect(error).toMatchObject({ status, code, requestId: 'corr-1' });
  });

  it('redacts keys and secrets from messages and details, and hides 5xx details', async () => {
    const leaky = respond(400, { success: false, error: { code: 'INVALID', message: `bad key ${KEY} secret=abc`, details: { apiKey: 'x', field: `Bearer ${KEY}` } } });
    const { api } = client([leaky]);
    const error = (await api.geo.geocode({ address: 'x' }).catch((caught: unknown) => caught)) as ApiCenterError;
    expect(error.message).not.toContain(KEY.slice(8));
    expect(error.message).toContain('secret=[REDACTED]');
    expect(error.details).toEqual({ field: 'Bearer [REDACTED]' });

    const server = client([respond(500, { success: false, error: { code: 'BOOM', message: 'stack trace here', details: { a: 1 } } })], { maxRetries: 0 });
    const hidden = (await server.api.geo.geocode({ address: 'x' }).catch((caught: unknown) => caught)) as ApiCenterError;
    expect(hidden.message).toBe('APICenter returned an error (500)');
    expect(hidden.details).toBeUndefined();
  });

  it('reports unreadable responses as errors with their status', async () => {
    const { api } = client([respond(400, 'not json'), respond(400, '')], { maxRetries: 0 });
    await expect(api.geo.geocode({ address: 'x' })).rejects.toMatchObject({ code: 'INVALID_JSON', status: 400 });
    await expect(api.geo.geocode({ address: 'x' })).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' });
  });

  it('reports an unreachable gateway as a ConnectionError', async () => {
    const { api } = client([new TypeError('fetch failed')], { maxRetries: 0 });
    await expect(api.geo.geocode({ address: 'x' })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(client([new TypeError('x')], { maxRetries: 0 }).api.geo.geocode({ address: 'x' })).rejects.toBeInstanceOf(ConnectionError);
  });
});

describe('ApiCenterError.retryable', () => {
  const error = (status: number, code?: string) => new ApiCenterError('x', { status, code });

  it('is true for failures the same request may get past', () => {
    expect(new ConnectionError('offline', { status: 0, code: 'NETWORK_ERROR' }).retryable).toBe(true);
    for (const status of [408, 429, 500, 502, 503, 504]) expect(error(status).retryable).toBe(true);
    expect(new ServerError('busy', { status: 503, code: 'DATABASE_BUSY' }).retryable).toBe(true);
  });

  it('is false for answers, and for a used-up quota until its window resets', () => {
    for (const status of [400, 401, 403, 404, 409, 422, 501]) expect(error(status).retryable).toBe(false);
    expect(new QuotaExceededError('quota', { status: 429, code: 'QUOTA_EXCEEDED' }).retryable).toBe(false);
  });
});
