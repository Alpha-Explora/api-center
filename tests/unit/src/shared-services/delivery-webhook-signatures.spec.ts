import { Webhook } from 'standardwebhooks';
import twilio from 'twilio';
import { verifyResendSignature, verifyTwilioSignature, twilioProviderEventId } from '../../../../apps/gateway/src/domains/gateway-proxy/shared-services/delivery-webhook-signatures';

describe('delivery webhook signatures', () => {
  it('accepts a valid Resend Svix signature and rejects a bad one', () => {
    const secret = `whsec_${Buffer.from('resend-test-secret').toString('base64')}`;
    const rawBody = Buffer.from(JSON.stringify({ type: 'email.delivered', data: { email_id: 're_123' } }));
    const id = 'msg_webhook_123';
    const now = new Date();
    const signature = new Webhook(secret).sign(id, now, rawBody);
    const headers = { id, timestamp: String(Math.floor(now.getTime() / 1000)), signature };

    expect(verifyResendSignature(secret, rawBody, headers)).toEqual({ type: 'email.delivered', data: { email_id: 're_123' } });
    expect(() => verifyResendSignature(secret, rawBody, { ...headers, signature: 'v1,bad' })).toThrow();
  });

  it('accepts a valid Twilio signature and rejects a bad one', () => {
    const authToken = 'twilio-test-token';
    const url = 'https://api-center.example.test/api/v1/webhooks/twilio';
    const params = { MessageSid: 'SM123', MessageStatus: 'delivered', To: '+15550000000' };
    const signature = twilio.getExpectedTwilioSignature(authToken, url, params);

    expect(verifyTwilioSignature(authToken, signature, url, params)).toBe(true);
    expect(verifyTwilioSignature(authToken, 'invalid', url, params)).toBe(false);
    expect(twilioProviderEventId(params)).toBe(twilioProviderEventId({ To: params.To, MessageStatus: params.MessageStatus, MessageSid: params.MessageSid }));
    expect(twilioProviderEventId(params)).not.toBe(twilioProviderEventId({ ...params, MessageStatus: 'sent' }));
  });
});
