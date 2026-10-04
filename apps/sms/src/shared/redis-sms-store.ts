import Redis from 'ioredis';
import type { SmsRepositoryInterface } from './sms-repository.interface';
import type { SmsRecord } from './sms-store';

/** Persists SMS delivery records in Redis for status lookups. */
export class RedisSmsStore implements SmsRepositoryInterface {
  private readonly redis: Redis;

  constructor(url = process.env.SMS_REDIS_URL || process.env.REDIS_URL) {
    if (!url) throw new Error('SMS Redis URL is required');
    this.redis = new Redis(url, { maxRetriesPerRequest: 1 });
  }

  async save(record: SmsRecord): Promise<SmsRecord> {
    await this.redis.set(`sms:message:${record.messageId}`, JSON.stringify(record), 'EX', 30 * 24 * 60 * 60);
    return record;
  }

  async findById(messageId: string): Promise<SmsRecord | null> {
    const value = await this.redis.get(`sms:message:${messageId}`);
    return value ? JSON.parse(value) as SmsRecord : null;
  }
}
