import { OtpCode } from '../../domain/entities/OtpCode';
import { OtpId } from '../../domain/value-objects/OtpId';
import { OtpRepository } from '../../domain/repositories/OtpRepository';

export class MemoryOtpRepository implements OtpRepository {
  private readonly store = new Map<string, OtpCode>();

  async save(otp: OtpCode): Promise<void> {
    this.store.set(otp.getId().getValue(), otp);
  }

  async findById(id: OtpId): Promise<OtpCode | null> {
    return this.store.get(id.getValue()) || null;
  }

  async update(otp: OtpCode): Promise<void> {
    this.store.set(otp.getId().getValue(), otp);
  }
}
