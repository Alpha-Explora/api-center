import { OtpId } from '../../domain/value-objects/OtpId';
import { OtpRepository } from '../../domain/repositories/OtpRepository';

export interface GetOtpStatusResult {
  otpId: string;
  status: string;
  target: string;
  channel: 'sms' | 'email';
  expiresAt: string;
}

export class GetOtpStatusUseCase {
  constructor(private readonly otpRepository: OtpRepository) {}

  async execute(otpIdStr: string): Promise<GetOtpStatusResult | null> {
    const idVo = new OtpId(otpIdStr);
    const otpEntity = await this.otpRepository.findById(idVo);

    if (!otpEntity) {
      return null;
    }

    const currentStatus = otpEntity.getStatus();
    await this.otpRepository.update(otpEntity);

    return {
      otpId: otpEntity.getId().getValue(),
      status: currentStatus,
      target: otpEntity.getTarget().getValue(),
      channel: otpEntity.getTarget().getChannel(),
      expiresAt: new Date(otpEntity.getExpiresAt()).toISOString(),
    };
  }
}
