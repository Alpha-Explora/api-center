export class SmsRecipient {
  private readonly phone: string;

  constructor(rawPhone: string) {
    if (!rawPhone || typeof rawPhone !== 'string' || !rawPhone.trim()) {
      throw new Error('SMS Recipient phone must be a non-empty string.');
    }
    this.phone = rawPhone.trim();
  }

  getValue(): string {
    return this.phone;
  }
}

export class SmsMessagePayload {
  private readonly text: string;

  constructor(rawText: string) {
    if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
      throw new Error('SMS message body must be a non-empty string.');
    }
    this.text = rawText.trim();
  }

  getValue(): string {
    return this.text;
  }
}
