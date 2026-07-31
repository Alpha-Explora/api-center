export interface OtpRecord {
  otpId: string;
  target: string;
  channel: 'sms' | 'email';
  code: string;
  expiresAt: number;
  status: 'pending' | 'used' | 'expired';
}

export class MemoryOtpStore {
  private static instance: MemoryOtpStore;
  private readonly store = new Map<string, OtpRecord>();

  public static getInstance(): MemoryOtpStore {
    if (!MemoryOtpStore.instance) {
      MemoryOtpStore.instance = new MemoryOtpStore();
    }
    return MemoryOtpStore.instance;
  }

  async save(record: OtpRecord): Promise<OtpRecord> {
    this.store.set(record.otpId, record);
    return record;
  }

  async findById(otpId: string): Promise<OtpRecord | null> {
    return this.store.get(otpId) || null;
  }

  async update(otpId: string, patch: Partial<OtpRecord>): Promise<OtpRecord | null> {
    const existing = this.store.get(otpId);
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this.store.set(otpId, updated);
    return updated;
  }
}
