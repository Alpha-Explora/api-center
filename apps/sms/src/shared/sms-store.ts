import { SmsRepositoryInterface } from './sms-repository.interface';
import { PostgresSmsStore } from './postgres-sms-store';

export interface SmsRecord {
  messageId: string;
  to: string;
  message: string;
  status: string;
  senderId?: string;
  createdAt: string;
}

export class MemorySmsStore implements SmsRepositoryInterface {
  private static instance: MemorySmsStore;
  private readonly store = new Map<string, SmsRecord>();

  public static getInstance(): MemorySmsStore {
    if (!MemorySmsStore.instance) {
      MemorySmsStore.instance = new MemorySmsStore();
    }
    return MemorySmsStore.instance;
  }

  async save(record: SmsRecord): Promise<SmsRecord> {
    this.store.set(record.messageId, record);
    return record;
  }

  async findById(messageId: string): Promise<SmsRecord | null> {
    return this.store.get(messageId) || null;
  }
}

export function createSmsRepository(): SmsRepositoryInterface {
  const mode = process.env.SMS_STORE_MODE || (process.env.DATABASE_URL ? 'postgres' : 'memory');
  if (mode === 'postgres') {
    return new PostgresSmsStore();
  }
  return MemorySmsStore.getInstance();
}
