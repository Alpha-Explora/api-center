import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { ValidationError } from "@shared/errors";
import { PLAN_DEFINITIONS } from "./tribe-plan-definitions";
import {
  AssignTribePlanInput,
  AssignTribePlanResult,
  UpdateTribePlanAssignmentInput,
  ListTribePlanAssignmentsInput,
  TribePlanAssignment,
  TribePlanDefinition,
  TribePlanKey,
  EffectivePlanLimit,
} from "./tribe-plan.types";

const DAY_SECONDS = 24 * 60 * 60;

interface EntitlementAssignmentDelegate {
  create(args: { data: Record<string, unknown> }): Promise<TribePlanAssignment>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<TribePlanAssignment>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { createdAt: "desc" };
    take: number;
  }): Promise<TribePlanAssignment[]>;
}

interface PlanQuotaPolicy {
  id?: string;
  ownerTribeId: string;
  projectId: string | null;
  scope: string;
  targetServiceId: string | null;
  maxRequests: number;
  windowSeconds: number;
  mode: "observe" | "enforce";
  reason: string;
  status: string;
  updatedAt?: Date | string;
}

interface TribePlanPrisma {
  entitlementAssignment: EntitlementAssignmentDelegate;
  quotaPolicy: {
    findMany(args: {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, string>>;
    }): Promise<PlanQuotaPolicy[]>;
  };
  $transaction<T>(
    callback: (
      transaction: Pick<TribePlanPrisma, "entitlementAssignment">,
    ) => Promise<T>,
  ): Promise<T>;
}

@Injectable()
export class TribePlanService {
  private readonly planPrisma: TribePlanPrisma;

  constructor(prisma: PrismaService) {
    this.planPrisma = prisma as unknown as TribePlanPrisma;
  }

  listPlanDefinitions(): TribePlanDefinition[] {
    return PLAN_DEFINITIONS;
  }

  async listPlanAssignments(
    input: ListTribePlanAssignmentsInput = {},
  ): Promise<TribePlanAssignment[]> {
    const where: Record<string, unknown> = {};
    if (input.ownerTribeIds) {
      const ownerTribeIds = input.ownerTribeId
        ? input.ownerTribeIds.filter((id) => id === input.ownerTribeId)
        : input.ownerTribeIds;
      where.ownerTribeId = { in: ownerTribeIds };
    } else if (input.ownerTribeId) {
      where.ownerTribeId = input.ownerTribeId;
    }
    if (input.projectId) where.projectId = input.projectId;
    if (input.planKey) where.planKey = input.planKey;
    if (input.environment) where.environment = input.environment;
    if (input.status) where.status = input.status;

    const assignments = await this.planPrisma.entitlementAssignment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return this.enrichAssignments(assignments);
  }

  async assignPlan(
    input: AssignTribePlanInput,
  ): Promise<AssignTribePlanResult> {
    this.definitionFor(input.planKey);
    const now = new Date();
    const effectiveAt = input.effectiveAt ?? now;
    if (!Number.isFinite(effectiveAt.getTime())) {
      throw new ValidationError("effectiveAt must be a valid date");
    }
    if (effectiveAt.getTime() > now.getTime()) {
      throw new ValidationError("effectiveAt cannot be in the future");
    }
    const assignment = await this.planPrisma.$transaction(
      async (transaction) => {
        await transaction.entitlementAssignment.updateMany({
          where: {
            ownerTribeId: input.ownerTribeId,
            projectId: input.projectId,
            environment: input.environment,
            status: "active",
          },
          data: {
            status: "archived",
          },
        });
        return transaction.entitlementAssignment.create({
          data: {
            ownerTribeId: input.ownerTribeId,
            projectId: input.projectId,
            planKey: input.planKey,
            environment: input.environment,
            status: "active",
            effectiveAt,
            reason: input.reason,
            assignedBy: input.assignedBy,
          },
        });
      },
    );

    const [enrichedAssignment] = await this.enrichAssignments([assignment]);
    return { assignment: enrichedAssignment };
  }

  async updatePlanAssignment(
    input: UpdateTribePlanAssignmentInput,
  ): Promise<TribePlanAssignment> {
    if (!input.assignmentId.trim()) {
      throw new ValidationError("assignmentId is required");
    }

    return this.planPrisma.entitlementAssignment.update({
      where: { id: input.assignmentId },
      data: {
        status: input.status,
        reason: input.reason,
      },
    });
  }

  private definitionFor(planKey: TribePlanKey) {
    const definition = PLAN_DEFINITIONS.find(
      (plan) => plan.planKey === planKey,
    );
    if (!definition) {
      throw new ValidationError(`Unknown tribe plan: ${planKey}`);
    }
    return definition;
  }

  private async enrichAssignments(
    assignments: TribePlanAssignment[],
  ): Promise<TribePlanAssignment[]> {
    const policies = assignments.length
      ? await this.planPrisma.quotaPolicy.findMany({
          where: {
            status: "active",
            OR: assignments.map(({ ownerTribeId, projectId }) => ({
              ownerTribeId,
              projectId,
            })),
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        })
      : [];
    return assignments.map((assignment) => ({
      ...assignment,
      effectiveLimits: this.effectiveLimits(assignment, policies),
    }));
  }

  private effectiveLimits(
    assignment: TribePlanAssignment,
    allPolicies: PlanQuotaPolicy[],
  ): EffectivePlanLimit[] {
    if (assignment.status !== "active") return [];
    const definition = this.definitionFor(assignment.planKey);
    const policies = allPolicies
      .filter(
        (policy) =>
          policy.ownerTribeId === assignment.ownerTribeId &&
          policy.projectId === assignment.projectId &&
          policy.status === "active",
      )
      .sort(comparePolicyRecency);
    const defaults = [
      { scope: "all" as const, maxRequests: definition.gatewayCallsPerDay },
      {
        scope: "kafka_publish" as const,
        maxRequests: definition.kafkaPublishesPerDay,
      },
    ];
    const baseLimits = defaults.map(({ scope, maxRequests }) => {
      const override = policies.filter(
        (policy) => !policy.targetServiceId && policy.scope === scope,
      )[0];
      return override
        ? {
            scope,
            maxRequests: override.maxRequests,
            windowSeconds: override.windowSeconds,
            mode: override.mode,
            source: "override" as const,
            policyId: override.id,
            reason: override.reason,
          }
        : {
            scope,
            maxRequests,
            windowSeconds: maxRequests === null ? null : DAY_SECONDS,
            mode: "enforce" as const,
            source: "plan" as const,
          };
    });
    const targetedOverrides = policies
      .filter((policy) => Boolean(policy.targetServiceId))
      .filter(
        (policy, index, matching) =>
          matching.findIndex(
            (candidate) =>
              candidate.scope === policy.scope &&
              candidate.targetServiceId === policy.targetServiceId,
          ) === index,
      )
      .map((policy) => ({
        scope: policy.scope as EffectivePlanLimit["scope"],
        targetServiceId: policy.targetServiceId ?? undefined,
        maxRequests: policy.maxRequests,
        windowSeconds: policy.windowSeconds,
        mode: policy.mode,
        source: "override" as const,
        policyId: policy.id,
        reason: policy.reason,
      }));
    return [...baseLimits, ...targetedOverrides];
  }
}

function comparePolicyRecency(left: PlanQuotaPolicy, right: PlanQuotaPolicy) {
  const updatedAtDifference =
    new Date(right.updatedAt ?? 0).getTime() -
    new Date(left.updatedAt ?? 0).getTime();
  if (updatedAtDifference !== 0 && Number.isFinite(updatedAtDifference)) {
    return updatedAtDifference;
  }
  return (right.id ?? "").localeCompare(left.id ?? "");
}
