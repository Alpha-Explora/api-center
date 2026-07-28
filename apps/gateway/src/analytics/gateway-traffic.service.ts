import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { ConfigService } from "../config/config.service";
import { LoggerService } from "../shared/logger.service";
import type { ServiceCallObservation } from "./service-call-observation";
import { SharedServiceUsageWindow } from "./shared-service-usage.service";
import {
  ManagementSourceMetadata,
  redisWindowSourceMetadata,
} from "../shared/source-metadata";

export type GatewayNamespace = "shared" | "tribe";

export interface GatewayTrafficEvent {
  namespace: GatewayNamespace;
  sourceTribe: string;
  targetService: string;
  environment?: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  timestamp: Date;
  observation?: ServiceCallObservation;
}

export interface GatewayTrafficSummary {
  window: SharedServiceUsageWindow;
  totalProxyRequests: number;
  tribeToTribeRequests: number;
  tribeToSharedRequests: number;
  status4xx: number;
  status5xx: number;
  kafkaPublishFailures: number;
  readinessFailures: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastSeenAt?: string;
  environments: Record<string, number>;
}

export interface GatewayTrafficSummaryResult {
  data: GatewayTrafficSummary;
  sourceMetadata: ManagementSourceMetadata;
}

type GatewayBucket = Omit<
  GatewayTrafficSummary,
  "window" | "avgLatencyMs" | "p95LatencyMs"
> & {
  latencyMsTotal: number;
  maxLatencyMs: number;
};

const BUCKET_PREFIX = "api-center:usage:gateway";
const RETENTION_SECONDS = 45 * 24 * 60 * 60;
const WINDOW_HOURS: Record<SharedServiceUsageWindow, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
};

@Injectable()
export class GatewayTrafficService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis | null = null;

  private readonly memoryBuckets = new Map<string, GatewayBucket>();

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
      this.logger.info("GatewayTrafficService connected to Redis", {});
    } catch (err) {
      this.redis = null;
      this.logger.warn(
        `GatewayTrafficService Redis unavailable; using in-memory counters: ${(err as Error).message}`,
        "GatewayTrafficService",
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  async recordProxyRequest(event: GatewayTrafficEvent): Promise<void> {
    const increments = {
      totalProxyRequests: 1,
      tribeToTribeRequests: event.namespace === "tribe" ? 1 : 0,
      tribeToSharedRequests: event.namespace === "shared" ? 1 : 0,
      status4xx: event.statusCode >= 400 && event.statusCode < 500 ? 1 : 0,
      status5xx: event.statusCode >= 500 ? 1 : 0,
      kafkaPublishFailures: 0,
      readinessFailures: 0,
      environments: { [this.resolveEnvironment(event)]: 1 },
      latencyMsTotal: Math.max(0, event.latencyMs),
      maxLatencyMs: Math.max(0, event.latencyMs),
      lastSeenAt: event.timestamp.toISOString(),
    };

    await this.recordBucket(event.timestamp, increments);
  }

  async recordKafkaPublishFailure(topic: string, timestamp = new Date()) {
    await this.recordBucket(timestamp, {
      totalProxyRequests: 0,
      tribeToTribeRequests: 0,
      tribeToSharedRequests: 0,
      status4xx: 0,
      status5xx: 0,
      kafkaPublishFailures: 1,
      readinessFailures: 0,
      environments: {},
      latencyMsTotal: 0,
      maxLatencyMs: 0,
      lastSeenAt: timestamp.toISOString(),
    });
    this.logger.debug(`Kafka publish failure counted for '${topic}'`);
  }

  async recordReadinessFailure(check: string, timestamp = new Date()) {
    await this.recordBucket(timestamp, {
      totalProxyRequests: 0,
      tribeToTribeRequests: 0,
      tribeToSharedRequests: 0,
      status4xx: 0,
      status5xx: 0,
      kafkaPublishFailures: 0,
      readinessFailures: 1,
      environments: {},
      latencyMsTotal: 0,
      maxLatencyMs: 0,
      lastSeenAt: timestamp.toISOString(),
    });
    this.logger.debug(`Readiness failure counted for '${check}'`);
  }

  async getSummary(
    window: SharedServiceUsageWindow = "24h",
    now = new Date(),
  ): Promise<GatewayTrafficSummary> {
    return (await this.getSummaryWithSourceMetadata(window, now)).data;
  }

  async getSummaryWithSourceMetadata(
    window: SharedServiceUsageWindow = "24h",
    now = new Date(),
  ): Promise<GatewayTrafficSummaryResult> {
    const hours = this.getHourStarts(window, now);
    const aggregate = this.createEmptyBucket();
    const { buckets, sourceName, degradedReason } =
      await this.readBucketsWithSource(hours);

    for (const bucket of buckets) {
      if (!bucket) continue;
      this.mergeBucket(aggregate, bucket);
    }

    return {
      data: {
        window,
        totalProxyRequests: aggregate.totalProxyRequests,
        tribeToTribeRequests: aggregate.tribeToTribeRequests,
        tribeToSharedRequests: aggregate.tribeToSharedRequests,
        status4xx: aggregate.status4xx,
        status5xx: aggregate.status5xx,
        kafkaPublishFailures: aggregate.kafkaPublishFailures,
        readinessFailures: aggregate.readinessFailures,
        environments: aggregate.environments,
        avgLatencyMs:
          aggregate.totalProxyRequests > 0
            ? Math.round(
                aggregate.latencyMsTotal / aggregate.totalProxyRequests,
              )
            : 0,
        p95LatencyMs: aggregate.maxLatencyMs,
        lastSeenAt: aggregate.lastSeenAt,
      },
      sourceMetadata: redisWindowSourceMetadata({
        sourceName,
        window,
        now,
        degradedReason,
      }),
    };
  }

  private async readBucketsWithSource(hours: Date[]): Promise<{
    buckets: Array<GatewayBucket | undefined>;
    sourceName: string;
    degradedReason?: string;
  }> {
    if (!this.redis) {
      return {
        buckets: hours.map((hour) =>
          this.memoryBuckets.get(this.bucketKey(hour)),
        ),
        sourceName: "gateway-traffic-memory-window",
        degradedReason: "Redis unavailable; using in-memory gateway counters.",
      };
    }

    try {
      const buckets = [];
      for (const hour of hours) {
        const raw = await this.redis.hgetall(this.bucketKey(hour));
        buckets.push(
          Object.keys(raw).length ? this.parseBucket(raw) : undefined,
        );
      }
      return { buckets, sourceName: "gateway-traffic-redis-window" };
    } catch (err) {
      const degradedReason = `Redis read failed; using in-memory gateway counters: ${(err as Error).message}`;
      this.logger.warn(degradedReason, "GatewayTrafficService");
      return {
        buckets: hours.map((hour) =>
          this.memoryBuckets.get(this.bucketKey(hour)),
        ),
        sourceName: "gateway-traffic-memory-window",
        degradedReason,
      };
    }
  }

  private async recordBucket(
    timestamp: Date,
    increments: GatewayBucket,
  ): Promise<void> {
    const hourStart = this.toHourStart(timestamp);
    const key = this.bucketKey(hourStart);
    this.mergeBucket(
      this.memoryBuckets.get(key) ?? this.createEmptyBucket(),
      increments,
      key,
    );

    if (!this.redis) return;

    try {
      const pipeline = this.redis.pipeline();
      for (const field of [
        "totalProxyRequests",
        "tribeToTribeRequests",
        "tribeToSharedRequests",
        "status4xx",
        "status5xx",
        "kafkaPublishFailures",
        "readinessFailures",
        "latencyMsTotal",
      ] as const) {
        if (increments[field] > 0)
          pipeline.hincrby(key, field, increments[field]);
      }
      const currentMax = await this.redis.hget(key, "maxLatencyMs");
      if (increments.maxLatencyMs > Number(currentMax ?? 0)) {
        pipeline.hset(key, "maxLatencyMs", increments.maxLatencyMs);
      }
      if (Object.keys(increments.environments).length) {
        const existingEnvironments = this.parseEnvironmentCounts(
          (await this.redis.hget(key, "environments")) ?? undefined,
        );
        for (const [environment, count] of Object.entries(increments.environments)) {
          existingEnvironments[environment] =
            (existingEnvironments[environment] ?? 0) + count;
        }
        pipeline.hset(key, "environments", JSON.stringify(existingEnvironments));
      }
      if (increments.lastSeenAt)
        pipeline.hset(key, "lastSeenAt", increments.lastSeenAt);
      pipeline.expire(key, RETENTION_SECONDS);
      await pipeline.exec();
    } catch (err) {
      this.logger.warn(
        `GatewayTrafficService Redis write failed; retained in-memory counter only: ${(err as Error).message}`,
        "GatewayTrafficService",
      );
    }
  }

  private createEmptyBucket(): GatewayBucket {
    return {
      totalProxyRequests: 0,
      tribeToTribeRequests: 0,
      tribeToSharedRequests: 0,
      status4xx: 0,
      status5xx: 0,
      kafkaPublishFailures: 0,
      readinessFailures: 0,
      environments: {},
      latencyMsTotal: 0,
      maxLatencyMs: 0,
    };
  }

  private mergeBucket(
    target: GatewayBucket,
    source: GatewayBucket,
    targetKey?: string,
  ): void {
    target.totalProxyRequests += source.totalProxyRequests;
    target.tribeToTribeRequests += source.tribeToTribeRequests;
    target.tribeToSharedRequests += source.tribeToSharedRequests;
    target.status4xx += source.status4xx;
    target.status5xx += source.status5xx;
    target.kafkaPublishFailures += source.kafkaPublishFailures;
    target.readinessFailures += source.readinessFailures;
    for (const [environment, count] of Object.entries(source.environments)) {
      target.environments[environment] =
        (target.environments[environment] ?? 0) + count;
    }
    target.latencyMsTotal += source.latencyMsTotal;
    target.maxLatencyMs = Math.max(target.maxLatencyMs, source.maxLatencyMs);
    if (
      source.lastSeenAt &&
      (!target.lastSeenAt || source.lastSeenAt > target.lastSeenAt)
    ) {
      target.lastSeenAt = source.lastSeenAt;
    }
    if (targetKey) this.memoryBuckets.set(targetKey, target);
  }

  private parseBucket(raw: Record<string, string>): GatewayBucket {
    return {
      totalProxyRequests: this.parseCount(raw.totalProxyRequests),
      tribeToTribeRequests: this.parseCount(raw.tribeToTribeRequests),
      tribeToSharedRequests: this.parseCount(raw.tribeToSharedRequests),
      status4xx: this.parseCount(raw.status4xx),
      status5xx: this.parseCount(raw.status5xx),
      kafkaPublishFailures: this.parseCount(raw.kafkaPublishFailures),
      readinessFailures: this.parseCount(raw.readinessFailures),
      environments: this.parseEnvironmentCounts(raw.environments),
      latencyMsTotal: this.parseCount(raw.latencyMsTotal),
      maxLatencyMs: this.parseCount(raw.maxLatencyMs),
      lastSeenAt: raw.lastSeenAt,
    };
  }

  private parseEnvironmentCounts(value: string | undefined): Record<string, number> {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([environment, count]) => [
          environment,
          typeof count === "number" ? count : this.parseCount(String(count)),
        ]),
      );
    } catch {
      return {};
    }
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

  private resolveEnvironment(event: GatewayTrafficEvent): string {
    return event.environment ?? event.observation?.environment ?? "unknown";
  }

  private toHourStart(date: Date): Date {
    const hour = new Date(date);
    hour.setUTCMinutes(0, 0, 0);
    return hour;
  }

  private bucketKey(hourStart: Date): string {
    return `${BUCKET_PREFIX}:${hourStart.toISOString()}`;
  }
}
