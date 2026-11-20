import type { SharedServiceCaller } from '@apicenter/runtime';
import {
  DEFAULT_OTP_MESSAGE_TEMPLATE,
  otpTemplateProblem,
  parseOtpSettingsInput,
  renderOtpMessage,
  resolveOtpPolicy,
} from '../../../../apps/otp/src/shared/project-settings';
import { createOtpSettingsAdminHandler } from '../../../../apps/otp/src/shared/project-settings-admin';
import { MemoryOtpStore } from '../../../../apps/otp/src/shared/otp-store';
import { GenerateOtpService } from '../../../../apps/otp/src/features/generate-otp/generate-otp.service';
import { VerifyOtpService } from '../../../../apps/otp/src/features/verify-otp/verify-otp.service';

const owner: SharedServiceCaller = { tribeId: 'org-a', projectId: 'prj_a', serviceId: 'app-a', environment: 'test', model: 'application' };

describe('OTP settings parsing', () => {
  it('treats omitted fields as cleared and rejects values out of bounds', () => {
    expect(parseOtpSettingsInput({ codeLength: 8 })).toEqual({
      ok: true, value: { codeLength: 8, expirySeconds: null, maxAttempts: null, messageTemplate: null },
    });
    expect(parseOtpSettingsInput({ codeLength: 3 }).ok).toBe(false);
    expect(parseOtpSettingsInput({ expirySeconds: 3601 }).ok).toBe(false);
    expect(parseOtpSettingsInput({ maxAttempts: 1.5 }).ok).toBe(false);
    expect(parseOtpSettingsInput({ digits: 6 }).ok).toBe(false);
    expect(parseOtpSettingsInput([]).ok).toBe(false);
  });

  it('requires {{code}} and allows only known placeholders in the template', () => {
    expect(otpTemplateProblem('Your Serbizio code is {{code}}; it expires in {{ minutes }} minutes.')).toBeNull();
    expect(otpTemplateProblem('No code here')).toMatch(/\{\{code\}\}/);
    expect(otpTemplateProblem('{{code}} for {{name}}')).toMatch(/\{\{name\}\}/);
    expect(otpTemplateProblem('x'.repeat(301) + '{{code}}')).toMatch(/300/);
    expect(otpTemplateProblem('{{code}}\u0007')).toMatch(/control/);
  });

  it('keeps the template to one line of text: no newlines, links, addresses or phone numbers', () => {
    expect(otpTemplateProblem('Your Acme code is {{code}}.\nCall us')).toMatch(/one line/);
    // A newline inside the braces passes no placeholder check, so the table never sees it either.
    expect(otpTemplateProblem('Code {{\ncode}}')).not.toBeNull();
    expect(otpTemplateProblem('Code {{ code }}')).toBeNull();
    for (const template of [
      'Your code {{code}} https://evil.example/x',
      'Your code {{code}} at www.evil',
      'Your code {{code}}, confirm at evil.co',
      'Code {{code}} - reply to help@acme.io',
      'Code {{code}} bit.ly/abc',
    ]) {
      expect(otpTemplateProblem(template)).toMatch(/links/);
    }
    for (const template of ['Code {{code}}. Call +63 917 123 4567', 'Code {{code}}, call 555-1234567', 'Code {{code}} (02) 8123 4567']) {
      expect(otpTemplateProblem(template)).toMatch(/phone/);
    }
    expect(otpTemplateProblem('Your Acme code is {{code}}. It expires in {{minutes}} min, e.g. at 10:30.')).toBeNull();
    expect(otpTemplateProblem('{{code}} is your code. Valid 5 minutes, 3 tries.')).toBeNull();
  });
});

describe('OTP policy', () => {
  it('prefers request values, then project settings, then platform defaults', () => {
    expect(resolveOtpPolicy({}, null)).toEqual({ digits: 6, ttlSeconds: 300, maxAttempts: null, template: DEFAULT_OTP_MESSAGE_TEMPLATE });
    const settings = { codeLength: 8, expirySeconds: 600, maxAttempts: 3, messageTemplate: 'Code {{code}}' };
    expect(resolveOtpPolicy({}, settings)).toEqual({ digits: 8, ttlSeconds: 600, maxAttempts: 3, template: 'Code {{code}}' });
    expect(resolveOtpPolicy({ digits: 4, ttlSeconds: 120 }, settings)).toMatchObject({ digits: 4, ttlSeconds: 120, maxAttempts: 3 });
    expect(resolveOtpPolicy({ digits: 50, ttlSeconds: 5 }, null)).toMatchObject({ digits: 10, ttlSeconds: 60 });
  });

  it('renders the code and the expiry in minutes', () => {
    expect(renderOtpMessage('Code {{code}}, valid {{minutes}} min', '123456', 600)).toBe('Code 123456, valid 10 min');
  });
});

describe('OTP settings in the runtime', () => {
  const originalMode = process.env.OTP_DELIVERY_MODE;
  beforeEach(() => { process.env.OTP_DELIVERY_MODE = 'mock'; });
  afterAll(() => {
    if (originalMode === undefined) delete process.env.OTP_DELIVERY_MODE;
    else process.env.OTP_DELIVERY_MODE = originalMode;
  });

  it('generates codes with the project length and expires a challenge after the attempt cap', async () => {
    const store = new MemoryOtpStore();
    await store.setProjectSettings({ ...owner, environment: 'test', codeLength: 8, expirySeconds: null, maxAttempts: 2, messageTemplate: null });
    const generated = await new GenerateOtpService(store).execute({ channel: 'email', recipient: 'user@example.test' }, owner);
    expect(generated.code).toMatch(/^\d{8}$/);

    const verify = new VerifyOtpService(store);
    const wrong = generated.code === '00000000' ? '00000001' : '00000000';
    expect((await verify.execute({ otpId: generated.otpId, code: wrong }, owner)).reason).toBe('OTP_INVALID');
    expect((await verify.execute({ otpId: generated.otpId, code: wrong }, owner)).reason).toBe('OTP_INVALID');
    expect((await verify.execute({ otpId: generated.otpId, code: generated.code! }, owner)).reason).toBe('OTP_ATTEMPTS_EXCEEDED');
  });

  it('rejects a template the runtime would refuse with 400 before it reaches the table', async () => {
    const store = new MemoryOtpStore();
    const handler = createOtpSettingsAdminHandler({ store, expectedToken: 'otp-token' });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    await handler({
      method: 'PUT', body: { messageTemplate: 'Code {{\ncode}}' }, params: { projectId: 'prj_a', environment: 'test' },
      header: (name: string) => (name === 'X-APICenter-Otp-Admin-Token' ? 'otp-token' : undefined),
    } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(await store.getProjectSettings('prj_a', 'test')).toBeNull();
  });

  it('serves GET, PUT and DELETE behind the admin token', async () => {
    const store = new MemoryOtpStore();
    const handler = createOtpSettingsAdminHandler({ store, expectedToken: 'otp-token' });
    const call = async (method: string, body?: unknown, token = 'otp-token') => {
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
      await handler({
        method, body, params: { projectId: 'prj_a', environment: 'live' },
        header: (name: string) => (name === 'X-APICenter-Otp-Admin-Token' ? token : undefined),
      } as any, res);
      return res;
    };

    expect((await call('GET', undefined, 'nope')).status).toHaveBeenCalledWith(401);
    expect((await call('PUT', { codeLength: 2 })).status).toHaveBeenCalledWith(400);
    const saved = await call('PUT', { maxAttempts: 5, messageTemplate: 'Code {{code}}' });
    expect(saved.json).toHaveBeenCalledWith(expect.objectContaining({ configured: true, maxAttempts: 5, codeLength: null }));
    expect(await store.getProjectSettings('prj_a', 'live')).toMatchObject({ maxAttempts: 5, messageTemplate: 'Code {{code}}' });
    const cleared = await call('DELETE');
    expect(cleared.json).toHaveBeenCalledWith(expect.objectContaining({ configured: false, maxAttempts: null, messageTemplate: null }));
  });
});
