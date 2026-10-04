import type { OtpVerifyRequest, OtpVerifyResponse } from '@apicenter/contracts';
import { createOtpRepository } from '../../shared/otp-store';
import type { OtpRepositoryInterface } from '../../shared/otp-repository.interface';
import { hashOtpCode } from '../../shared/otp-hash';

export class VerifyOtpService {
  constructor(private readonly store: OtpRepositoryInterface = createOtpRepository()) {}

  async execute(input: OtpVerifyRequest): Promise<OtpVerifyResponse & { verified: boolean; target?: string; channel?: string; reason?: string }> {
    const { otpId, code } = input;
    if (!otpId || !code) {
      return { verified: false, otpId: otpId || '', reason: 'INVALID_REQUEST' };
    }

    const record = await this.store.findById(otpId);
    if (!record) {
      return { verified: false, otpId, reason: 'OTP_NOT_FOUND' };
    }

    if (input.recipient && input.recipient.trim().toLowerCase() !== record.target) {
      return { verified: false, otpId, reason: 'OTP_INVALID' };
    }
    const outcome = await this.store.consume(otpId, hashOtpCode(otpId, String(code)));
    if (outcome !== 'VERIFIED') return { verified: false, otpId, reason: outcome };

    return {
      verified: true,
      otpId,
      target: record.target,
      channel: record.channel,
    };
  }
}
