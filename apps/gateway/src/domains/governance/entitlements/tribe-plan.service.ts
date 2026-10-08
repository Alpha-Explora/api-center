import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { ValidationError } from "@shared/errors";
import {
  AssignTribePlanInput,
  AssignTribePlanResult,
  UpdateTribePlanAssignmentInput,
  GeneratedQuotaPolicyProposal,
  ListTribePlanAssignmentsInput,
  TribePlanAssignment,
  TribePlanDefinition,
  TribePlanKey,
} from "./tribe-plan.types";

const DAY_SECONDS = 24 * 60 * 60;

const PLAN_DEFINITIONS: TribePlanDefinition[] = [
  {
    planKey: "starter",
    displayName: "Starter",
    gatewayCallsPerDay: 1_000,
    kafkaPublishesPerDay: 100,
    retentionTier: "standard",
    sharedServiceAccess: "test-only-provider-impacting-smoke",
    supportTier: "standard",
  },
  {
    planKey: "standard",
    displayName: "Standard",
    gatewayCallsPerDay: 25_000,
    kafkaPublishesPerDay: 5_000,
    retentionTier: "standard",
    sharedServiceAccess: "live-after-approval",
    supportTier: "standard",
  },
  {
    planKey: "pro",
    displayName: "Pro",
    gatewayCallsPerDay: 250_000,
    kafkaPublishesPerDay: 50_000,
    retentionTier: "extended",
    sharedServiceAccess: "live",
    supportTier: "priority",
  },
  {
    planKey: "enterprise",
    displayName: "Enterprise",
    gatewayCallsPerDay: null,
    kafkaPublishesPerDay: null,
    retentionTier: "custom",
    sharedServiceAccess: "custom",
    supportTier: "dedicated",
  },
];

interface EntitlementAssignmentDelegate {
  create(args: { data: Record<string, unknown> }): Promise<TribePlanAssignment>;
  update(args: {
    where: { id: string };
    data: Record<string, unknown>;
  }): Promise<TribePlanAssignment>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy: { createdAt: "desc" };
    take: number;
  }): Promise<TribePlanAssignment[]>;
}

interface TribePlanPrisma {
  entitlementAssignment: EntitlementAssignmentDelegate;
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
    if (input.ownerTribeId) where.ownerTribeId = input.ownerTribeId;
    if (input.projectId) where.projectId = input.projectId;
    if (input.planKey) where.planKey = input.planKey;
    if (input.environment) where.environment = input.environment;
    if (input.status) where.status = input.status;

    return this.planPrisma.entitlementAssignment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async assignPlan(
    input: AssignTribePlanInput,
  ): Promise<AssignTribePlanResult> {
    const definition = this.definitionFor(input.planKey);
    const effectiveAt = input.effectiveAt ?? new Date();
    const assignment = await this.planPrisma.entitlementAssignment.create({
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

    return {
      assignment,
      quotaProposals: this.buildQuotaProposals(definition, input),
    };
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
        assignedBy: input.updatedBy,
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

  private buildQuotaProposals(
    definition: TribePlanDefinition,
    input: AssignTribePlanInput,
  ): GeneratedQuotaPolicyProposal[] {
    const proposals: GeneratedQuotaPolicyProposal[] = [];

    if (definition.gatewayCallsPerDay !== null) {
      proposals.push({
        ownerTribeId: input.ownerTribeId,
        projectId: input.projectId,
        scope: "all",
        targetServiceId: null,
        windowSeconds: DAY_SECONDS,
        maxRequests: definition.gatewayCallsPerDay,
        mode: "observe",
        reason: `Plan ${definition.planKey} default gateway quota for ${input.environment}`,
      });
    }

    if (definition.kafkaPublishesPerDay !== null) {
      proposals.push({
        ownerTribeId: input.ownerTribeId,
        projectId: input.projectId,
        scope: "kafka_publish",
        targetServiceId: null,
        windowSeconds: DAY_SECONDS,
        maxRequests: definition.kafkaPublishesPerDay,
        mode: "observe",
        reason: `Plan ${definition.planKey} default Kafka publish quota for ${input.environment}`,
      });
    }

    return proposals;
  }
}
