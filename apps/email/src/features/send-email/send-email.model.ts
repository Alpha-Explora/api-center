export class EmailRecipients {
  private readonly recipients: string[];

  constructor(to: unknown) {
    if (!to) {
      throw new Error('Recipient (to) is required');
    }
    const rawList = Array.isArray(to) ? to : [to];
    const extracted = rawList.map((r) => (typeof r === 'string' ? r.trim() : (r as { email: string })?.email?.trim()));
    if (extracted.length === 0 || extracted.some((r) => !r)) {
      throw new Error('Invalid email recipient provided');
    }
    this.recipients = extracted;
  }

  getRecipients(): string[] {
    return this.recipients;
  }
}

export class EmailSubject {
  private readonly subject: string;

  constructor(rawSubject: unknown) {
    if (!rawSubject || typeof rawSubject !== 'string' || !rawSubject.trim()) {
      throw new Error('Email subject is required');
    }
    this.subject = rawSubject.trim();
  }

  getValue(): string {
    return this.subject;
  }
}
