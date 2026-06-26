import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { ConfigService } from "../config/config.service";
import { PrismaService } from "../database/prisma.service";
import { LoggerService } from "../shared/logger.service";
import {
  durablePostgresSourceMetadata,
  ManagementSourceMetadata,
  redisWindowSourceMetadata,
} from "../shared/source-metadata";

export interface AuditEventRecord {
  id: string;
  type: string;
  actionFamily?:
    | "quota"
    | "plan"
    | "approval"
    | "promotion"
    | "secret"
    | "policy"
    | "runtime"
    | "registration"
    | "shared_service"
    | "gateway"
    | "lifecycle";
  actor?: string;
  serviceId?: string;
  tribeServiceId?: string;
  sharedServiceId?: string;
  resourceType?: string;
  resourceId?: string;
  environment?: string;
  correlationId?: string;
  severity: "info" | "warning" | "error";
  message: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEventFilter {
  limit?: number;
  serviceId?: string;
  type?: string;
  actionFamily?: AuditEventRecord["actionFamily"];
  actor?: string;
  from?: string;
  to?: string;
}

export interface AuditEventListResult {
  data: AuditEventRecord[];
  sourceMetadata: ManagementSourceMetadata;
}

const AUDIT_KEY = "api-center:audit:events";
const MAX_EVENTS = 500;
const DATABASE_READ_LIMIT = 500;

type AuditEventInput = Omit<AuditEventRecord, "id" | "timestamp"> & {
  timestamp?: string;
};

type AuditRecordOptions = {
  requirePostgres?: boolean;
};

type AuditEventRow = {
  id: string;
  correlationId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  metadata: unknown;
  createdAt: Date | string;
};

@Injectable()
export class AuditEventsService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis | null = null;

  private readonly memoryEvents: AuditEventRecord[] = [];

  private readonly databaseEnabled = process.env.DATABASE_ENABLED === "true";

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    @Optional() private readonly prisma?: PrismaService,
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

  async record(event: AuditEventInput): Promise<AuditEventRecord> {
    return this.recordInternal(event, { requirePostgres: false });
  }

  async recordRequired(event: AuditEventInput): Promise<AuditEventRecord> {
    this.validateRequiredAuditEvent(event);
    return this.recordInternal(event, { requirePostgres: true });
  }

  private async recordInternal(
    event: AuditEventInput,
    options: AuditRecordOptions,
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

    await this.persistAuditEvent(record, options);

    return record;
  }

  async list(filter: AuditEventFilter = {}): Promise<AuditEventRecord[]> {
    return (await this.listWithSourceMetadata(filter)).data;
  }

  async listWithSourceMetadata(
    filter: AuditEventFilter = {},
  ): Promise<AuditEventListResult> {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, MAX_EVENTS));
    const now = new Date();
    const { events, sourceMetadata } = await this.readEventsWithSource(
      DATABASE_READ_LIMIT,
      now,
    );

    return {
      data: events
        .filter((event) => !filter.type || event.type === filter.type)
        .filter(
          (event) =>
            !filter.actionFamily || event.actionFamily === filter.actionFamily,
        )
        .filter((event) => !filter.actor || event.actor === filter.actor)
        .filter((event) => isWithinDateRange(event.timestamp, filter))
        .filter(
          (event) =>
            !filter.serviceId ||
            event.serviceId === filter.serviceId ||
            event.tribeServiceId === filter.serviceId ||
            event.sharedServiceId === filter.serviceId,
        )
        .slice(0, limit),
      sourceMetadata,
    };
  }

  private async readEventsWithSource(
    limit: number,
    now: Date,
  ): Promise<{
    events: AuditEventRecord[];
    sourceMetadata: ManagementSourceMetadata;
  }> {
    if (this.databaseEnabled && this.prisma) {
      try {
        return {
          events: await this.listPostgres(limit),
          sourceMetadata: durablePostgresSourceMetadata({
            sourceName: "audit-events-postgres",
            evidenceTable: "apic_audit.audit_events",
            now,
          }),
        };
      } catch (err) {
        const degradedReason = `Postgres read failed; using cache audit events: ${(err as Error).message}`;
        this.logger.warn(degradedReason, "AuditEventsService");
        return {
          events: await this.listCacheWithFallback(limit),
          sourceMetadata: this.cacheSourceMetadata(now, degradedReason),
        };
      }
    }

    return {
      events: await this.listCacheWithFallback(limit),
      sourceMetadata: this.cacheSourceMetadata(
        now,
        "Postgres audit persistence is not enabled; using volatile audit cache.",
      ),
    };
  }

  private cacheSourceMetadata(
    now: Date,
    degradedReason?: string,
  ): ManagementSourceMetadata {
    return redisWindowSourceMetadata({
      sourceName: this.redis
        ? "audit-events-redis-cache"
        : "audit-events-memory-cache",
      window: "24h",
      now,
      degradedReason,
    });
  }

  private async persistAuditEvent(
    record: AuditEventRecord,
    options: AuditRecordOptions = {},
  ): Promise<void> {
    if (!this.databaseEnabled) {
      return;
    }

    if (!this.prisma) {
      const message =
        "PrismaService is required for required audit writes when database mode is enabled.";
      if (options.requirePostgres) throw new Error(message);
      this.logger.warn(message, "AuditEventsService");
      return;
    }

    try {
      await this.prisma.auditEvent.create({
        data: {
          id: record.id,
          actorType: record.actor ? "human" : "system",
          actorId: record.actor,
          action: record.type,
          resourceType: record.resourceType ?? this.resolveResourceType(record),
          resourceId: record.resourceId ?? this.resolveResourceId(record),
          outcome: record.severity === "error" ? "failed" : "succeeded",
          metadata: {
            actionFamily: record.actionFamily,
            severity: record.severity,
            message: record.message,
            serviceId: record.serviceId,
            tribeServiceId: record.tribeServiceId,
            sharedServiceId: record.sharedServiceId,
            resourceType: record.resourceType,
            resourceId: record.resourceId,
            environment: record.environment,
            correlationId: record.correlationId,
            payload: record.payload ?? {},
          } as any,
          createdAt: this.parseTimestamp(record.timestamp),
        },
      });
    } catch (err) {
      const message = `AuditEventsService Postgres write failed; retained cache event only: ${(err as Error).message}`;
      if (options.requirePostgres) throw new Error(message);
      this.logger.warn(message, "AuditEventsService");
    }
  }

  private async listPostgres(limit: number): Promise<AuditEventRecord[]> {
    const rows = await this.prisma!.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(mapAuditEventRow);
  }

  private async listCacheWithFallback(
    limit: number,
  ): Promise<AuditEventRecord[]> {
    return this.redis
      ? await this.listRedisWithFallback(limit)
      : this.memoryEvents.slice(0, limit);
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

  private validateRequiredAuditEvent(event: AuditEventInput): void {
    if (!event.actor?.trim()) {
      throw new Error("Required audit events must include actor evidence.");
    }
    if (!event.actionFamily) {
      throw new Error(
        "Required audit events must include action family evidence.",
      );
    }
    if (!event.resourceType?.trim()) {
      throw new Error(
        "Required audit events must include resource type evidence.",
      );
    }
    if (!event.resourceId?.trim()) {
      throw new Error(
        "Required audit events must include resource id evidence.",
      );
    }
    if (!event.environment?.trim()) {
      throw new Error(
        "Required audit events must include environment evidence.",
      );
    }
    if (!event.correlationId?.trim()) {
      throw new Error(
        "Required audit events must include correlation id evidence.",
      );
    }
  }

  private resolveResourceType(record: AuditEventRecord): string {
    if (record.serviceId) return "service";
    if (record.tribeServiceId) return "tribe_service";
    if (record.sharedServiceId) return "shared_service";
    return record.actionFamily ?? "audit_event";
  }

  private resolveResourceId(record: AuditEventRecord): string | undefined {
    return record.serviceId ?? record.tribeServiceId ?? record.sharedServiceId;
  }

  private parseTimestamp(timestamp: string): Date {
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}

function mapAuditEventRow(row: AuditEventRow): AuditEventRecord {
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    type: row.action,
    actionFamily: metadata.actionFamily as AuditEventRecord["actionFamily"],
    actor: row.actorId ?? undefined,
    serviceId: stringValue(metadata.serviceId),
    tribeServiceId: stringValue(metadata.tribeServiceId),
    sharedServiceId: stringValue(metadata.sharedServiceId),
    resourceType: stringValue(metadata.resourceType) ?? row.resourceType,
    resourceId: stringValue(metadata.resourceId) ?? row.resourceId ?? undefined,
    environment: stringValue(metadata.environment),
    correlationId:
      stringValue(metadata.correlationId) ?? row.correlationId ?? undefined,
    severity:
      metadata.severity === "warning" || metadata.severity === "error"
        ? metadata.severity
        : "info",
    message:
      typeof metadata.message === "string" ? metadata.message : row.action,
    payload: asPayload(metadata.payload),
    timestamp:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : new Date(row.createdAt).toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asPayload(value: unknown): Record<string, unknown> | undefined {
  const payload = asRecord(value);
  return Object.keys(payload).length ? payload : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isWithinDateRange(timestamp: string, filter: AuditEventFilter) {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) return false;

  if (filter.from) {
    const from = Date.parse(filter.from);
    if (!Number.isNaN(from) && time < from) return false;
  }

  if (filter.to) {
    const to = Date.parse(
      filter.to.includes("T") ? filter.to : `${filter.to}T23:59:59.999Z`,
    );
    if (!Number.isNaN(to) && time > to) return false;
  }

  return true;
}
