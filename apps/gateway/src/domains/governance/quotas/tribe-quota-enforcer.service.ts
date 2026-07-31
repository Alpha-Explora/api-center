import { Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import Redis from "ioredis";
import { AuditEventsService } from "@analytics/audit-events.service";
import { ConfigService } from "@config/config.service";
import { TribeCostService } from "@costs/tribe-cost.service";
import { PrismaService } from "@database/prisma.service";
import { QuotaExceededError } from "@shared/errors";
import { TribeQuotaPolicyService } from "./tribe-quota-policy.service";
import {
  TribeQuotaDecisionOutcome,
  TribeQuotaPolicy,
  TribeQuotaScope,
} from "./tribe-quota-policy.types";

interface CheckTribeQuotaInput {
  ownerTribeId: string;
  scope: TribeQuotaScope;
  targetServiceId?: string;
  routeFamily: string;
  correlationId?: string;
  environment?: string;
}

interface QuotaDecisionDelegate {
  create(args: {
    data: {
      ownerTribeId: string;
      policyId?: string;
      scope: TribeQuotaScope;
      targetServiceId?: string | null;
      routeFamily: string;
      windowStart: Date;
      windowEnd: Date;
      requestCount: number;
      maxRequests: number;
      mode: string;
      outcome: TribeQuotaDecisionOutcome;
      correlationId?: string;
      environment?: string;
    };
  }): Promise<unknown>;
}

interface QuotaDecisionPrisma {
  quotaEvaluation: QuotaDecisionDelegate;
}

@Injectable()
export class TribeQuotaEnforcerService implements OnModuleDestroy {
  private readonly quotaPrisma: QuotaDecisionPrisma;
  private readonly memoryCounters = new Map<
    string,
    { count: number; expiresAt: number }
  >();
  private redis: Redis | null = null;
  private redisConnectPromise: Promise<Redis | null> | null = null;

  constructor(
    private readonly policies: TribeQuotaPolicyService,
    prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly costs?: TribeCostService,
    @Optional() private readonly auditEvents?: AuditEventsService,
  ) {
    this.quotaPrisma = prisma as unknown as QuotaDecisionPrisma;
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  async check(input: CheckTribeQuotaInput): Promise<void> {
    const policy = await this.policies.resolvePolicy(input);
    if (!policy) return;

    const now = new Date();
    const windowStartMs =
      Math.floor(now.getTime() / (policy.windowSeconds * 1000)) *
      policy.windowSeconds *
      1000;
    const windowStart = new Date(windowStartMs);
    const windowEnd = new Date(windowStartMs + policy.windowSeconds * 1000);
    const requestCount = await this.incrementCounter(
      policy,
      input,
      windowStart,
      windowEnd,
    );
    const effectiveLimit = policy.burstRequests ?? policy.maxRequests;
    const exceeded = requestCount > effectiveLimit;
    const outcome: TribeQuotaDecisionOutcome = exceeded
      ? policy.mode === "enforce"
        ? "blocked"
        : "observed_exceeded"
      : "allowed";

    await this.recordDecision(
      policy,
      input,
      windowStart,
      windowEnd,
      requestCount,
      outcome,
    );

    if (outcome === "blocked") {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
      );

      throw new QuotaExceededError("Tribe API quota exceeded", {
        ownerTribeId: input.ownerTribeId,
        retryAfterSeconds,
        quota: {
          maxRequests: policy.maxRequests,
          windowSeconds: policy.windowSeconds,
          scope: policy.scope,
          targetServiceId: policy.targetServiceId ?? null,
        },
      });
    }
  }

  estimateUsageChargeback(input: {
    requestCount: number;
    maxRequests: number;
    scope: TribeQuotaScope | string;
  }) {
    if (!this.costs || input.maxRequests <= 0) return undefined;
    const usagePercent = input.requestCount / input.maxRequests;
    if (usagePercent < 0.8) return undefined;

    return this.costs.estimateMonthlyChargeback({
      apiCalls:
        input.scope === "kafka_publish" ? 0 : Math.max(0, input.requestCount),
      kafkaPublishes:
        input.scope === "kafka_publish" ? Math.max(0, input.requestCount) : 0,
      gbScanned: 0,
    });
  }

  private async incrementCounter(
    policy: TribeQuotaPolicy,
    input: CheckTribeQuotaInput,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<number> {
    const key = this.counterKey(policy, input, windowStart);
    const redis = await this.getRedis();
    if (redis) {
      try {
        const count = await redis.incr(key);
        if (count === 1) {
          await redis.pexpire(
            key,
            Math.max(1, windowEnd.getTime() - Date.now()),
          );
        }
        return count;
      } catch {
        this.redis?.disconnect();
        this.redis = null;
      }
    }

    const now = Date.now();
    const existing = this.memoryCounters.get(key);
    if (existing && existing.expiresAt <= now) {
      this.memoryCounters.delete(key);
    }

    const entry = this.memoryCounters.get(key) ?? {
      count: 0,
      expiresAt: windowEnd.getTime(),
    };
    entry.count += 1;
    this.memoryCounters.set(key, entry);
    return entry.count;
  }

  private async recordDecision(
    policy: TribeQuotaPolicy,
    input: CheckTribeQuotaInput,
    windowStart: Date,
    windowEnd: Date,
    requestCount: number,
    outcome: TribeQuotaDecisionOutcome,
  ): Promise<void> {
    await this.quotaPrisma.quotaEvaluation.create({
      data: {
        ownerTribeId: input.ownerTribeId,
        policyId: policy.id,
        scope: policy.scope,
        targetServiceId: policy.targetServiceId ?? null,
        routeFamily: input.routeFamily,
        windowStart,
        windowEnd,
        requestCount,
        maxRequests: policy.maxRequests,
        mode: policy.mode,
        outcome,
        correlationId: input.correlationId,
        environment: input.environment ?? "unknown",
      },
    });
    this.recordAudit(
      policy,
      input,
      requestCount,
      outcome,
      windowStart,
      windowEnd,
    );
  }

  private recordAudit(
    policy: TribeQuotaPolicy,
    input: CheckTribeQuotaInput,
    requestCount: number,
    outcome: TribeQuotaDecisionOutcome,
    windowStart: Date,
    windowEnd: Date,
  ): void {
    const actionOutcome = outcome === "blocked" ? "denied" : outcome;
    this.auditEvents
      ?.record({
        type: `quota.evaluation.${actionOutcome}`,
        actionFamily: "quota",
        actor: input.ownerTribeId,
        resourceType: "quota_evaluation",
        resourceId:
          input.correlationId ??
          `${input.ownerTribeId}:${policy.id ?? "unpersisted-policy"}:${windowStart.getTime()}`,
        environment: input.environment ?? "unknown",
        correlationId: input.correlationId,
        severity: outcome === "allowed" ? "info" : "warning",
        message: `Quota evaluation ${actionOutcome} for ${input.ownerTribeId}`,
        payload: {
          ownerTribeId: input.ownerTribeId,
          policyId: policy.id,
          scope: policy.scope,
          targetServiceId: policy.targetServiceId ?? null,
          routeFamily: input.routeFamily,
          requestCount,
          maxRequests: policy.maxRequests,
          mode: policy.mode,
          outcome,
          actionOutcome,
          correlationId: input.correlationId,
          environment: input.environment ?? "unknown",
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        },
      })
      .catch(() => undefined);
  }

  private counterKey(
    policy: TribeQuotaPolicy,
    input: CheckTribeQuotaInput,
    windowStart: Date,
  ): string {
    return [
      "quota",
      input.ownerTribeId,
      policy.scope,
      policy.targetServiceId ?? "all-targets",
      input.environment ?? "unknown",
      policy.id ?? "unpersisted-policy",
      windowStart.getTime(),
    ].join(":");
  }

  private async getRedis(): Promise<Redis | null> {
    if (!this.config.redis.rateLimitUrl) {
      return null;
    }

    if (this.redis?.status === "ready") {
      return this.redis;
    }

    if (this.redis?.status === "end") {
      this.redis = null;
    }

    if (!this.redis) {
      this.redis = new Redis(this.config.redis.rateLimitUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      this.redis.on("error", () => undefined);
    }

    if (!this.redisConnectPromise) {
      this.redisConnectPromise = this.redis
        .connect()
        .then(() => this.redis)
        .catch(() => {
          this.redis?.disconnect();
          this.redis = null;
          return null;
        })
        .finally(() => {
          this.redisConnectPromise = null;
        });
    }

    return this.redisConnectPromise;
  }
}
