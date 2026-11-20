import { createPlatformMessageAdminHandler, PLATFORM_EMAIL_OWNER } from '../../../../apps/email/src/shared/platform-message-admin';
import { DailyLimitReachedError } from '../../../../apps/email/src/shared/email-policy-errors';

function call(handler: ReturnType<typeof createPlatformMessageAdminHandler>, token: string | undefined, body: unknown) {
  const req = { header: (name: string) => (name === 'X-APICenter-Email-Admin-Token' ? token : undefined), body } as any;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
  return handler(req, res).then(() => res);
}

const message = { to: 'jun@serbizio.ph', subject: 'You have been added to Serbizio on APICenter', text: 'Sign in at https://console.test', html: '<p>Sign in</p>' };

const allow = () => Promise.resolve({ allowed: true, resetAt: 0 });

describe('platform message admin handler', () => {
  it('sends one message under the platform owner with the admin token', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ messageId: 'msg_1', status: 'queued', provider: 'resend' });
    const res = await call(createPlatformMessageAdminHandler({ sendEmail, consumeRecipientLimit: allow, expectedToken: 'secret' }), 'secret', message);
    expect(sendEmail).toHaveBeenCalledWith(message, PLATFORM_EMAIL_OWNER);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { messageId: 'msg_1', status: 'queued', provider: 'resend' } });
  });

  it('rejects a missing or wrong token before sending', async () => {
    const sendEmail = jest.fn();
    for (const token of [undefined, 'wrong']) {
      const res = await call(createPlatformMessageAdminHandler({ sendEmail, consumeRecipientLimit: allow, expectedToken: 'secret' }), token, message);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    const unconfigured = await call(createPlatformMessageAdminHandler({ sendEmail, consumeRecipientLimit: allow, expectedToken: undefined }), 'anything', message);
    expect(unconfigured.status).toHaveBeenCalledWith(401);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('accepts one recipient, a single-line subject and text, and nothing else', async () => {
    const sendEmail = jest.fn();
    const handler = createPlatformMessageAdminHandler({ sendEmail, consumeRecipientLimit: allow, expectedToken: 'secret' });
    for (const body of [
      { ...message, to: ['a@b.test', 'c@d.test'] },
      { ...message, to: 'not-an-email' },
      { ...message, subject: 'Hi\nBcc: x@y.test' },
      { ...message, text: '   ' },
      { ...message, from: 'spoof@example.test' },
      { ...message, html: 42 },
    ]) {
      const res = await call(handler, 'secret', body);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('maps the daily limit to 429 and provider failures to 502', async () => {
    const limited = await call(
      createPlatformMessageAdminHandler({ consumeRecipientLimit: allow, sendEmail: jest.fn().mockRejectedValue(new DailyLimitReachedError()), expectedToken: 'secret' }),
      'secret',
      message,
    );
    expect(limited.status).toHaveBeenCalledWith(429);
    const failed = await call(
      createPlatformMessageAdminHandler({ consumeRecipientLimit: allow, sendEmail: jest.fn().mockRejectedValue(new Error('Resend down')), expectedToken: 'secret' }),
      'secret',
      message,
    );
    expect(failed.status).toHaveBeenCalledWith(502);
  });

  it('applies the per-recipient rate limit before sending', async () => {
    const sendEmail = jest.fn();
    const consumeRecipientLimit = jest.fn().mockResolvedValue({ allowed: false, resetAt: Date.parse('2026-11-20T00:01:00Z') });
    const res = await call(createPlatformMessageAdminHandler({ sendEmail, consumeRecipientLimit, expectedToken: 'secret' }), 'secret', { ...message, to: 'Jun@Serbizio.ph' });
    expect(consumeRecipientLimit).toHaveBeenCalledWith('jun@serbizio.ph');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'RATE_LIMITED', resetAt: '2026-11-20T00:01:00.000Z' }));
    expect(sendEmail).not.toHaveBeenCalled();

    const unavailable = await call(
      createPlatformMessageAdminHandler({ sendEmail, consumeRecipientLimit: jest.fn().mockRejectedValue(new Error('db down')), expectedToken: 'secret' }),
      'secret',
      message,
    );
    expect(unavailable.status).toHaveBeenCalledWith(503);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
