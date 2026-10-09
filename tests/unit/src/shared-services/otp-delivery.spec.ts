import type { SharedServiceCaller } from '@apicenter/runtime';
import { GenerateOtpService } from '../../../../apps/otp/src/features/generate-otp/generate-otp.service';
import { VerifyOtpService } from '../../../../apps/otp/src/features/verify-otp/verify-otp.service';
import { MemoryOtpStore } from '../../../../apps/otp/src/shared/otp-store';

const owner: SharedServiceCaller = { tribeId: 'tribe-a', projectId: 'project-a', serviceId: 'service-a', environment: 'test' };
const sibling: SharedServiceCaller = { ...owner, serviceId: 'service-b' };
const otherProject: SharedServiceCaller = { tribeId: 'tribe-b', projectId: 'project-b', serviceId: 'service-a', environment: 'test' };

describe('OTP generation and consumption', () => {
  const originalMode = process.env.OTP_DELIVERY_MODE;
  beforeEach(() => { process.env.OTP_DELIVERY_MODE = 'mock'; });
  afterAll(() => {
    if (originalMode === undefined) delete process.env.OTP_DELIVERY_MODE;
    else process.env.OTP_DELIVERY_MODE = originalMode;
  });

  it('stores only a code hash and permits exactly one concurrent verification', async () => {
    const store = new MemoryOtpStore();
    const generated = await new GenerateOtpService(store).execute({
      channel: 'email', recipient: 'user@example.test', purpose: 'verification',
    }, owner);
    expect(generated.code).toMatch(/^\d{6}$/);
    const record = await store.findById(generated.otpId, owner);
    expect(record?.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.codeHash).not.toBe(generated.code);

    const verify = new VerifyOtpService(store);
    const input = { otpId: generated.otpId, code: generated.code!, recipient: 'user@example.test' };
    const [first, second] = await Promise.all([verify.execute(input, owner), verify.execute(input, owner)]);
    expect([first.verified, second.verified].sort()).toEqual([false, true]);
  });

  it('lets another service in the same project verify the challenge', async () => {
    const store = new MemoryOtpStore();
    const generated = await new GenerateOtpService(store).execute({
      channel: 'email', recipient: 'user@example.test', purpose: 'verification',
    }, owner);
    const input = { otpId: generated.otpId, code: generated.code!, recipient: 'user@example.test' };

    expect((await new VerifyOtpService(store).execute(input, sibling)).verified).toBe(true);
  });

  it('does not verify a challenge for a different project', async () => {
    const store = new MemoryOtpStore();
    const generated = await new GenerateOtpService(store).execute({
      channel: 'email', recipient: 'user@example.test', purpose: 'verification',
    }, owner);
    const input = { otpId: generated.otpId, code: generated.code!, recipient: 'user@example.test' };

    expect((await new VerifyOtpService(store).execute(input, otherProject)).reason).toBe('OTP_NOT_FOUND');
  });
});
