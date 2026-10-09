import type { SharedServiceCaller } from '@apicenter/runtime';
import { createOtpRepository } from '../../shared/otp-store';
import type { OtpRepositoryInterface } from '../../shared/otp-repository.interface';

export class GetOtpStatusService {
  constructor(private readonly store: OtpRepositoryInterface = createOtpRepository()) {}

  async execute(otpId: string, owner: SharedServiceCaller) {
    const record = await this.store.findById(otpId, owner);
    if (!record) return null;

    let status = record.status;
    if (status === 'pending' && Date.now() > record.expiresAt) {
      status = 'expired';
      await this.store.update(otpId, { status: 'expired' }, owner);
    }

    return {
      otpId: record.otpId,
      status,
      target: record.target,
      channel: record.channel,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };
  }
}
