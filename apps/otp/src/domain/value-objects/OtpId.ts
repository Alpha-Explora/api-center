import crypto from 'node:crypto';

export class OtpId {
  private readonly value: string;

  constructor(id?: string) {
    this.value = id || `otp_${crypto.randomUUID().replace(/-/g, '')}`;
  }

  getValue(): string {
    return this.value;
  }

  equals(other: OtpId): boolean {
    return this.value === other.value;
  }
}
