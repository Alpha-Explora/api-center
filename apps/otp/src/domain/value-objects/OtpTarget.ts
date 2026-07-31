export class OtpTarget {
  private readonly value: string;
  private readonly channel: 'sms' | 'email';

  constructor(target: string, channel: 'sms' | 'email') {
    if (!target || typeof target !== 'string' || !target.trim()) {
      throw new Error('OtpTarget must be a non-empty string.');
    }
    if (channel !== 'sms' && channel !== 'email') {
      throw new Error('OtpTarget channel must be "sms" or "email".');
    }
    this.value = target.trim().toLowerCase();
    this.channel = channel;
  }

  getValue(): string {
    return this.value;
  }

  getChannel(): 'sms' | 'email' {
    return this.channel;
  }

  equals(other: OtpTarget): boolean {
    return this.value === other.value && this.channel === other.channel;
  }
}
