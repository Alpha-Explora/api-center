import { ServiceTokenProvider } from '../../src/internal/auth/service-token-provider';

describe('ServiceTokenProvider', () => {
  const credentials = { serviceId: 'orders-api', environment: 'test' as const, secret: 'service-secret' };

  it('issues once, refreshes before expiry, and adopts the rotated refresh token', async () => {
    let now = 1_000;
    const request = jest.fn()
      .mockResolvedValueOnce({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 100 })
      .mockResolvedValueOnce({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 100 })
      .mockResolvedValueOnce({ accessToken: 'access-3', refreshToken: null, expiresIn: 100 });
    const provider = new ServiceTokenProvider(credentials, request, () => now);

    await expect(provider.getAccessToken()).resolves.toBe('access-1');
    now = 92_000;
    await expect(provider.getAccessToken()).resolves.toBe('access-2');
    now = 184_000;
    await expect(provider.getAccessToken()).resolves.toBe('access-3');

    expect(request.mock.calls).toEqual([
      ['/api/v1/auth/token', { serviceId: 'orders-api', environment: 'test', secret: 'service-secret' }],
      ['/api/v1/auth/token/refresh', { refreshToken: 'refresh-1' }],
      ['/api/v1/auth/token/refresh', { refreshToken: 'refresh-2' }],
    ]);
  });

  it('shares a single in-flight refresh across concurrent requests', async () => {
    let now = 1_000;
    let finishRefresh!: (value: { accessToken: string; refreshToken: string; expiresIn: number }) => void;
    const request = jest.fn()
      .mockResolvedValueOnce({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 10 })
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }));
    const provider = new ServiceTokenProvider(credentials, request, () => now);

    await provider.getAccessToken();
    now = 10_500;
    const first = provider.getAccessToken();
    const second = provider.getAccessToken();
    expect(request).toHaveBeenCalledTimes(2);
    finishRefresh({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 10 });

    await expect(Promise.all([first, second])).resolves.toEqual(['access-2', 'access-2']);
  });

  it('reissues with the service credentials when the issuer provided no refresh token', async () => {
    let now = 1_000;
    const request = jest.fn()
      .mockResolvedValueOnce({ accessToken: 'access-1', refreshToken: null, expiresIn: 10 })
      .mockResolvedValueOnce({ accessToken: 'access-2', refreshToken: null, expiresIn: 10 });
    const provider = new ServiceTokenProvider(credentials, request, () => now);

    await provider.getAccessToken();
    now = 10_500;
    await provider.getAccessToken();

    expect(request).toHaveBeenNthCalledWith(2, '/api/v1/auth/token', {
      serviceId: 'orders-api', environment: 'test', secret: 'service-secret',
    });
  });

  it('rejects an empty or malformed service token response', async () => {
    const provider = new ServiceTokenProvider(
      credentials,
      jest.fn().mockResolvedValue({ accessToken: '', refreshToken: null, expiresIn: 3600 }),
    );

    await expect(provider.getAccessToken()).rejects.toMatchObject({
      name: 'ApiCenterError',
      code: 'INVALID_TOKEN_RESPONSE',
      status: 502,
    });
  });

  it('does not reuse a refresh token after refresh fails', async () => {
    let now = 1_000;
    const request = jest.fn()
      .mockResolvedValueOnce({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 10 })
      .mockRejectedValueOnce(new Error('refresh rejected'))
      .mockResolvedValueOnce({ accessToken: 'access-2', refreshToken: null, expiresIn: 10 });
    const provider = new ServiceTokenProvider(credentials, request, () => now);

    await provider.getAccessToken();
    now = 10_500;
    await expect(provider.getAccessToken()).rejects.toThrow('refresh rejected');
    await expect(provider.getAccessToken()).resolves.toBe('access-2');

    expect(request.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/auth/token',
      '/api/v1/auth/token/refresh',
      '/api/v1/auth/token',
    ]);
  });
});
