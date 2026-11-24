import { spawnSync } from 'node:child_process';
import { createEmailSender, createSmsSender, MessagingProviderError } from '@apicenter/runtime';
import { GenerateOtpService } from '../../../../apps/otp/src/features/generate-otp/generate-otp.service';
import { MemoryOtpStore } from '../../../../apps/otp/src/shared/otp-store';

const realFetch = global.fetch;

function respond(status: number, body: unknown) {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

const twilioEnv = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'token', TWILIO_FROM_NUMBER: 'APICenter',
  TWILIO_STATUS_CALLBACK_URL: 'https://api.example/cb' } as NodeJS.ProcessEnv;
const resendEnv = { RESEND_API_KEY: 're_key' } as NodeJS.ProcessEnv;
const sms = { to: '+639171234567', message: 'Your code is 123456' };
const email = { to: ['user@example.test'], from: 'APICenter <no-reply@example.test>', subject: 'Hi', text: 'Hello' };

describe('messaging conformance', () => {
  afterEach(() => { global.fetch = realFetch; });

  describe.each([
    ['twilio', () => createSmsSender({ ...twilioEnv, SMS_PROVIDER: 'twilio' }), { sid: 'SM1', status: 'queued' }],
    ['mock', () => createSmsSender({ SMS_PROVIDER: 'mock' } as NodeJS.ProcessEnv), undefined],
  ])('%s SMS sender', (_name, make, accepted) => {
    it('sends and returns the provider message ID and a known status', async () => {
      if (accepted) respond(201, accepted);
      const result = await make().send(sms);
      expect(typeof result.providerMessageId).toBe('string');
      expect(['queued', 'sent', 'delivered', 'failed']).toContain(result.status);
    });
  });

  describe.each([
    ['resend', () => createEmailSender({ ...resendEnv, EMAIL_PROVIDER: 'resend' }), { id: 're_1' }],
    ['mock', () => createEmailSender({ EMAIL_PROVIDER: 'mock' } as NodeJS.ProcessEnv), undefined],
  ])('%s email sender', (_name, make, accepted) => {
    it('sends and returns the provider message ID', async () => {
      if (accepted) respond(200, accepted);
      expect(typeof (await make().send(email)).providerMessageId).toBe('string');
    });
  });

  describe.each([
    ['twilio', () => createSmsSender(twilioEnv), () => createSmsSender({} as NodeJS.ProcessEnv), (sender: any) => sender.send(sms)],
    ['resend', () => createEmailSender(resendEnv), () => createEmailSender({} as NodeJS.ProcessEnv), (sender: any) => sender.send(email)],
  ])('%s failures', (_name, make, unconfigured, send) => {
    it('reports a provider 4xx as rejected, without the provider\'s text', async () => {
      respond(400, { message: 'Provider internal detail 21211' });
      const error = await send(make()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(MessagingProviderError);
      expect(error).toMatchObject({ kind: 'rejected', statusCode: 502, detail: 'Provider internal detail 21211' });
      expect(error.message).not.toContain('21211');
    });

    it('reports a provider 5xx as rejected', async () => {
      respond(500, {});
      await expect(send(make())).rejects.toMatchObject({ kind: 'rejected' });
    });

    it('reports a timeout or network failure as unreachable, whose outcome is unknown', async () => {
      global.fetch = jest.fn(async () => { throw new DOMException('timed out', 'TimeoutError'); }) as typeof fetch;
      await expect(send(make())).rejects.toMatchObject({ kind: 'unreachable', statusCode: 502 });
    });

    it('reports missing configuration before calling the provider', async () => {
      global.fetch = jest.fn() as typeof fetch;
      const sender = unconfigured();
      expect(sender.configured()).toBe(false);
      await expect(send(sender)).rejects.toMatchObject({ kind: 'not_configured', statusCode: 503 });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  it('otp sends through the sms and email senders with the same guards', async () => {
    const senders = {
      sms: { provider: 'fake', defaultSenderId: undefined, hasPlatformSender: () => true, configured: () => true,
        send: jest.fn(async () => ({ providerMessageId: 'p1', status: 'queued' as const })) },
      email: { provider: 'fake', configured: () => true, send: jest.fn(async () => ({ providerMessageId: 'p2' })) },
    };
    const owner = { tribeId: 'org', projectId: 'prj', serviceId: 'app', environment: 'test', projectName: 'Shop' } as never;
    const previous = process.env.EMAIL_FROM_ADDRESS;
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.test';
    try {
      const service = new GenerateOtpService(new MemoryOtpStore(), senders);
      await service.execute({ channel: 'sms', recipient: '+639171234567' } as never, owner);
      await service.execute({ channel: 'email', recipient: 'user@example.test' } as never, owner);
    } finally {
      if (previous === undefined) delete process.env.EMAIL_FROM_ADDRESS; else process.env.EMAIL_FROM_ADDRESS = previous;
    }
    expect(senders.sms.send).toHaveBeenCalledWith({ to: '+639171234567', message: expect.stringMatching(/\d{6}/) });
    expect(senders.email.send).toHaveBeenCalledWith(expect.objectContaining({ to: ['user@example.test'],
      from: '"Shop" <no-reply@example.test>', subject: 'Your Shop verification code' }));
  });

  it('no sending code outside the adapters names a vendor SDK or API', () => {
    const result = spawnSync('git', [
      'grep', '-nE', String.raw`api\.twilio\.com|api\.resend\.com|from ["']resend["']|new Resend\(|maps\.googleapis\.com`, '--',
      'apps/email/src', 'apps/sms/src', 'apps/otp/src', 'apps/geo/src', 'packages/runtime/src',
      ':!packages/runtime/src/adapters', ':!apps/geo/src/shared/google-geocoding-adapter.ts',
    ], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
    expect(result.status).toBe(1);
  });
});
