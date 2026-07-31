import { OtpId } from '../value-objects/OtpId';
import { OtpTarget } from '../value-objects/OtpTarget';

export type OtpStatus = 'pending' | 'used' | 'expired';

export interface OtpCodeProps {
  id: OtpId;
  target: OtpTarget;
  code: string;
  expiresAt: number;
  status: OtpStatus;
}

export class OtpCode {
  private readonly id: OtpId;
  private readonly target: OtpTarget;
  private readonly code: string;
  private readonly expiresAt: number;
  private status: OtpStatus;

  constructor(props: OtpCodeProps) {
    this.id = props.id;
    this.target = props.target;
    this.code = props.code;
    this.expiresAt = props.expiresAt;
    this.status = props.status;
  }

  getId(): OtpId {
    return this.id;
  }

  getTarget(): OtpTarget {
    return this.target;
  }

  getCode(): string {
    return this.code;
  }

  getExpiresAt(): number {
    return this.expiresAt;
  }

  getStatus(): OtpStatus {
    if (this.status === 'pending' && Date.now() > this.expiresAt) {
      this.status = 'expired';
    }
    return this.status;
  }

  isExpired(): boolean {
    return this.getStatus() === 'expired';
  }

  isUsed(): boolean {
    return this.status === 'used';
  }

  verify(candidateCode: string): { valid: boolean; reason?: string } {
    if (this.isUsed()) {
      return { valid: false, reason: 'OTP_ALREADY_USED' };
    }

    if (this.isExpired()) {
      return { valid: false, reason: 'OTP_EXPIRED' };
    }

    if (this.code !== String(candidateCode).trim()) {
      return { valid: false, reason: 'OTP_INVALID' };
    }

    this.status = 'used';
    return { valid: true };
  }

  markExpired(): void {
    this.status = 'expired';
  }
}
