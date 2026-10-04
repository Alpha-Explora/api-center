import { OtpRecord } from './otp-store';

export interface OtpRepositoryInterface {
  save(record: OtpRecord): Promise<OtpRecord>;
  findById(otpId: string): Promise<OtpRecord | null>;
  update(otpId: string, patch: Partial<OtpRecord>): Promise<OtpRecord | null>;
  consume(otpId: string, codeHash: string): Promise<string>;
}
