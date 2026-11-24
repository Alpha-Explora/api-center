import { createSmsSender, MessagingProviderError } from '@apicenter/runtime';

// The Twilio adapter's request format. The shared sender contract is in tests/unit/src/runtime/messaging-conformance.spec.ts.
describe('Twilio SMS adapter', () => {
  const originalFetch = global.fetch;
  const env = {
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'secret',
    TWILIO_MESSAGING_SERVICE_SID: 'MG123',
    TWILIO_STATUS_CALLBACK_URL: 'https://api-center.example.test/api/v1/webhooks/twilio',
  } as NodeJS.ProcessEnv;

  afterEach(() => { global.fetch = originalFetch; });

  it('submits the form and reports Twilio acceptance as queued', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201,
      json: async () => ({ sid: 'SM123', status: 'accepted' }) });

    await expect(createSmsSender(env).send({ to: '+639000000000', message: 'hello' }))
      .resolves.toEqual({ providerMessageId: 'SM123', status: 'queued' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.body.toString()).toContain('MessagingServiceSid=MG123');
    expect(init.body.toString()).toContain('To=%2B639000000000');
    expect(init.body.toString()).toContain('StatusCallback=https%3A%2F%2Fapi-center.example.test%2Fapi%2Fv1%2Fwebhooks%2Ftwilio');
  });

  it('uses a pinned sender ID as From instead of the messaging service', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ sid: 'SM124', status: 'queued' }) });
    await createSmsSender(env).send({ to: '+639000000000', message: 'hello', senderId: 'MyShop' });
    const body = (global.fetch as jest.Mock).mock.calls[0][1].body.toString();
    expect(body).toContain('From=MyShop');
    expect(body).not.toContain('MessagingServiceSid');
  });

  it('fails before the network when credentials are missing', async () => {
    global.fetch = jest.fn();
    await expect(createSmsSender({ ...env, TWILIO_ACCOUNT_SID: '' }).send({ to: '+639000000000', message: 'hello' }))
      .rejects.toBeInstanceOf(MessagingProviderError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
