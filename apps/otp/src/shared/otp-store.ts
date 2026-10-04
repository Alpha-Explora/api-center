import { OtpRepositoryInterface } from './otp-repository.interface';
import { PostgresOtpStore } from './postgres-otp-store';
import { RedisOtpStore } from './redis-otp-store';

export interface OtpRecord {
  otpId: string;
  target: string;
  channel: 'sms' | 'email';
  codeHash: string;
  expiresAt: number;
  status: 'pending' | 'used' | 'expired';
}

export class MemoryOtpStore implements OtpRepositoryInterface {
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

  async consume(otpId: string, codeHash: string): Promise<string> {
    const record = this.store.get(otpId);
    if (!record) return 'OTP_NOT_FOUND';
    if (record.status === 'used') return 'OTP_ALREADY_USED';
    if (record.status === 'expired' || Date.now() > record.expiresAt) {
      record.status = 'expired';
      return 'OTP_EXPIRED';
    }
    if (record.codeHash !== codeHash) return 'OTP_INVALID';
    record.status = 'used';
    return 'VERIFIED';
  }
}

export function createOtpRepository(): OtpRepositoryInterface {
  const mode = process.env.OTP_STORE_MODE || (process.env.DATABASE_URL ? 'postgres' : 'memory');
  if (mode === 'postgres') {
    return new PostgresOtpStore();
  }
  if (mode === 'redis') return new RedisOtpStore();
  if (mode !== 'memory' || process.env.NODE_ENV === 'production') {
    throw new Error('A shared OTP store is required in production');
  }
  return MemoryOtpStore.getInstance();
}
