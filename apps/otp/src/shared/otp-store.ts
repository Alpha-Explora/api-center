import type { SharedServiceCaller } from '@apicenter/runtime';
import { sameProject } from '@apicenter/runtime';
import type { OtpRepositoryInterface } from './otp-repository.interface';
import { PostgresOtpStore } from './postgres-otp-store';

export interface OtpRecord {
  otpId: string;
  target: string;
  channel: 'sms' | 'email';
  codeHash: string;
  expiresAt: number;
  status: 'pending' | 'used' | 'expired';
  attemptCount: number;
}

interface OwnedOtpRecord {
  record: OtpRecord;
  owner: SharedServiceCaller;
}

export class MemoryOtpStore implements OtpRepositoryInterface {
  private static instance: MemoryOtpStore;
  private readonly store = new Map<string, OwnedOtpRecord>();

  public static getInstance(): MemoryOtpStore {
    if (!MemoryOtpStore.instance) {
      MemoryOtpStore.instance = new MemoryOtpStore();
    }
    return MemoryOtpStore.instance;
  }

  async save(record: OtpRecord, owner: SharedServiceCaller): Promise<OtpRecord> {
    const existing = this.store.get(record.otpId);
    if (existing && !sameProject(existing.owner, owner)) {
      throw new Error('OTP challenge id belongs to another project');
    }
    this.store.set(record.otpId, { record: { ...record }, owner: { ...(existing?.owner ?? owner) } });
    return record;
  }

  async findById(otpId: string, owner: SharedServiceCaller): Promise<OtpRecord | null> {
    const entry = this.ownedEntry(otpId, owner);
    return entry ? { ...entry.record } : null;
  }

  async update(otpId: string, patch: Partial<OtpRecord>, owner: SharedServiceCaller): Promise<OtpRecord | null> {
    const entry = this.ownedEntry(otpId, owner);
    if (!entry) return null;
    entry.record = { ...entry.record, ...patch };
    return { ...entry.record };
  }

  /** Counts every attempt against a pending challenge, then marks it used only when the code matches. */
  async consume(otpId: string, codeHash: string, owner: SharedServiceCaller): Promise<string> {
    const entry = this.ownedEntry(otpId, owner);
    if (!entry) return 'OTP_NOT_FOUND';
    const record = entry.record;
    if (record.status === 'used') return 'OTP_ALREADY_USED';
    if (record.status === 'expired' || Date.now() > record.expiresAt) return 'OTP_EXPIRED';
    record.attemptCount += 1;
    if (record.codeHash !== codeHash) return 'OTP_INVALID';
    record.status = 'used';
    return 'VERIFIED';
  }

  private ownedEntry(otpId: string, owner: SharedServiceCaller): OwnedOtpRecord | undefined {
    const entry = this.store.get(otpId);
    return entry && sameProject(entry.owner, owner) ? entry : undefined;
  }
}

/** Uses Postgres when DATABASE_URL is set. Production refuses to start without it. */
export function createOtpRepository(): OtpRepositoryInterface {
  if (process.env.DATABASE_URL) return new PostgresOtpStore();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for the OTP record store in production');
  }
  return MemoryOtpStore.getInstance();
}
