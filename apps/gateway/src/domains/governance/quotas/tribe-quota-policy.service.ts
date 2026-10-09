import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { PLAN_DEFINITIONS } from "@entitlements/tribe-plan-definitions";
import {
  CreateTribeQuotaPolicyInput,
  ResolvedTribeQuotaPolicies,
  ResolveTribeQuotaPolicyInput,
  TribeQuotaPolicy,
  TribeQuotaScope,
  UpdateTribeQuotaPolicyInput,
} from "./tribe-quota-policy.types";

interface QuotaPolicyDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, string>>;
  }): Promise<TribeQuotaPolicy[]>;
  create(args: { data: Record<string, unknown> }): Promise<TribeQuotaPolicy>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<TribeQuotaPolicy>;
}

interface QuotaPolicyPrisma {
  quotaPolicy: QuotaPolicyDelegate;
  entitlementAssignment: {
    findFirst(args: { where: Record<string, unknown> }): Promise<{
      planKey: string;
    } | null>;
  };
}

@Injectable()
export class TribeQuotaPolicyService {
  private readonly quotaPrisma: QuotaPolicyPrisma;

  constructor(prisma: PrismaService) {
    this.quotaPrisma = prisma as unknown as QuotaPolicyPrisma;
  }

  /** The most specific active project budget and the most specific active tribe ceiling for a call. */
  async resolvePolicies(
    input: ResolveTribeQuotaPolicyInput,
  ): Promise<ResolvedTribeQuotaPolicies> {
    const policies = await this.quotaPrisma.quotaPolicy.findMany({
      where: {
        ownerTribeId: input.ownerTribeId,
        status: "active",
        AND: [
          {
            OR: [
              { projectId: null },
              ...(input.projectId ? [{ projectId: input.projectId }] : []),
            ],
          },
          {
            OR: [
              {
                scope: input.scope,
                targetServiceId: input.targetServiceId ?? null,
              },
              { scope: input.scope, targetServiceId: null },
              { scope: "all", targetServiceId: null },
            ],
          },
        ],
      },
      orderBy: [
        { targetServiceId: "desc" },
        { scope: "desc" },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
    });

    const best = (level: TribeQuotaPolicy[]) =>
      [...level].sort(
        (left, right) =>
          this.specificityScore(right, input.scope, input.targetServiceId) -
            this.specificityScore(left, input.scope, input.targetServiceId) ||
          comparePolicyRecency(left, right),
      )[0] ?? null;

    let project = input.projectId
      ? best(policies.filter((policy) => policy.projectId === input.projectId))
      : null;
    const needsPlanDefault =
      !project || (input.scope === "kafka_publish" && project.scope === "all");
    if (
      needsPlanDefault &&
      input.projectId &&
      isPlanEnvironment(input.environment)
    ) {
      const assignment = await this.quotaPrisma.entitlementAssignment.findFirst(
        {
          where: {
            ownerTribeId: input.ownerTribeId,
            projectId: input.projectId,
            environment: input.environment,
            status: "active",
          },
        },
      );
      const definition = PLAN_DEFINITIONS.find(
        (plan) => plan.planKey === assignment?.planKey,
      );
      const maxRequests =
        input.scope === "kafka_publish"
          ? definition?.kafkaPublishesPerDay
          : definition?.gatewayCallsPerDay;
      if (definition && maxRequests !== null && maxRequests !== undefined) {
        project = {
          ownerTribeId: input.ownerTribeId,
          projectId: input.projectId,
          scope: input.scope === "kafka_publish" ? "kafka_publish" : "all",
          targetServiceId: null,
          windowSeconds: 24 * 60 * 60,
          maxRequests,
          mode: "enforce",
          status: "active",
          reason: `Plan ${definition.planKey} default ${input.scope === "kafka_publish" ? "Kafka publish" : "gateway"} quota for ${input.environment}`,
        };
      }
    }

    return {
      project,
      tribe: best(policies.filter((policy) => !policy.projectId)),
    };
  }

  async listPolicies(
    filter: { ownerTribeId?: string; ownerTribeIds?: string[]; projectId?: string } = {},
  ): Promise<TribeQuotaPolicy[]> {
    return this.quotaPrisma.quotaPolicy.findMany({
      where: {
        ...(filter.ownerTribeIds
          ? { ownerTribeId: { in: filter.ownerTribeIds } }
          : filter.ownerTribeId
            ? { ownerTribeId: filter.ownerTribeId }
            : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  /** What a calling service sees: its project's budgets plus its tribe's ceilings. */
  async listPoliciesForPortal(
    ownerTribeId: string,
    projectId?: string,
  ): Promise<TribeQuotaPolicy[]> {
    return this.quotaPrisma.quotaPolicy.findMany({
      where: {
        ownerTribeId,
        OR: [{ projectId: null }, ...(projectId ? [{ projectId }] : [])],
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async createPolicy(
    input: CreateTribeQuotaPolicyInput,
  ): Promise<TribeQuotaPolicy> {
    return this.quotaPrisma.quotaPolicy.create({
      data: {
        ...input,
        projectId: input.projectId ?? null,
        mode: input.mode ?? "observe",
        status: "active",
      },
    });
  }

  async updatePolicy(
    policyId: string,
    input: UpdateTribeQuotaPolicyInput,
  ): Promise<TribeQuotaPolicy> {
    return this.quotaPrisma.quotaPolicy.update({
      where: { id: policyId },
      data: this.stripUndefined(input),
    });
  }

  async disablePolicy(
    policyId: string,
    input: { updatedBy?: string },
  ): Promise<TribeQuotaPolicy> {
    return this.updatePolicy(policyId, {
      status: "disabled",
      updatedBy: input.updatedBy,
    });
  }

  private specificityScore(
    policy: TribeQuotaPolicy,
    scope: TribeQuotaScope,
    targetServiceId?: string,
  ): number {
    if (
      targetServiceId &&
      policy.scope === scope &&
      policy.targetServiceId === targetServiceId
    ) {
      return 3;
    }

    if (policy.scope === scope && !policy.targetServiceId) {
      return 2;
    }

    if (policy.scope === "all" && !policy.targetServiceId) {
      return 1;
    }

    return 0;
  }

  private stripUndefined(
    input: UpdateTribeQuotaPolicyInput,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
  }
}

function comparePolicyRecency(left: TribeQuotaPolicy, right: TribeQuotaPolicy) {
  const updatedAtDifference =
    new Date(right.updatedAt ?? 0).getTime() -
    new Date(left.updatedAt ?? 0).getTime();
  if (updatedAtDifference !== 0 && Number.isFinite(updatedAtDifference)) {
    return updatedAtDifference;
  }
  return (right.id ?? "").localeCompare(left.id ?? "");
}

function isPlanEnvironment(
  environment: string | undefined,
): environment is "test" | "live" {
  return environment === "test" || environment === "live";
}
