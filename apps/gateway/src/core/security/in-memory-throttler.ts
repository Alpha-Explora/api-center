import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';

export interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class InMemoryThrottlerStorage implements ThrottlerStorage {
  private readonly memoryStore = new Map<string, { hits: number; expiresAt: number; blockedUntil: number }>();

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName?: string,
  ): Promise<ThrottlerStorageRecord> {
    const now = Date.now();
    const existing = this.memoryStore.get(key);

    if (existing && existing.expiresAt <= now) {
      this.memoryStore.delete(key);
    }

    if (existing && existing.blockedUntil > now) {
      return {
        totalHits: limit + 1,
        timeToExpire: existing.blockedUntil - now,
        isBlocked: true,
        timeToBlockExpire: existing.blockedUntil - now,
      };
    }

    const entry = this.memoryStore.get(key) || {
      hits: 0,
      expiresAt: now + ttl,
      blockedUntil: 0,
    };
    entry.hits++;

    if (entry.hits > limit && blockDuration > 0) {
      entry.blockedUntil = now + blockDuration;
      this.memoryStore.set(key, entry);
      return {
        totalHits: entry.hits,
        timeToExpire: entry.expiresAt - now,
        isBlocked: true,
        timeToBlockExpire: blockDuration,
      };
    }

    this.memoryStore.set(key, entry);
    return {
      totalHits: entry.hits,
      timeToExpire: entry.expiresAt - now,
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }
}
