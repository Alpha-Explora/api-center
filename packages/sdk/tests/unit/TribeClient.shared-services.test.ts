import { TribeClient } from '../../src';

describe('TribeClient shared services', () => {
  it('sends email through the authenticated shared namespace', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { messageId: 'msg_1', provider: 'mock', status: 'mock_sent', recipient: ['a@example.test'] } }),
    })) as unknown as typeof fetch;
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test/', apiKey: 'ac_test_key', tribeId: 'alphaci', fetchImpl });
    await client.shared.emailSend({ to: 'a@example.test', subject: 'Hello', text: 'World' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api-center.example.test/api/v1/shared/email/send', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer ac_test_key', 'X-Tribe-ID': 'alphaci', 'X-APICenter-Environment': 'test' }),
      body: JSON.stringify({ to: 'a@example.test', subject: 'Hello', text: 'World' }),
    }));
  });

  it('encodes identifiers and preserves shared-service errors', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: { code: 'NOT_FOUND', message: 'Missing' } }),
    })) as unknown as typeof fetch;
    const client = new TribeClient({ baseUrl: 'https://api-center.example.test', apiKey: 'ac_test_key', tribeId: 'alphaci', fetchImpl });
    await expect(client.shared.otpStatus('otp/a')).rejects.toMatchObject({ details: expect.objectContaining({ code: 'NOT_FOUND', status: 404 }) });
    expect(fetchImpl).toHaveBeenCalledWith('https://api-center.example.test/api/v1/shared/otp/status/otp%2Fa', expect.objectContaining({ method: 'GET' }));
  });
});