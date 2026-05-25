import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import {
  CreateTribeQuotaPolicyInput,
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
  tribeApiQuotaPolicy: QuotaPolicyDelegate;
}

@Injectable()
export class TribeQuotaPolicyService {
  private readonly quotaPrisma: QuotaPolicyPrisma;

  constructor(prisma: PrismaService) {
    this.quotaPrisma = prisma as unknown as QuotaPolicyPrisma;
  }

  async resolvePolicy(
    input: ResolveTribeQuotaPolicyInput,
  ): Promise<TribeQuotaPolicy | null> {
    const policies = await this.quotaPrisma.tribeApiQuotaPolicy.findMany({
      where: {
        ownerTribeId: input.ownerTribeId,
        status: "active",
        OR: [
          {
            scope: input.scope,
            targetServiceId: input.targetServiceId ?? null,
          },
          { scope: input.scope, targetServiceId: null },
          { scope: "all", targetServiceId: null },
        ],
      },
      orderBy: [
        { targetServiceId: "desc" },
        { scope: "desc" },
        { updatedAt: "desc" },
      ],
    });

    return (
      [...policies].sort(
        (left, right) =>
          this.specificityScore(right, input.scope, input.targetServiceId) -
          this.specificityScore(left, input.scope, input.targetServiceId),
      )[0] ?? null
    );
  }

  async listPolicies(ownerTribeId?: string): Promise<TribeQuotaPolicy[]> {
    return this.quotaPrisma.tribeApiQuotaPolicy.findMany({
      where: {
        ...(ownerTribeId ? { ownerTribeId } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async listPoliciesForPortal(
    ownerTribeId: string,
  ): Promise<TribeQuotaPolicy[]> {
    return this.quotaPrisma.tribeApiQuotaPolicy.findMany({
      where: { ownerTribeId },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async createPolicy(
    input: CreateTribeQuotaPolicyInput,
  ): Promise<TribeQuotaPolicy> {
    return this.quotaPrisma.tribeApiQuotaPolicy.create({
      data: {
        ...input,
        mode: input.mode ?? "observe",
        status: "active",
      },
    });
  }

  async updatePolicy(
    policyId: string,
    input: UpdateTribeQuotaPolicyInput,
  ): Promise<TribeQuotaPolicy> {
    return this.quotaPrisma.tribeApiQuotaPolicy.update({
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
