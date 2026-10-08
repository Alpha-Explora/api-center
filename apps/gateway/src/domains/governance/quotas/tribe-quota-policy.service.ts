import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
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
      ],
    });

    const best = (level: TribeQuotaPolicy[]) =>
      [...level].sort(
        (left, right) =>
          this.specificityScore(right, input.scope, input.targetServiceId) -
          this.specificityScore(left, input.scope, input.targetServiceId),
      )[0] ?? null;

    return {
      project: input.projectId
        ? best(policies.filter((policy) => policy.projectId === input.projectId))
        : null,
      tribe: best(policies.filter((policy) => !policy.projectId)),
    };
  }

  async listPolicies(
    filter: { ownerTribeId?: string; projectId?: string } = {},
  ): Promise<TribeQuotaPolicy[]> {
    return this.quotaPrisma.quotaPolicy.findMany({
      where: {
        ...(filter.ownerTribeId ? { ownerTribeId: filter.ownerTribeId } : {}),
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
