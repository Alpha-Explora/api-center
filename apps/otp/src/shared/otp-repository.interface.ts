import type { SharedServiceCaller } from '@apicenter/runtime';
import type { OtpRecord } from './otp-store';

/** Every method takes the caller that created the challenge, so verification never crosses owners. */
export interface OtpRepositoryInterface {
  save(record: OtpRecord, owner: SharedServiceCaller): Promise<OtpRecord>;
  findById(otpId: string, owner: SharedServiceCaller): Promise<OtpRecord | null>;
  update(otpId: string, patch: Partial<OtpRecord>, owner: SharedServiceCaller): Promise<OtpRecord | null>;
  consume(otpId: string, codeHash: string, owner: SharedServiceCaller): Promise<string>;
}
