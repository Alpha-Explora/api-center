import type { OtpVerifyRequest, OtpVerifyResponse } from '@apicenter/contracts';
import { MemoryOtpStore } from '../../shared/otp-store';

export class VerifyOtpService {
  constructor(private readonly store = MemoryOtpStore.getInstance()) {}

  async execute(input: OtpVerifyRequest): Promise<OtpVerifyResponse & { verified: boolean; target?: string; channel?: string; reason?: string }> {
    const { otpId, code } = input;
    if (!otpId || !code) {
      return { verified: false, otpId: otpId || '', reason: 'INVALID_REQUEST' };
    }

    const record = await this.store.findById(otpId);
    if (!record) {
      return { verified: false, otpId, reason: 'OTP_NOT_FOUND' };
    }

    if (record.status === 'used') {
      return { verified: false, otpId, reason: 'OTP_ALREADY_USED' };
    }

    if (record.status === 'expired' || Date.now() > record.expiresAt) {
      if (record.status !== 'expired') {
        await this.store.update(otpId, { status: 'expired' });
      }
      return { verified: false, otpId, reason: 'OTP_EXPIRED' };
    }

    if (String(code) !== record.code) {
      return { verified: false, otpId, reason: 'OTP_INVALID' };
    }

    await this.store.update(otpId, { status: 'used' });

    return {
      verified: true,
      otpId,
      target: record.target,
      channel: record.channel,
    };
  }
}
