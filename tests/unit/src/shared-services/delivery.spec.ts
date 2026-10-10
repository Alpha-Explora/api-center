import { sendTwilioSms } from '@apicenter/runtime';

describe('Twilio SMS delivery', () => {
  const originalFetch = global.fetch;
  const original = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    sender: process.env.TWILIO_MESSAGING_SERVICE_SID,
    callback: process.env.TWILIO_STATUS_CALLBACK_URL,
  };

  afterEach(() => {
    global.fetch = originalFetch;
    if (original.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = original.sid;
    if (original.token === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = original.token;
    if (original.sender === undefined) delete process.env.TWILIO_MESSAGING_SERVICE_SID; else process.env.TWILIO_MESSAGING_SERVICE_SID = original.sender;
    if (original.callback === undefined) delete process.env.TWILIO_STATUS_CALLBACK_URL; else process.env.TWILIO_STATUS_CALLBACK_URL = original.callback;
  });

  it('submits the form and reports Twilio acceptance as queued', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'secret';
    process.env.TWILIO_MESSAGING_SERVICE_SID = 'MG123';
    process.env.TWILIO_STATUS_CALLBACK_URL = 'https://api-center.example.test/api/v1/webhooks/twilio';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 201,
      json: async () => ({ sid: 'SM123', status: 'accepted' }) });

    await expect(sendTwilioSms({ to: '+639000000000', message: 'hello' }))
      .resolves.toEqual({ messageId: 'SM123', status: 'queued' });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(init.body.toString()).toContain('MessagingServiceSid=MG123');
    expect(init.body.toString()).toContain('To=%2B639000000000');
    expect(init.body.toString()).toContain('StatusCallback=https%3A%2F%2Fapi-center.example.test%2Fapi%2Fv1%2Fwebhooks%2Ftwilio');
  });

  it('fails before the network when credentials are missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID;
    global.fetch = jest.fn();
    await expect(sendTwilioSms({ to: '+639000000000', message: 'hello' }))
      .rejects.toThrow('Twilio account');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
