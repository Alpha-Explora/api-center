import type { SharedServiceCaller } from '@apicenter/runtime';
import { sameSharedServiceCaller } from '@apicenter/runtime';
import { PostgresSmsStore } from './postgres-sms-store';
import type { SmsRepositoryInterface } from './sms-repository.interface';

export interface SmsRecord {
  messageId: string;
  to: string;
  message: string;
  status: string;
  senderId?: string;
  createdAt: string;
}

interface OwnedSmsRecord {
  record: SmsRecord;
  owner: SharedServiceCaller;
}

export class MemorySmsStore implements SmsRepositoryInterface {
  private static instance: MemorySmsStore;
  private readonly store = new Map<string, OwnedSmsRecord>();

  public static getInstance(): MemorySmsStore {
    if (!MemorySmsStore.instance) {
      MemorySmsStore.instance = new MemorySmsStore();
    }
    return MemorySmsStore.instance;
  }

  async save(record: SmsRecord, owner: SharedServiceCaller): Promise<SmsRecord> {
    const existing = this.store.get(record.messageId);
    if (existing && !sameSharedServiceCaller(existing.owner, owner)) {
      throw new Error('SMS message id belongs to another owner');
    }
    this.store.set(record.messageId, { record: { ...record }, owner: { ...owner } });
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<SmsRecord | null> {
    const entry = this.store.get(messageId);
    if (!entry || !sameSharedServiceCaller(entry.owner, owner)) return null;
    return { ...entry.record };
  }
}

/** Uses Postgres when DATABASE_URL is set. Production refuses to start without it. */
export function createSmsRepository(): SmsRepositoryInterface {
  if (process.env.DATABASE_URL) return new PostgresSmsStore();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for the SMS record store in production');
  }
  return MemorySmsStore.getInstance();
}
