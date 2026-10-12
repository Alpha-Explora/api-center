import { ApiCenterError } from '../../src/internal/errors';
import { ApiCenterTransport } from '../../src/internal/transport';

function response(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload),
  } as Response;
}

function requestHeaders(fetchMock: jest.Mock, call = 0): Headers {
  const request = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return new Headers(request?.headers);
}

describe('ApiCenterTransport', () => {
  it('uses the service token provider and normalizes the base URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, data: { ok: true } }));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test/',
      auth: { getAccessToken: async () => 'service-token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.request({
      path: '/api/v1/shared/email/status/msg-1', method: 'GET', credential: 'service',
    })).resolves.toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://gateway.example.test/api/v1/shared/email/status/msg-1');
    expect((fetchImpl.mock.calls[0]?.[1] as RequestInit).method).toBe('GET');
    expect(requestHeaders(fetchImpl).get('authorization')).toBe('Bearer service-token');
  });

  it('uses an explicit payment key only on payment requests', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, data: {} }));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test',
      auth: { getAccessToken: async () => 'service-token' },
      paymentApiKey: 'apic_payment_key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.request({ path: '/email', method: 'GET', credential: 'service' });
    await transport.request({ path: '/payment', method: 'GET', credential: 'payment' });

    expect(requestHeaders(fetchImpl, 0).get('authorization')).toBe('Bearer service-token');
    expect(requestHeaders(fetchImpl, 1).get('authorization')).toBe('Bearer apic_payment_key');
  });

  it('supports payment-key-only configuration and fails service calls locally', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, data: {} }));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test',
      paymentApiKey: 'apic_payment_key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.request({ path: '/payment', method: 'GET', credential: 'payment' });
    await expect(transport.request({ path: '/email', method: 'GET', credential: 'service' }))
      .rejects.toThrow('This operation requires service auth');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('blocks callers from overriding authorization, identity, or SDK idempotency headers', async () => {
    const fetchImpl = jest.fn();
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test',
      auth: { getAccessToken: async () => 'service-token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    for (const header of ['authorization', 'X-Tribe-Id', 'X-APICenter-Project-Id', 'idempotency-key']) {
      await expect(transport.request({
        path: '/resource', method: 'GET', credential: 'service', options: { headers: { [header]: 'override' } },
      })).rejects.toThrow('managed by the APICenter SDK');
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sets and validates idempotency keys through typed request options', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, data: {} }));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test',
      auth: { getAccessToken: async () => 'service-token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.request({
      path: '/send', method: 'POST', credential: 'service', body: {}, idempotencyKey: '0123456789abcdef',
    });
    expect(requestHeaders(fetchImpl).get('idempotency-key')).toBe('0123456789abcdef');
    await expect(transport.request({
      path: '/send', method: 'POST', credential: 'service', body: {}, idempotencyKey: 'too-short',
    })).rejects.toThrow('between 16 and 255 characters');
  });

  it('unwraps successful and 202 envelopes', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({ success: true, data: { id: 'created' } }, 201))
      .mockResolvedValueOnce(response({ success: true, data: { status: 'pending', resourceId: 'pending-1' } }, 202));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth: { getAccessToken: async () => 'token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.request({ path: '/one', method: 'POST', credential: 'service', body: {} }))
      .resolves.toEqual({ id: 'created' });
    await expect(transport.request({ path: '/two', method: 'POST', credential: 'service', body: {} }))
      .resolves.toEqual({ status: 'pending', resourceId: 'pending-1' });
  });

  it('preserves APICenter error metadata and correlation IDs', async () => {
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth: { getAccessToken: async () => 'token' },
      fetchImpl: jest.fn().mockResolvedValue(response({
        success: false,
        error: { code: 'NOT_FOUND', message: 'No item', details: { kind: 'item' } },
        meta: { correlationId: 'corr-1' },
      }, 404)) as unknown as typeof fetch,
    });

    await expect(transport.request({ path: '/missing', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({
        name: 'ApiCenterError', status: 404, code: 'NOT_FOUND', details: { kind: 'item' }, correlationId: 'corr-1',
      });
  });

  it('redacts secrets from client errors and hides server error details', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid apiKey=client-secret-value',
          details: {
            field: 'apiKey=client-secret-value',
            accessToken: 'private-access-token',
            nested: { note: 'Bearer private-token', secret: 'private-secret' },
          },
        },
      }, 400))
      .mockResolvedValueOnce(response({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'database password=private-password', details: { query: 'private-query' } },
      }, 500));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth: { getAccessToken: async () => 'token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.request({ path: '/invalid', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({
        message: 'Invalid apiKey=[REDACTED]',
        details: { field: 'apiKey=[REDACTED]', nested: { note: 'Bearer [REDACTED]' } },
      });
    await expect(transport.request({ path: '/server-error', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({
        message: 'APICenter returned an error (500)',
        code: 'INTERNAL_ERROR',
        details: undefined,
      });
  });

  it('reports malformed and empty response bodies consistently', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(response('not-json'))
      .mockResolvedValueOnce(response(''));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth: { getAccessToken: async () => 'token' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(transport.request({ path: '/bad-json', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({ name: 'ApiCenterError', code: 'INVALID_JSON' });
    await expect(transport.request({ path: '/empty', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({ name: 'ApiCenterError', code: 'EMPTY_RESPONSE' });
  });

  it('times out stalled requests and preserves caller cancellation', async () => {
    const stalledFetch = jest.fn((_input: string | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth: { getAccessToken: async () => 'token' },
      fetchImpl: stalledFetch as unknown as typeof fetch, timeoutMs: 5,
    });

    await expect(transport.request({ path: '/stalled', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({ name: 'ApiCenterError', code: 'REQUEST_TIMEOUT', status: 0 });

    const controller = new AbortController();
    controller.abort(new Error('caller cancelled'));
    await expect(transport.request({
      path: '/cancelled', method: 'GET', credential: 'service', options: { signal: controller.signal },
    })).rejects.toThrow('caller cancelled');
  });

  it('times out credential lookup and passes the abort signal to access-token providers', async () => {
    let providerSignal: AbortSignal | undefined;
    const auth = {
      getAccessToken: jest.fn((options?: { signal?: AbortSignal }) => {
        providerSignal = options?.signal;
        return new Promise<string>(() => {});
      }),
    };
    const fetchImpl = jest.fn();
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth,
      fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5,
    });

    await expect(transport.request({ path: '/stalled-auth', method: 'GET', credential: 'service' }))
      .rejects.toMatchObject({ name: 'ApiCenterError', code: 'REQUEST_TIMEOUT', status: 0 });
    expect(providerSignal?.aborted).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels while resolving credentials and keeps provider method receivers', async () => {
    const controller = new AbortController();
    const auth = {
      token: 'receiver-bound-token',
      getAccessToken: jest.fn(async function (this: { token: string }) { return this.token; }),
    };
    const fetchImpl = jest.fn().mockResolvedValue(response({ success: true, data: {} }));
    const transport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await transport.request({ path: '/bound-provider', method: 'GET', credential: 'service' });
    expect(requestHeaders(fetchImpl).get('authorization')).toBe('Bearer receiver-bound-token');

    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const pendingAuth = {
      getAccessToken: jest.fn(() => {
        providerStarted();
        return new Promise<string>(() => {});
      }),
    };
    const pendingTransport = new ApiCenterTransport({
      baseUrl: 'https://gateway.example.test', auth: pendingAuth,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const pendingRequest = pendingTransport.request({
      path: '/cancelled-auth', method: 'GET', credential: 'service', options: { signal: controller.signal },
    });
    await started;
    controller.abort(new Error('credential lookup cancelled'));

    await expect(pendingRequest).rejects.toThrow('credential lookup cancelled');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exports the common typed error class', () => {
    const error = new ApiCenterError('Failure', { status: 503, code: 'UPSTREAM' });
    expect(error).toMatchObject({ name: 'ApiCenterError', message: 'Failure', status: 503, code: 'UPSTREAM' });
  });
});
