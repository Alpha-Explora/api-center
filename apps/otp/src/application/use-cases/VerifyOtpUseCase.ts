import { OtpId } from '../../domain/value-objects/OtpId';
import { OtpRepository } from '../../domain/repositories/OtpRepository';

export interface VerifyOtpInput {
  otpId: string;
  code: string;
}

export interface VerifyOtpResult {
  verified: boolean;
  otpId: string;
  target?: string;
  channel?: 'sms' | 'email';
  reason?: string;
}

export class VerifyOtpUseCase {
  constructor(private readonly otpRepository: OtpRepository) {}

  async execute(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    if (!input.otpId || !input.code) {
      return { verified: false, otpId: input.otpId || '', reason: 'INVALID_REQUEST' };
    }

    const idVo = new OtpId(input.otpId);
    const otpEntity = await this.otpRepository.findById(idVo);

    if (!otpEntity) {
      return { verified: false, otpId: input.otpId, reason: 'OTP_NOT_FOUND' };
    }

    const verificationResult = otpEntity.verify(input.code);
    if (!verificationResult.valid) {
      if (otpEntity.isExpired()) {
        await this.otpRepository.update(otpEntity);
      }
      return {
        verified: false,
        otpId: input.otpId,
        reason: verificationResult.reason,
      };
    }

    await this.otpRepository.update(otpEntity);

    return {
      verified: true,
      otpId: input.otpId,
      target: otpEntity.getTarget().getValue(),
      channel: otpEntity.getTarget().getChannel(),
    };
  }
}
