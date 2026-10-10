import { Webhook } from 'standardwebhooks';
import twilio from 'twilio';
import { DeliveryWebhookController } from '../../../../apps/gateway/src/domains/gateway-proxy/shared-services/delivery-webhook.controller';
import { UnauthorizedError } from '../../../../apps/gateway/src/shared/errors';

jest.mock('../../../../apps/gateway/src/shared/proxy/cloud-run-auth', () => ({
  getCloudRunAuthorizationHeader: jest.fn().mockResolvedValue(undefined),
}));

describe('DeliveryWebhookController', () => {
  const resendSecret = `whsec_${Buffer.from('resend-test-secret').toString('base64')}`;
  const twilioAuthToken = 'twilio-test-token';
  const callbackUrl = 'https://api-center.example.test/api/v1/webhooks/twilio';
  const registry = {
    get: jest.fn((serviceId: string) => ({
      environments: [{ environment: 'live', baseUrl: `https://${serviceId}.example.test` }],
    })),
  };
  const config = {
    deliveryWebhooks: { resendWebhookSecret: resendSecret, twilioAuthToken, twilioStatusCallbackUrl: callbackUrl },
  };
  let controller: DeliveryWebhookController;
  let fetchMock: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DeliveryWebhookController(registry as any, config as any);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '{"received":true}' });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('verifies and forwards a valid Resend delivery event', async () => {
    const body = Buffer.from(JSON.stringify({ type: 'email.delivered', data: { email_id: 're_123' } }));
    const id = 'evt_resend_123';
    const now = new Date();
    const signature = new Webhook(resendSecret).sign(id, now, body);
    const result = await controller.resend({
      rawBody: body,
      headers: {
        'svix-id': id,
        'svix-timestamp': String(Math.floor(now.getTime() / 1000)),
        'svix-signature': signature,
      },
    } as any);

    expect(result).toEqual({ received: true });
    expect(fetchMock).toHaveBeenCalledWith('https://email.example.test/webhooks/resend', expect.objectContaining({
      body: JSON.stringify({
        providerEventId: id,
        messageId: 're_123',
        status: 'delivered',
        payload: { type: 'email.delivered', data: { email_id: 're_123' } },
      }),
    }));
  });

  it('rejects a Resend event with an invalid signature before forwarding', async () => {
    await expect(controller.resend({
      rawBody: Buffer.from('{"type":"email.delivered","data":{"email_id":"re_123"}}'),
      headers: { 'svix-id': 'evt_bad', 'svix-timestamp': String(Math.floor(Date.now() / 1000)), 'svix-signature': 'v1,bad' },
    } as any)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies and forwards a valid Twilio status callback', async () => {
    const params = { MessageSid: 'SM123', MessageStatus: 'delivered', To: '+15550000000' };
    const signature = twilio.getExpectedTwilioSignature(twilioAuthToken, callbackUrl, params);
    const result = await controller.twilio({
      originalUrl: '/api/v1/webhooks/twilio',
      headers: { 'x-twilio-signature': signature },
      body: params,
    } as any);

    expect(result).toEqual({ received: true });
    expect(fetchMock).toHaveBeenCalledWith('https://sms.example.test/webhooks/twilio', expect.objectContaining({
      body: expect.stringContaining('"messageId":"SM123"'),
    }));
  });

  it('rejects a Twilio callback with an invalid signature before forwarding', async () => {
    await expect(controller.twilio({
      originalUrl: '/api/v1/webhooks/twilio',
      headers: { 'x-twilio-signature': 'invalid' },
      body: { MessageSid: 'SM123', MessageStatus: 'delivered' },
    } as any)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
