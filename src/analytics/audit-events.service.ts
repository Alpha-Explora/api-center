import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { ConfigService } from "../config/config.service";
import { LoggerService } from "../shared/logger.service";

export interface AuditEventRecord {
  id: string;
  type: string;
  serviceId?: string;
  tribeServiceId?: string;
  sharedServiceId?: string;
  severity: "info" | "warning" | "error";
  message: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEventFilter {
  limit?: number;
  serviceId?: string;
  type?: string;
}

const AUDIT_KEY = "api-center:audit:events";
const MAX_EVENTS = 500;

@Injectable()
export class AuditEventsService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis | null = null;
  private readonly memoryEvents: AuditEventRecord[] = [];

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.redis = new Redis(this.config.redis.cacheUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
      });
      await this.redis.connect();
      this.logger.info("AuditEventsService connected to Redis", {});
    } catch (err) {
      this.redis = null;
      this.logger.warn(
        `AuditEventsService Redis unavailable; using in-memory events: ${(err as Error).message}`,
        "AuditEventsService",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  async record(
    event: Omit<AuditEventRecord, "id" | "timestamp"> & {
      timestamp?: string;
    },
  ): Promise<AuditEventRecord> {
    const record: AuditEventRecord = {
      ...event,
      id: randomUUID(),
      timestamp: event.timestamp ?? new Date().toISOString(),
    };

    this.memoryEvents.unshift(record);
    this.memoryEvents.splice(MAX_EVENTS);

    if (this.redis) {
      try {
        await this.redis
          .multi()
          .lpush(AUDIT_KEY, JSON.stringify(record))
          .ltrim(AUDIT_KEY, 0, MAX_EVENTS - 1)
          .exec();
      } catch (err) {
        this.logger.warn(
          `AuditEventsService Redis write failed; retained in-memory event only: ${(err as Error).message}`,
          "AuditEventsService",
        );
      }
    }

    return record;
  }

  async list(filter: AuditEventFilter = {}): Promise<AuditEventRecord[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, MAX_EVENTS));
    const events = this.redis
      ? await this.listRedisWithFallback(limit)
      : this.memoryEvents.slice(0, limit);

    return events
      .filter((event) => !filter.type || event.type === filter.type)
      .filter(
        (event) =>
          !filter.serviceId ||
          event.serviceId === filter.serviceId ||
          event.tribeServiceId === filter.serviceId ||
          event.sharedServiceId === filter.serviceId,
      )
      .slice(0, limit);
  }

  private async listRedisWithFallback(
    limit: number,
  ): Promise<AuditEventRecord[]> {
    try {
      const rawEvents = await this.redis!.lrange(AUDIT_KEY, 0, limit - 1);
      return rawEvents
        .map((raw) => {
          try {
            return JSON.parse(raw) as AuditEventRecord;
          } catch {
            return null;
          }
        })
        .filter((event): event is AuditEventRecord => Boolean(event));
    } catch (err) {
      this.logger.warn(
        `AuditEventsService Redis read failed; using in-memory events: ${(err as Error).message}`,
        "AuditEventsService",
      );
      return this.memoryEvents.slice(0, limit);
    }
  }
}
