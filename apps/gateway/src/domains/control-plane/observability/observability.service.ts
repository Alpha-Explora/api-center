// Read models for the console: the request log, usage over time, quota meters and the audit log.
//
// request_diagnostics and audit_events have no row-level security, so every read here is bounded by
// an explicit project or organization filter, and a project is confirmed to belong to the
// organization (through the tenant-scoped cp_projects) before its rows are read.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { NotFoundError } from "@shared/errors";
import { testDefaultDailyRequests, windowStart } from "../quota-budgets";
import { requireControlPlaneDatabase, withTenant, type TenantDb } from "../tenant-transaction";
import type { AuditScope } from "../console-access.policy";
import type { EnvironmentScope } from "../control-plane-admin.service";
import { decodeCursor, pageOf } from "./cursor";
import { requestLogWindow, statusRange, toRequestLogEntry, type RequestLogQuery, type RequestLogRow } from "./request-log";
import { buildUsageSeries, usageWindow, type UsageRange, type UsageRow } from "./usage-series";
import { buildQuotaMeters, quotaMeterWindows, type MeterPolicy } from "./quota-meters";
import { auditLogWhere, toAuditLogEntry, type AuditLogQuery } from "./audit-log";

@Injectable()
export class ObservabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async requestLog(scope: EnvironmentScope, query: RequestLogQuery, now = new Date()) {
    await withTenant(this.prisma, { organizationId: scope.organizationId }, (db) => requireEnvironment(db, scope));
    const { from, to } = requestLogWindow(query, now);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const [minStatus, maxStatus] = statusRange(query.status);
    const rows = await this.prisma.$queryRaw<RequestLogRow[]>`
      SELECT request_id::text AS "requestId", created_at AS "occurredAt", service_id AS "applicationId", method, route,
             status_code AS "statusCode", duration_ms AS "durationMs", failure_stage AS "failureStage",
             error_code AS "errorCode", correlation_id AS "correlationId"
      FROM apic_runtime.request_diagnostics
      WHERE project_id = ${scope.projectId}
        AND environment = ${scope.environmentKind}
        AND (${query.applicationId ?? null}::text IS NULL OR service_id = ${query.applicationId ?? null})
        AND status_code BETWEEN ${minStatus} AND ${maxStatus}
        AND created_at >= ${from} AND created_at <= ${to}
        AND (${cursor?.at ?? null}::timestamptz IS NULL
             OR (created_at, request_id) < (${cursor?.at ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      ORDER BY created_at DESC, request_id DESC
      LIMIT ${query.limit + 1}`;
    const page = pageOf(rows, query.limit, (row) => ({ at: row.occurredAt, id: row.requestId }));
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

  /** Audit events for one organization (or every organization when `organizationId` is undefined and the caller is the platform). */
  async auditLog(organizationId: string | undefined, scope: AuditScope, query: AuditLogQuery) {
    requireControlPlaneDatabase();
    if (organizationId && query.projectId) {
      await withTenant(this.prisma, { organizationId }, (db) => requireProject(db, organizationId, query.projectId!));
    }
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.prisma.auditEvent.findMany({
      where: auditLogWhere({ ...query, organizationId }, scope, cursor),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = pageOf(rows, query.limit, (row) => ({ at: row.createdAt, id: row.id }));
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
