import { GenerateOtpService } from '../../../../apps/otp/src/features/generate-otp/generate-otp.service';
import { VerifyOtpService } from '../../../../apps/otp/src/features/verify-otp/verify-otp.service';
import { MemoryOtpStore } from '../../../../apps/otp/src/shared/otp-store';

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
    });
    expect(generated.code).toMatch(/^\d{6}$/);
    const record = await store.findById(generated.otpId);
    expect(record?.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record?.codeHash).not.toBe(generated.code);

    const verify = new VerifyOtpService(store);
    const [first, second] = await Promise.all([
      verify.execute({ otpId: generated.otpId, code: generated.code!, recipient: 'user@example.test' }),
      verify.execute({ otpId: generated.otpId, code: generated.code!, recipient: 'user@example.test' }),
    ]);
    expect([first.verified, second.verified].sort()).toEqual([false, true]);
  });
});
