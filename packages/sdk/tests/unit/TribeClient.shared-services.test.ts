import { TribeClient } from '../../src';

describe('TribeClient shared services', () => {
  it('sends email through the authenticated shared namespace', async () => {
    const requestOptions: RequestInit[] = [];
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { messageId: 'msg_1', provider: 'mock', status: 'mock_sent', recipient: ['a@example.test'] } }),
    })) as unknown as typeof fetch;
    const capturingFetch = jest.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requestOptions.push(init ?? {});
      return fetchImpl(input, init);
    }) as typeof fetch;
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test/', apiKey: 'ac_test_key', serviceToken: 'jwt_service_token', fetchImpl: capturingFetch });
    await client.shared.emailSend({ to: 'a@example.test', subject: 'Hello', text: 'World' });
    expect(capturingFetch).toHaveBeenCalledWith('https://api-center.example.test/api/v1/shared/email/send', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer jwt_service_token' }),
      body: JSON.stringify({ to: 'a@example.test', subject: 'Hello', text: 'World' }),
    }));
    expect(requestOptions[0]?.headers).not.toHaveProperty('X-APICenter-Environment');
    expect(requestOptions[0]?.headers).not.toHaveProperty('X-Tribe-ID');
  });

  it('encodes identifiers and preserves shared-service errors', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: { code: 'NOT_FOUND', message: 'Missing' } }),
    })) as unknown as typeof fetch;
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test', apiKey: 'ac_test_key', serviceToken: 'jwt_service_token', fetchImpl });
    await expect(client.shared.otpStatus('otp/a')).rejects.toMatchObject({ details: expect.objectContaining({ code: 'NOT_FOUND', status: 404 }) });
    expect(fetchImpl).toHaveBeenCalledWith('https://api-center.example.test/api/v1/shared/otp/status/otp%2Fa', expect.objectContaining({ method: 'GET' }));
  });
});
