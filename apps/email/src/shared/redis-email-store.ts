import Redis from 'ioredis';
import type { EmailRecord } from './email-store';

/** Persists email delivery records in Redis for status lookups. */
export class RedisEmailStore {
  private readonly redis: Redis;

  constructor(url = process.env.EMAIL_REDIS_URL || process.env.REDIS_URL) {
    if (!url) throw new Error('Email Redis URL is required');
    this.redis = new Redis(url, { maxRetriesPerRequest: 1 });
  }

  async save(record: EmailRecord): Promise<EmailRecord> {
    await this.redis.set(`email:message:${record.messageId}`, JSON.stringify(record), 'EX', 30 * 24 * 60 * 60);
    return record;
  }

  async findById(messageId: string): Promise<EmailRecord | null> {
    const value = await this.redis.get(`email:message:${messageId}`);
    return value ? JSON.parse(value) as EmailRecord : null;
  }
}
