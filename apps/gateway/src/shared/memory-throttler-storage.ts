// =============================================================================
// src/shared/memory-throttler-storage.ts — In-Memory ThrottlerStorage
// =============================================================================
// Implements the @nestjs/throttler ThrottlerStorage interface using an in-memory Map.
// Counters are per instance: with N instances a client can reach N times the limit.
// =============================================================================

import { Injectable, OnModuleInit } from "@nestjs/common";
import { ThrottlerStorage } from "@nestjs/throttler";
import { LoggerService } from "./logger.service";

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

@Injectable()
export class MemoryThrottlerStorage
  implements ThrottlerStorage, OnModuleInit
{
  private readonly memoryStore = new Map<
    string,
    { hits: number; expiresAt: number; blockedUntil: number }
  >();

  constructor(
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit() {
    this.logger.log(
      "Throttler initialized (in-memory rate-limiting)",
      "MemoryThrottlerStorage",
    );
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    return this.memoryIncrement(key, ttl, limit, blockDuration);
  }

  private memoryIncrement(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
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
