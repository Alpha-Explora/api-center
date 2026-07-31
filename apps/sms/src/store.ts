export interface SmsMessageRecord {
  messageId: string;
  to: string;
  message: string;
  status: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface SmsStore {
  createMessage(entry: SmsMessageRecord): Promise<SmsMessageRecord>;
  getMessage(messageId: string): Promise<SmsMessageRecord | null>;
  updateMessage(messageId: string, patch: Partial<SmsMessageRecord>): Promise<SmsMessageRecord | null>;
}

export function createSmsStore(): SmsStore {
  return createMemorySmsStore();
}

export function createMemorySmsStore(): SmsStore {
  const entries = new Map<string, SmsMessageRecord>();

  return {
    async createMessage(entry) {
      entries.set(entry.messageId, entry);
      return entry;
    },

    async getMessage(messageId) {
      return entries.get(messageId) || null;
    },

    async updateMessage(messageId, patch) {
      const current = entries.get(messageId);
      if (!current) {
        return null;
      }

      const updated = { ...current, ...patch };
      entries.set(messageId, updated);
      return updated;
    },
  };
}
