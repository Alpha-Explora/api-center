import { databaseConfigured } from "@config/database-configured";
import { Injectable, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { LoggerService } from "@shared/logger.service";
import {
  durablePostgresSourceMetadata,
  ManagementSourceMetadata,
  memoryWindowSourceMetadata,
} from "@shared/source-metadata";

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
  /** The control-plane organization and project the event belongs to, for the console's audit log. */
  organizationId?: string;
  projectId?: string;
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

/** Which organization and project an audit event belongs to. */
export type AuditOwner = Pick<AuditEventRecord, "organizationId" | "projectId">;

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

/** One page of an organization's (or the platform's) audit events, newest first. */
export interface AuditEventPageFilter {
  organizationId?: string;
  /** Only these projects' events; a project admin's view. */
  projectIds?: string[];
  projectId?: string;
  actor?: string;
  /** An action, or an action prefix such as `control_plane.credential`. */
  action?: string;
  from?: Date;
  to?: Date;
  /** Keyset cursor: events strictly older than this one. */
  before?: { at: Date; id: string };
  take: number;
}

export interface AuditEventPageRow {
  id: string;
  createdAt: Date;
  organizationId: string | null;
  projectId: string | null;
  environment: string;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  correlationId: string | null;
  metadata: unknown;
}

export function auditEventPageWhere(filter: Omit<AuditEventPageFilter, "take">): Prisma.AuditEventWhereInput {
  const conditions: Prisma.AuditEventWhereInput[] = [];
  if (filter.organizationId) conditions.push({ organizationId: filter.organizationId });
  if (filter.projectIds) conditions.push({ projectId: { in: filter.projectIds } });
  if (filter.projectId) conditions.push({ projectId: filter.projectId });
  if (filter.actor) conditions.push({ actorId: filter.actor });
  if (filter.action) conditions.push({ OR: [{ action: filter.action }, { action: { startsWith: `${filter.action}.` } }] });
  if (filter.from) conditions.push({ createdAt: { gte: filter.from } });
  if (filter.to) conditions.push({ createdAt: { lte: filter.to } });
  if (filter.before) {
    conditions.push({ OR: [{ createdAt: { lt: filter.before.at } }, { createdAt: filter.before.at, id: { lt: filter.before.id } }] });
  }
  return { AND: conditions };
}

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
  environment?: string;
  actorType: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  metadata: unknown;
  createdAt: Date | string;
  organizationId?: string | null;
  projectId?: string | null;
};

@Injectable()
export class AuditEventsService {
  private readonly memoryEvents: AuditEventRecord[] = [];

  private readonly databaseEnabled = databaseConfigured();

  constructor(
    private readonly logger: LoggerService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

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

    await this.persistAuditEvent(record, options);

    return record;
  }

  /** Whether an event with this action and resource was persisted at or after `since`. False without a database. */
  async hasEventSince(query: { action: string; resourceType: string; resourceId: string; since: Date }): Promise<boolean> {
    if (!this.databaseEnabled || !this.prisma) return false;
    const found = await this.prisma.auditEvent.findFirst({
      where: { action: query.action, resourceType: query.resourceType, resourceId: query.resourceId, createdAt: { gte: query.since } },
      select: { id: true },
    });
    return Boolean(found);
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

  /** Reads durable events only; the in-memory cache has no organization attribution to filter on. */
  async listPage(filter: AuditEventPageFilter): Promise<AuditEventPageRow[]> {
    if (!this.prisma) throw new Error("Audit events need the APICenter database");
    const { take, ...where } = filter;
    return this.prisma.auditEvent.findMany({
      where: auditEventPageWhere(where),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
    });
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
    return memoryWindowSourceMetadata({
      sourceName: "audit-events-memory-cache",
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

    const environment = resolveAuditEnvironment(record);

    try {
      await this.prisma.auditEvent.create({
        data: {
          id: record.id,
          environment,
          actorType: resolveActorType(record),
          actorId: record.actor,
          action: record.type,
          resourceType: record.resourceType ?? this.resolveResourceType(record),
          resourceId: record.resourceId ?? this.resolveResourceId(record),
          outcome: record.severity === "error" ? "failed" : "succeeded",
          organizationId: record.organizationId ?? null,
          projectId: record.projectId ?? null,
          metadata: {
            actionFamily: record.actionFamily,
            severity: record.severity,
            message: record.message,
            serviceId: record.serviceId,
            tribeServiceId: record.tribeServiceId,
            sharedServiceId: record.sharedServiceId,
            resourceType: record.resourceType,
            resourceId: record.resourceId,
            environment,
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
    return this.memoryEvents.slice(0, limit);
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

function resolveActorType(record: AuditEventRecord): "system" | "operator" | "tribe" {
  if (!record.actor?.trim()) return "system";

  const actor = record.actor.toLowerCase();
  if (
    actor === "platform-admin" ||
    actor.includes("@") ||
    actor.includes("operator") ||
    actor.includes("admin")
  ) {
    return "operator";
  }

  return "tribe";
}

/** Organization-level events have no environment; the table accepts test, live or none. */
export function resolveAuditEnvironment(record: Pick<AuditEventRecord, "environment">): "test" | "live" | "none" {
  const environment = record.environment?.trim();
  return environment === "test" || environment === "live" ? environment : "none";
}

function mapAuditEventRow(row: AuditEventRow): AuditEventRecord {
  const metadata = asRecord(row.metadata);
  return {
    id: row.id,
    type: row.action,
    actionFamily: metadata.actionFamily as AuditEventRecord["actionFamily"],
    actor: row.actorId ?? undefined,
    organizationId: row.organizationId ?? undefined,
    projectId: row.projectId ?? undefined,
    serviceId: stringValue(metadata.serviceId),
    tribeServiceId: stringValue(metadata.tribeServiceId),
    sharedServiceId: stringValue(metadata.sharedServiceId),
    resourceType: stringValue(metadata.resourceType) ?? row.resourceType,
    resourceId: stringValue(metadata.resourceId) ?? row.resourceId ?? undefined,
    environment: stringValue(metadata.environment) ?? row.environment ?? "unknown",
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
