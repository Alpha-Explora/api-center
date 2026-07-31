import { OtpCode } from '../entities/OtpCode';
import { OtpId } from '../value-objects/OtpId';

export interface OtpRepository {
  save(otp: OtpCode): Promise<void>;
  findById(id: OtpId): Promise<OtpCode | null>;
  update(otp: OtpCode): Promise<void>;
}
