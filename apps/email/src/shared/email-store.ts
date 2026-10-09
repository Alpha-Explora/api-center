import type { SharedServiceCaller } from '@apicenter/runtime';
import { sameSharedServiceCaller } from '@apicenter/runtime';
import type { EmailRepositoryInterface } from './email-repository.interface';
import { PostgresEmailStore } from './postgres-email-store';

export interface EmailRecord {
  messageId: string;
  provider: string;
  status: string;
  recipient: string[];
  recipientCount: number;
  sentAt: string;
  createdAt: string;
}

interface OwnedEmailRecord {
  record: EmailRecord;
  owner: SharedServiceCaller;
}

export class MemoryEmailStore implements EmailRepositoryInterface {
  private static instance: MemoryEmailStore;
  private readonly store = new Map<string, OwnedEmailRecord>();

  public static getInstance(): MemoryEmailStore {
    if (!MemoryEmailStore.instance) {
      MemoryEmailStore.instance = new MemoryEmailStore();
    }
    return MemoryEmailStore.instance;
  }

  async save(record: EmailRecord, owner: SharedServiceCaller): Promise<EmailRecord> {
    const existing = this.store.get(record.messageId);
    if (existing && !sameSharedServiceCaller(existing.owner, owner)) {
      throw new Error('Email message id belongs to another owner');
    }
    this.store.set(record.messageId, { record: { ...record }, owner: { ...owner } });
    return record;
  }

  async findById(messageId: string, owner: SharedServiceCaller): Promise<EmailRecord | null> {
    const entry = this.store.get(messageId);
    if (!entry || !sameSharedServiceCaller(entry.owner, owner)) return null;
    return { ...entry.record };
  }
}

/** Uses Postgres when DATABASE_URL is set. Production refuses to start without it. */
export function createEmailStore(): EmailRepositoryInterface {
  if (process.env.DATABASE_URL) return new PostgresEmailStore();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for the email record store in production');
  }
  return MemoryEmailStore.getInstance();
}
