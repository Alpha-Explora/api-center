// Plans, request budgets and usage for application requests.
//
// reserve() runs in one tenant transaction: it records the request key (a repeat is admitted
// without counting again), then increments every applicable budget with a conditional upsert. Any
// full budget aborts the transaction, so no budget is charged for a rejected request.

import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { AppError, NotFoundError, ValidationError } from "@shared/errors";
import { isKnownCapability } from "./capability-catalog";
import { composeBudgets, listPlans, planAllowsLive, testDefaultDailyRequests, windowStart, type Budget } from "./quota-budgets";
import { withTenant, type TenantDb } from "./tenant-transaction";
import type { ApplicationIdentity, EnvironmentKind } from "./control-plane.types";
import type { EnvironmentScope } from "./control-plane-admin.service";

const MAX_COUNT = 2_147_483_647;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function newId(prefix: "ent" | "qp"): string {
  let out = "";
  while (out.length < 24) {
    for (const byte of randomBytes(48)) {
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === 24) break;
    }
  }
  return `${prefix}_${out}`;
}

/** 429 for an application request that would exceed a budget. The proxy sends Retry-After. */
export class RequestBudgetExhaustedError extends AppError {
  constructor(
    readonly budget: Budget,
    readonly retryAfterSeconds: number,
  ) {
    super(
      `The ${budget.source} request budget (${budget.limit} per ${budget.windowSeconds}s) is exhausted; retry after ${retryAfterSeconds}s`,
      429,
      "QUOTA_EXCEEDED",
    );
  }
}

export interface QuotaPolicyInput {
  environmentKind: EnvironmentKind;
  capability?: string;
  windowSeconds: number;
  maxRequests: number;
  mode: "observe" | "enforce";
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  listPlans() {
    return listPlans();
  }

  // ── Request path ─────────────────────────────────────────────────────────

  async reserve(identity: ApplicationIdentity, capability: string, action: string, requestKey: string, now = new Date()): Promise<{ counted: boolean }> {
    const { organizationId } = identity;
    return withTenant(this.prisma, { organizationId }, async (db) => {
      const recorded = await db.cpUsageRecord.createMany({
        data: [
          {
            organizationId,
            requestKey,
            projectId: identity.projectId,
            environmentId: identity.environmentId,
            applicationId: identity.applicationId,
            capability,
            action,
          },
        ],
        skipDuplicates: true,
      });
      if (recorded.count === 0) return { counted: false };

      const budgets = await this.budgetsFor(db, identity, capability);
      for (const budget of budgets) {
        const start = windowStart(now, budget.windowSeconds);
        const limit = budget.mode === "enforce" ? budget.limit : MAX_COUNT;
        const rows = await db.$queryRaw<{ request_count: number }[]>`
          INSERT INTO apic_catalog.cp_quota_counters (organization_id, budget_key, window_start, request_count)
          VALUES (${organizationId}::uuid, ${budget.key}, ${start}, 1)
          ON CONFLICT (budget_key, window_start)
          DO UPDATE SET request_count = cp_quota_counters.request_count + 1
          WHERE cp_quota_counters.request_count < ${limit}
          RETURNING request_count`;
        if (rows.length === 0) {
          const retryAfterSeconds = Math.max(1, Math.ceil((start.getTime() + budget.windowSeconds * 1000 - now.getTime()) / 1000));
          throw new RequestBudgetExhaustedError(budget, retryAfterSeconds);
        }
      }
      return { counted: true };
    });
  }

  /** Records how an admitted request ended. Advisory; never fails the request. */
  async complete(identity: ApplicationIdentity, requestKey: string, statusCode: number): Promise<void> {
    try {
      await withTenant(this.prisma, { organizationId: identity.organizationId }, (db) =>
        db.cpUsageRecord.updateMany({
          where: { organizationId: identity.organizationId, requestKey, outcome: "admitted" },
          data: { outcome: statusCode < 500 ? "completed" : "failed", statusCode, completedAt: new Date() },
        }),
      );
    } catch {
      // Usage outcomes are reporting data.
    }
  }

  private async budgetsFor(db: TenantDb, identity: ApplicationIdentity, capability: string): Promise<Budget[]> {
    const entitlement = await db.cpEntitlement.findFirst({
      where: { organizationId: identity.organizationId, environmentId: identity.environmentId, status: "active" },
    });
    const projectPolicies = await db.cpQuotaPolicy.findMany({
      where: {
        organizationId: identity.organizationId,
        scope: "project",
        projectId: identity.projectId,
        environmentKind: identity.environmentKind,
        status: "active",
      },
    });
    const covering = await db.cpQuotaPolicyProject.findMany({
      where: { organizationId: identity.organizationId, projectId: identity.projectId },
      select: { policyId: true },
    });
    const sharedPolicies = covering.length
      ? await db.cpQuotaPolicy.findMany({
          where: {
            organizationId: identity.organizationId,
            scope: "shared",
            environmentKind: identity.environmentKind,
            status: "active",
            id: { in: covering.map((row) => row.policyId) },
          },
        })
      : [];

    const composition = composeBudgets({
      environment: { id: identity.environmentId, kind: identity.environmentKind },
      capability,
      planKey: entitlement?.planKey,
      policies: [...projectPolicies, ...sharedPolicies],
      testDailyRequests: testDefaultDailyRequests(),
    });
    if (!composition.ok) {
      throw new AppError(
        composition.code === "LIVE_PLAN_REQUIRED"
          ? "Live requests need a plan assigned to the live environment"
          : "The environment's plan does not allow these requests",
        403,
        composition.code,
      );
    }
    return composition.budgets;
  }

  // ── Administration ───────────────────────────────────────────────────────

  async assignPlan(scope: EnvironmentScope, planKey: string, actor: string) {
    if (!listPlans().some((plan) => plan.planKey === planKey)) throw new ValidationError(`Plan '${planKey}' does not exist`);
    if (scope.environmentKind === "live" && !planAllowsLive(planKey)) {
      throw new AppError(`Plan '${planKey}' is test-only`, 409, "PLAN_NOT_AVAILABLE");
    }
    const entitlement = await withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await requireEnvironment(db, scope);
      await db.cpEntitlement.updateMany({
        where: { organizationId: scope.organizationId, environmentId: environment.id, status: "active" },
        data: { status: "archived", archivedAt: new Date() },
      });
      return db.cpEntitlement.create({
        data: {
          id: newId("ent"),
          organizationId: scope.organizationId,
          projectId: scope.projectId,
          environmentId: environment.id,
          planKey,
          assignedBy: actor,
        },
      });
    });
    await this.recordAudit("control_plane.plan.assigned", actor, entitlement.id, scope.environmentKind, { projectId: scope.projectId, planKey });
    return entitlement;
  }

  async currentPlan(scope: EnvironmentScope) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await requireEnvironment(db, scope);
      return db.cpEntitlement.findFirst({ where: { organizationId: scope.organizationId, environmentId: environment.id, status: "active" } });
    });
  }

  async createProjectPolicy(organizationId: string, projectId: string, input: QuotaPolicyInput, actor: string) {
    return this.createPolicy(organizationId, { scope: "project", projectId }, input, actor);
  }

  /** A shared ceiling applies only to the projects listed, never to the whole organization implicitly. */
  async createSharedPolicy(organizationId: string, projectIds: string[], input: QuotaPolicyInput, actor: string) {
    return this.createPolicy(organizationId, { scope: "shared", projectIds }, input, actor);
  }

  async listPolicies(organizationId: string, projectId?: string) {
    return withTenant(this.prisma, { organizationId }, async (db) => {
      const covered = await db.cpQuotaPolicyProject.findMany({ where: { organizationId } });
      const policies = await db.cpQuotaPolicy.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } });
      return policies
        .map((policy) => ({
          ...policy,
          coveredProjectIds: covered.filter((row) => row.policyId === policy.id).map((row) => row.projectId),
        }))
        .filter((policy) => !projectId || policy.projectId === projectId || policy.coveredProjectIds.includes(projectId));
    });
  }

  async policyProject(organizationId: string, policyId: string) {
    return withTenant(this.prisma, { organizationId }, async (db) => {
      const policy = await db.cpQuotaPolicy.findFirst({ where: { id: policyId, organizationId } });
      if (!policy) throw new NotFoundError(`Quota policy '${policyId}' was not found`);
      return policy;
    });
  }

  async setPolicyStatus(organizationId: string, policyId: string, status: "active" | "disabled", actor: string) {
    const policy = await withTenant(this.prisma, { organizationId }, async (db) => {
      const existing = await db.cpQuotaPolicy.findFirst({ where: { id: policyId, organizationId } });
      if (!existing) throw new NotFoundError(`Quota policy '${policyId}' was not found`);
      return db.cpQuotaPolicy.update({ where: { id: policyId }, data: { status } });
    });
    await this.recordAudit(`control_plane.quota.${status}`, actor, policyId, policy.environmentKind, {});
    return policy;
  }

  async usageSummary(scope: EnvironmentScope, since: Date) {
    return withTenant(this.prisma, { organizationId: scope.organizationId }, async (db) => {
      const environment = await requireEnvironment(db, scope);
      const records = await db.cpUsageRecord.findMany({
        where: { organizationId: scope.organizationId, environmentId: environment.id, createdAt: { gte: since } },
        select: { applicationId: true, capability: true, action: true, outcome: true },
      });
      const totals = new Map<string, { applicationId: string; capability: string; action: string; admitted: number; completed: number; failed: number }>();
      for (const record of records) {
        const key = `${record.applicationId}|${record.action}`;
        const entry = totals.get(key) ?? { applicationId: record.applicationId, capability: record.capability, action: record.action, admitted: 0, completed: 0, failed: 0 };
        entry[record.outcome as "admitted" | "completed" | "failed"] += 1;
        totals.set(key, entry);
      }
      return { since: since.toISOString(), requests: records.length, byApplicationAction: [...totals.values()] };
    });
  }

  private async createPolicy(
    organizationId: string,
    target: { scope: "project"; projectId: string } | { scope: "shared"; projectIds: string[] },
    input: QuotaPolicyInput,
    actor: string,
  ) {
    if (input.capability && !isKnownCapability(input.capability)) throw new ValidationError(`Capability '${input.capability}' does not exist`);
    const policy = await withTenant(this.prisma, { organizationId }, async (db) => {
      const projectIds = target.scope === "project" ? [target.projectId] : target.projectIds;
      const found = await db.cpProject.count({ where: { organizationId, id: { in: projectIds } } });
      if (found !== new Set(projectIds).size) throw new NotFoundError("One or more projects were not found");
      const created = await db.cpQuotaPolicy.create({
        data: {
          id: newId("qp"),
          organizationId,
          scope: target.scope,
          projectId: target.scope === "project" ? target.projectId : null,
          environmentKind: input.environmentKind,
          capability: input.capability ?? null,
          windowSeconds: input.windowSeconds,
          maxRequests: input.maxRequests,
          mode: input.mode,
          createdBy: actor,
        },
      });
      if (target.scope === "shared") {
        await db.cpQuotaPolicyProject.createMany({
          data: [...new Set(target.projectIds)].map((projectId) => ({ organizationId, policyId: created.id, projectId })),
        });
      }
      return created;
    });
    await this.recordAudit("control_plane.quota.created", actor, policy.id, input.environmentKind, { scope: target.scope, ...input });
    return policy;
  }

  private async recordAudit(type: string, actor: string, resourceId: string, environment: string, payload: Record<string, unknown>) {
    await this.audit.record({
      type,
      actionFamily: type.includes(".plan.") ? "plan" : "quota",
      actor,
      resourceType: type.split(".")[1],
      resourceId,
      environment,
      severity: "info",
      message: type.replaceAll(".", " "),
      payload,
    });
  }
}

async function requireEnvironment(db: TenantDb, scope: EnvironmentScope) {
  const environment = await db.cpEnvironment.findFirst({
    where: { organizationId: scope.organizationId, projectId: scope.projectId, kind: scope.environmentKind },
  });
  if (!environment) throw new NotFoundError(`Project '${scope.projectId}' has no ${scope.environmentKind} environment`);
  return environment;
}
