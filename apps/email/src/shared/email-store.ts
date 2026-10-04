export interface EmailRecord {
  messageId: string;
  provider: string;
  status: string;
  recipient: string[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  tags?: Record<string, string>;
}

export class MemoryEmailStore {
  private static instance: MemoryEmailStore;
  private readonly store = new Map<string, EmailRecord>();

  public static getInstance(): MemoryEmailStore {
    if (!MemoryEmailStore.instance) {
      MemoryEmailStore.instance = new MemoryEmailStore();
    }
    return MemoryEmailStore.instance;
  }

  async save(record: EmailRecord): Promise<EmailRecord> {
    this.store.set(record.messageId, record);
    return record;
  }

  async findById(messageId: string): Promise<EmailRecord | null> {
    return this.store.get(messageId) || null;
  }
}
import { RedisEmailStore } from './redis-email-store';


export function createEmailStore(): Pick<MemoryEmailStore, 'save' | 'findById'> {
  if (process.env.EMAIL_REDIS_URL || process.env.REDIS_URL) return new RedisEmailStore();
  if (process.env.NODE_ENV === 'production') throw new Error('Email Redis URL is required in production');
  return MemoryEmailStore.getInstance();
}
