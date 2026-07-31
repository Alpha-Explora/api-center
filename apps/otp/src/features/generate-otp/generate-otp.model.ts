export class OtpTarget {
  private readonly target: string;
  private readonly channel: 'sms' | 'email';

  constructor(target: string, channel: 'sms' | 'email') {
    if (!target || typeof target !== 'string' || !target.trim()) {
      throw new Error('OTP target must be a non-empty string.');
    }
    if (channel !== 'sms' && channel !== 'email') {
      throw new Error('OTP channel must be "sms" or "email".');
    }
    this.target = target.trim().toLowerCase();
    this.channel = channel;
  }

  getTarget(): string {
    return this.target;
  }

  getChannel(): 'sms' | 'email' {
    return this.channel;
  }
}
