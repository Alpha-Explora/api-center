import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { ConfigService } from "@config/config.service";
import { LoggerService } from "@shared/logger.service";
import type { ServiceCallObservation } from "./service-call-observation";
import {
  ManagementSourceMetadata,
  redisWindowSourceMetadata,
} from "@shared/source-metadata";

export type SharedServiceUsageWindow = "1h" | "24h" | "7d" | "30d";

export interface SharedServiceUsageEvent {
  tribeServiceId: string;
  sharedServiceId: string;
  environment?: string;
  route: string;
  method: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  timestamp: Date;
  observation?: ServiceCallObservation;
}

export interface SharedServiceUsageRecord {
  tribeServiceId: string;
  sharedServiceId: string;
  environment: string;
  window: SharedServiceUsageWindow;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  errorRate: number;
  avgLatencyMs: number;
  lastUsedAt?: string;
}

export interface SharedServiceUsageListResult {
  data: SharedServiceUsageRecord[];
  sourceMetadata: ManagementSourceMetadata;
}

type UsageBucket = {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  latencyMsTotal: number;
  lastUsedAt?: string;
};

const BUCKET_PREFIX = "api-center:usage:shared";
const INDEX_PREFIX = "api-center:usage:shared:index";
const RETENTION_SECONDS = 45 * 24 * 60 * 60;
const WINDOW_HOURS: Record<SharedServiceUsageWindow, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

@Injectable()
export class SharedServiceUsageService
  implements OnModuleInit, OnModuleDestroy
{
  private redis: Redis | null = null;

  private readonly memoryBuckets = new Map<string, UsageBucket>();

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
      this.logger.info("SharedServiceUsageService connected to Redis", {});
    } catch (err) {
      this.redis = null;
      this.logger.warn(
        `SharedServiceUsageService Redis unavailable; using in-memory counters: ${(err as Error).message}`,
        "SharedServiceUsageService",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  async record(event: SharedServiceUsageEvent): Promise<void> {
    const hourStart = this.toHourStart(event.timestamp);
    const environment = this.resolveEnvironment(event);
    const pair = this.encodePair(
      environment,
      event.tribeServiceId,
      event.sharedServiceId,
    );
    const key = this.bucketKey(
      hourStart,
      environment,
      event.tribeServiceId,
      event.sharedServiceId,
    );
    const lastUsedAt = event.timestamp.toISOString();

    this.recordInMemory(key, event, lastUsedAt);

    if (!this.redis) {
      return;
    }

    const indexKey = this.indexKey(hourStart);
    const pipeline = this.redis.pipeline();
    pipeline.hincrby(key, "totalRequests", 1);
    pipeline.hincrby(key, event.ok ? "successRequests" : "failedRequests", 1);
    pipeline.hincrby(key, "latencyMsTotal", Math.max(0, event.latencyMs));
    pipeline.hset(key, "lastUsedAt", lastUsedAt);
    pipeline.sadd(indexKey, pair);
    pipeline.expire(key, RETENTION_SECONDS);
    pipeline.expire(indexKey, RETENTION_SECONDS);
    try {
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        `SharedServiceUsageService Redis write failed; retained in-memory counter only: ${(err as Error).message}`,
        "SharedServiceUsageService",
      );
    }
  }

  async listUsage(
    window: SharedServiceUsageWindow = "24h",
    now = new Date(),
  ): Promise<SharedServiceUsageRecord[]> {
    return (await this.listUsageWithSourceMetadata(window, now)).data;
  }

  async listUsageWithSourceMetadata(
    window: SharedServiceUsageWindow = "24h",
    now = new Date(),
  ): Promise<SharedServiceUsageListResult> {
    const hours = this.getHourStarts(window, now);
    const { buckets, sourceName, degradedReason } =
      await this.readBucketsWithSource(hours);

    const records = [...buckets.entries()].map(([pair, bucket]) => {
      const [environment, tribeServiceId, sharedServiceId] =
        this.decodePair(pair);
      const totalRequests = bucket.totalRequests;
      const failedRequests = bucket.failedRequests;
      const avgLatencyMs =
        totalRequests > 0
          ? Math.round(bucket.latencyMsTotal / totalRequests)
          : 0;

      return {
        tribeServiceId,
        sharedServiceId,
        environment,
        window,
        totalRequests,
        successRequests: bucket.successRequests,
        failedRequests,
        errorRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
        avgLatencyMs,
        lastUsedAt: bucket.lastUsedAt,
      };
    });

    return {
      data: records.sort((a, b) => {
        if (b.totalRequests !== a.totalRequests) {
          return b.totalRequests - a.totalRequests;
        }
        return `${a.environment}:${a.tribeServiceId}:${a.sharedServiceId}`.localeCompare(
          `${b.environment}:${b.tribeServiceId}:${b.sharedServiceId}`,
        );
      }),
      sourceMetadata: redisWindowSourceMetadata({
        sourceName,
        window,
        now,
        degradedReason,
      }),
    };
  }

  private recordInMemory(
    key: string,
    event: SharedServiceUsageEvent,
    lastUsedAt: string,
  ): void {
    const bucket = this.memoryBuckets.get(key) ?? {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      latencyMsTotal: 0,
    };

    bucket.totalRequests += 1;
    if (event.ok) {
      bucket.successRequests += 1;
    } else {
      bucket.failedRequests += 1;
    }
    bucket.latencyMsTotal += Math.max(0, event.latencyMs);
    bucket.lastUsedAt = lastUsedAt;

    this.memoryBuckets.set(key, bucket);
  }

  private async readBucketsWithSource(hours: Date[]): Promise<{
    buckets: Map<string, UsageBucket>;
    sourceName: string;
    degradedReason?: string;
  }> {
    if (!this.redis) {
      return {
        buckets: this.readMemoryBuckets(hours),
        sourceName: "shared-service-usage-memory-window",
        degradedReason: "Redis unavailable; using in-memory usage counters.",
      };
    }

    try {
      return {
        buckets: await this.readRedisBuckets(hours),
        sourceName: "shared-service-usage-redis-window",
      };
    } catch (err) {
      const degradedReason = `Redis read failed; using in-memory usage counters: ${(err as Error).message}`;
      this.logger.warn(degradedReason, "SharedServiceUsageService");
      return {
        buckets: this.readMemoryBuckets(hours),
        sourceName: "shared-service-usage-memory-window",
        degradedReason,
      };
    }
  }

  private async readRedisBuckets(
    hours: Date[],
  ): Promise<Map<string, UsageBucket>> {
    const aggregate = new Map<string, UsageBucket>();

    for (const hour of hours) {
      const members = await this.redis!.smembers(this.indexKey(hour));
      for (const pair of members) {
        const [environment, tribeServiceId, sharedServiceId] =
          this.decodePair(pair);
        const raw = await this.redis!.hgetall(
          this.bucketKey(hour, environment, tribeServiceId, sharedServiceId),
        );
        this.mergeBucket(aggregate, pair, this.parseBucket(raw));
      }
    }

    return aggregate;
  }

  private readMemoryBuckets(hours: Date[]): Map<string, UsageBucket> {
    const aggregate = new Map<string, UsageBucket>();
    const hourPrefixes = new Set(
      hours.map((hour) => `${BUCKET_PREFIX}:${hour.toISOString()}:`),
    );

    for (const [key, bucket] of this.memoryBuckets.entries()) {
      const prefix = [...hourPrefixes].find((candidate) =>
        key.startsWith(candidate),
      );
      if (!prefix) continue;

      const pair = key.slice(prefix.length);
      this.mergeBucket(aggregate, pair, bucket);
    }

    return aggregate;
  }

  private mergeBucket(
    aggregate: Map<string, UsageBucket>,
    pair: string,
    bucket: UsageBucket,
  ): void {
    if (bucket.totalRequests === 0) return;

    const current = aggregate.get(pair) ?? {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      latencyMsTotal: 0,
    };

    current.totalRequests += bucket.totalRequests;
    current.successRequests += bucket.successRequests;
    current.failedRequests += bucket.failedRequests;
    current.latencyMsTotal += bucket.latencyMsTotal;
    if (
      bucket.lastUsedAt &&
      (!current.lastUsedAt || bucket.lastUsedAt > current.lastUsedAt)
    ) {
      current.lastUsedAt = bucket.lastUsedAt;
    }

    aggregate.set(pair, current);
  }

  private parseBucket(raw: Record<string, string>): UsageBucket {
    return {
      totalRequests: this.parseCount(raw.totalRequests),
      successRequests: this.parseCount(raw.successRequests),
      failedRequests: this.parseCount(raw.failedRequests),
      latencyMsTotal: this.parseCount(raw.latencyMsTotal),
      lastUsedAt: raw.lastUsedAt,
    };
  }

  private parseCount(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getHourStarts(window: SharedServiceUsageWindow, now: Date): Date[] {
    const currentHour = this.toHourStart(now);
    return Array.from({ length: WINDOW_HOURS[window] }, (_, index) => {
      const hour = new Date(currentHour);
      hour.setUTCHours(currentHour.getUTCHours() - index);
      return hour;
    });
  }

  private toHourStart(date: Date): Date {
    const hour = new Date(date);
    hour.setUTCMinutes(0, 0, 0);
    return hour;
  }

  private bucketKey(
    hourStart: Date,
    environment: string,
    tribeServiceId: string,
    sharedServiceId: string,
  ): string {
    return `${BUCKET_PREFIX}:${hourStart.toISOString()}:${this.encodePair(
      environment,
      tribeServiceId,
      sharedServiceId,
    )}`;
  }

  private indexKey(hourStart: Date): string {
    return `${INDEX_PREFIX}:${hourStart.toISOString()}`;
  }

  private encodePair(
    environment: string,
    tribeServiceId: string,
    sharedServiceId: string,
  ): string {
    return JSON.stringify([environment, tribeServiceId, sharedServiceId]);
  }

  private decodePair(pair: string): [string, string, string] {
    const parsed = JSON.parse(pair) as string[];
    if (parsed.length === 2) {
      return ["unknown", parsed[0] ?? "unknown", parsed[1] ?? "unknown"];
    }
    return [
      parsed[0] ?? "unknown",
      parsed[1] ?? "unknown",
      parsed[2] ?? "unknown",
    ];
  }

  private resolveEnvironment(event: SharedServiceUsageEvent): string {
    return event.environment ?? event.observation?.environment ?? "unknown";
  }
}
