import type { SharedServiceCaller } from '@apicenter/runtime';
import { formatSender } from '@apicenter/runtime';
import { GenerateOtpService } from '../../../../apps/otp/src/features/generate-otp/generate-otp.service';
import { MemoryOtpStore } from '../../../../apps/otp/src/shared/otp-store';
import { otpEmail } from '../../../../apps/otp/src/shared/otp-email';
import { messageProjectName, otpTemplateProblem, renderOtpMessage } from '../../../../apps/otp/src/shared/project-settings';

const owner: SharedServiceCaller = { tribeId: 'org-a', projectId: 'project-a', serviceId: 'app-a', environment: 'live', model: 'application', projectName: 'Serbizio' };

describe('the verification code email', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('is sent under the project name, with the code, expiry and an honest footer', async () => {
    process.env.OTP_DELIVERY_MODE = 'live';
    process.env.RESEND_API_KEY = 're_test';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@itsandbox.site';
    const sent: Record<string, unknown>[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
    });

    await new GenerateOtpService(new MemoryOtpStore()).execute({ channel: 'email', recipient: 'user@example.test', purpose: 'verification', ttlSeconds: 600 }, owner);

    expect(sent).toHaveLength(1);
    const [email] = sent as { from: string; subject: string; text: string; html: string }[];
    expect(email.from).toBe('"Serbizio" <noreply@itsandbox.site>');
    expect(email.subject).toBe('Your Serbizio verification code');
    const code = /verification code is (\d{6})/.exec(email.text)?.[1];
    expect(code).toBeDefined();
    expect(email.text).toContain('This code expires in 10 minutes.');
    expect(email.text).toContain('Sent by APICenter for Serbizio.');
    expect(email.html).toContain(`>${code}</div>`);
  });

  it('escapes the project name and message in the HTML', () => {
    const email = otpEmail({ projectName: 'A&B <Shop>', code: '123456', ttlSeconds: 60, message: 'Your A&B <Shop> code is 123456' });
    expect(email.html).toContain('A&amp;B &lt;Shop&gt;');
    expect(email.html).not.toContain('<Shop>');
    expect(email.text).toContain('This code expires in 1 minute.');
  });

  it('keeps links and phone numbers out of messages through the project name', () => {
    expect(messageProjectName('Serbizio')).toBe('Serbizio');
    expect(messageProjectName('Visit evil.example now')).toBe('APICenter');
    expect(messageProjectName('Call +63 917 555 0100')).toBe('APICenter');
    expect(messageProjectName(undefined)).toBe('APICenter');
  });

  it('accepts {{project}} in templates and fills it in', () => {
    expect(otpTemplateProblem('Your {{project}} code is {{code}}')).toBeNull();
    expect(renderOtpMessage('Your {{project}} code is {{code}}, valid {{minutes}} min', '4821', 300, 'Serbizio')).toBe('Your Serbizio code is 4821, valid 5 min');
    expect(renderOtpMessage('Your {{project}} code is {{code}}', '4821', 300)).toBe('Your APICenter code is 4821');
  });
});

describe('the sender header', () => {
  it('puts a clean name in front of the address', () => {
    expect(formatSender('noreply@itsandbox.site', 'Serbizio')).toBe('"Serbizio" <noreply@itsandbox.site>');
  });

  it('cannot change the address or add a header through the name', () => {
    expect(formatSender('noreply@itsandbox.site', 'Evil" <a@b.example>\r\nBcc: x\\y')).toBe('"Evil a@b.example Bcc: x y" <noreply@itsandbox.site>');
  });

  it('falls back to the bare address without a usable name', () => {
    expect(formatSender('noreply@itsandbox.site', '  ')).toBe('noreply@itsandbox.site');
    expect(formatSender('noreply@itsandbox.site')).toBe('noreply@itsandbox.site');
  });
});
