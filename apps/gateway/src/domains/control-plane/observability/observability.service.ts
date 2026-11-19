// Read models for the console: the request log, usage over time, quota meters and the audit log.
//
// The request log and audit events live in other contexts (runtime operations, audit) and have no
// row-level security, so every read is bounded by an explicit project or organization filter, and a
// project is confirmed to belong to the organization (through the tenant-scoped cp_projects) first.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { NotFoundError, ValidationError } from "@shared/errors";
import { RequestDiagnosticsStore } from "@shared/request-diagnostics.store";
import { AuditEventsService } from "@audit/audit-events.service";
import { testDefaultDailyRequests, windowStart } from "../quota-budgets";
import { requireControlPlaneDatabase, withTenant, type TenantDb } from "../tenant-transaction";
import type { AuditScope } from "../console-access.policy";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { decodeCursor, pageOf, type Cursor } from "./cursor";
import { requestLogWindow, statusRange, toRequestLogEntry, type RequestLogQuery } from "./request-log";
import { buildUsageSeries, usageWindow, type UsageRange, type UsageRow } from "./usage-series";
import { buildQuotaMeters, quotaMeterWindows, sharedCeilingMeters, type MeterPolicy } from "./quota-meters";
import { toAuditLogEntry, type AuditLogQuery } from "./audit-log";

@Injectable()
export class ObservabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly diagnostics: RequestDiagnosticsStore,
    private readonly audit: AuditEventsService,
  ) {}

  async requestLog(scope: EnvironmentScope, query: RequestLogQuery, now = new Date()) {
    await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) => requireEnvironment(db, scope));
    const { from, to } = requestLogWindow(query, now);
    const rows = await this.diagnostics.listForProject({
      projectId: scope.projectId,
      environment: scope.environmentKind,
      applicationId: query.applicationId,
      statusRange: statusRange(query.status),
      from,
      to,
      before: query.cursor ? decodeCursor(query.cursor) : undefined,
      take: query.limit + 1,
    });
    const page = pageOf(rows, query.limit, (row) => ({ at: row.cursorAt, id: row.requestId }));
    return { from: from.toISOString(), to: to.toISOString(), items: page.items.map(toRequestLogEntry), nextCursor: page.nextCursor };
  }

  async usageSeries(scope: EnvironmentScope, range: UsageRange, now = new Date()) {
    const { bucket, starts } = usageWindow(range, now);
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await requireEnvironment(db, scope);
      const rows = await db.$queryRaw<UsageRow[]>`
        SELECT date_trunc(${bucket}, created_at, 'UTC') AS "bucketStart", application_id AS "applicationId",
               capability, action, outcome, count(*)::int AS requests
        FROM apic_catalog.cp_usage_records
        WHERE organization_id = ${scope.organizationId}::uuid AND environment_id = ${environment.id} AND created_at >= ${starts[0]}
        GROUP BY 1, 2, 3, 4, 5`;
      return buildUsageSeries(range, now, rows);
    });
  }

  async quotaMeters(scope: EnvironmentScope, now = new Date()) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await requireEnvironment(db, scope);
      const entitlement = await db.cpEntitlement.findFirst({
        where: { organizationId: scope.organizationId, environmentId: environment.id, status: "active" },
      });
      const covering = await db.cpQuotaPolicyProject.findMany({
        where: { organizationId: scope.organizationId, projectId: scope.projectId },
        select: { policyId: true },
      });
      const policies = await db.cpQuotaPolicy.findMany({
        where: {
          organizationId: scope.organizationId,
          environmentKind: scope.environmentKind,
          status: { not: "deleted" },
          OR: [{ scope: "project", projectId: scope.projectId }, { scope: "shared", id: { in: covering.map((row) => row.policyId) } }],
        },
      });
      const input = {
        environment: { id: environment.id, kind: scope.environmentKind },
        planKey: entitlement?.planKey,
        policies: policies as MeterPolicy[],
        testDailyRequests: testDefaultDailyRequests(),
      };
      const { budgets } = quotaMeterWindows(input);
      const earliest = budgets.reduce((min, budget) => Math.min(min, windowStart(now, budget.windowSeconds).getTime()), now.getTime());
      const counters = budgets.length
        ? await db.cpQuotaCounter.findMany({
            where: { organizationId: scope.organizationId, budgetKey: { in: budgets.map((budget) => budget.key) }, windowStart: { gte: new Date(earliest) } },
          })
        : [];
      return buildQuotaMeters(input, counters, now);
    });
  }

  /** Current-window usage of every shared ceiling in the organization. */
  async sharedCeilingMeters(organizationId: string, now = new Date()) {
    return withTenant(this.prisma, { organizationId }, async (db) => {
      const policies = (await db.cpQuotaPolicy.findMany({ where: { organizationId, scope: "shared", status: { not: "deleted" } } })) as MeterPolicy[];
      const earliest = policies.reduce((min, policy) => Math.min(min, windowStart(now, policy.windowSeconds).getTime()), now.getTime());
      const counters = policies.length
        ? await db.cpQuotaCounter.findMany({
            where: { organizationId, budgetKey: { in: policies.map((policy) => `policy:${policy.id}`) }, windowStart: { gte: new Date(earliest) } },
          })
        : [];
      return sharedCeilingMeters(policies, counters, now);
    });
  }

  /** Audit events for one organization, or every organization when `organizationId` is undefined (platform callers). */
  async auditLog(organizationId: string | undefined, scope: AuditScope, query: AuditLogQuery) {
    requireControlPlaneDatabase();
    if (query.from && query.to && Date.parse(query.from) >= Date.parse(query.to)) throw new ValidationError("from must be before to");
    if (organizationId && query.projectId) {
      await withTenant(this.prisma, { organizationId }, (db) => requireProject(db, organizationId, query.projectId!));
    }
    const rows = await this.audit.listPage({
      organizationId,
      projectIds: scope.kind === "projects" ? scope.projectIds : undefined,
      projectId: query.projectId,
      actor: query.actor,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      before: query.cursor ? auditCursor(decodeCursor(query.cursor)) : undefined,
      take: query.limit + 1,
    });
    const page = pageOf(rows, query.limit, (row) => ({ at: row.createdAt.toISOString(), id: row.id }));
    return { items: page.items.map(toAuditLogEntry), nextCursor: page.nextCursor };
  }
}

async function requireEnvironment(db: TenantDb, scope: EnvironmentScope) {
  const environment = await db.cpEnvironment.findFirst({
    where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
  });
  if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
  return environment;
}

async function requireProject(db: TenantDb, organizationId: string, projectId: string) {
  if (!(await db.cpProject.findFirst({ where: { id: projectId, organizationId } }))) {
    throw new NotFoundError(`Project '${projectId}' was not found`);
  }
}

/**
 * Audit events are written by AuditEventsService with a JS Date (millisecond precision), so a Date
 * comparison through Prisma is exact for them, unlike request diagnostics' database-set created_at.
 */
function auditCursor(cursor: Cursor): { at: Date; id: string } {
  return { at: new Date(cursor.at), id: cursor.id };
}
