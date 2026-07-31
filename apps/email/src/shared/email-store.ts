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
