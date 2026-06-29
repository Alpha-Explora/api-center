import { TribePlanService } from "../../../../src/entitlements/tribe-plan.service";

describe("TribePlanService", () => {
  const assignments = {
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  };
  const prisma = {
    entitlementAssignment: assignments,
  };
  let service: TribePlanService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TribePlanService(prisma as any);
  });

  it("defines the first-pass tribe plan tiers", () => {
    expect(service.listPlanDefinitions()).toEqual([
      expect.objectContaining({
        planKey: "starter",
        gatewayCallsPerDay: 1_000,
        kafkaPublishesPerDay: 100,
        retentionTier: "standard",
      }),
      expect.objectContaining({
        planKey: "standard",
        gatewayCallsPerDay: 25_000,
        kafkaPublishesPerDay: 5_000,
        sharedServiceAccess: "live-after-approval",
      }),
      expect.objectContaining({
        planKey: "pro",
        gatewayCallsPerDay: 250_000,
        kafkaPublishesPerDay: 50_000,
        supportTier: "priority",
      }),
      expect.objectContaining({
        planKey: "enterprise",
        gatewayCallsPerDay: null,
        kafkaPublishesPerDay: null,
      }),
    ]);
  });

  it("assigns a plan and returns observe-mode quota proposals", async () => {
    assignments.create.mockResolvedValue({
      id: "assignment-1",
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "test",
      status: "active",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Initial rollout",
      assignedBy: "platform",
      createdAt: new Date("2026-05-25T00:00:00.000Z"),
      updatedAt: new Date("2026-05-25T00:00:00.000Z"),
    });

    const result = await service.assignPlan({
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "test",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Initial rollout",
      assignedBy: "platform",
    });

    expect(assignments.create).toHaveBeenCalledWith({
      data: {
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "test",
        status: "active",
        effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
        reason: "Initial rollout",
        assignedBy: "platform",
      },
    });
    expect(result.quotaProposals).toEqual([
      {
        ownerTribeId: "campus-one",
        scope: "all",
        targetServiceId: null,
        windowSeconds: 86400,
        maxRequests: 25_000,
        mode: "observe",
        reason: "Plan standard default gateway quota for test",
      },
      {
        ownerTribeId: "campus-one",
        scope: "kafka_publish",
        targetServiceId: null,
        windowSeconds: 86400,
        maxRequests: 5_000,
        mode: "observe",
        reason: "Plan standard default Kafka publish quota for test",
      },
    ]);
  });

  it("updates a plan assignment status", async () => {
    assignments.update.mockResolvedValue({
      id: "assignment-1",
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "prod",
      status: "disabled",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Retired service",
      assignedBy: "platform",
    });

    const result = await service.updatePlanAssignment({
      assignmentId: "assignment-1",
      status: "disabled",
      reason: "Retired service",
      updatedBy: "platform",
    });

    expect(assignments.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: {
        status: "disabled",
        reason: "Retired service",
        assignedBy: "platform",
      },
    });
    expect(result.status).toBe("disabled");
  });

  it("rejects plan assignment updates without an assignment id", async () => {
    await expect(
      service.updatePlanAssignment({
        assignmentId: "",
        status: "disabled",
        reason: "Retired service",
        updatedBy: "platform",
      }),
    ).rejects.toThrow("assignmentId is required");
  });

  it("lists recent plan assignments for management views", async () => {
    assignments.findMany.mockResolvedValue([
      {
        id: "assignment-1",
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "prod",
        status: "active",
        effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
        reason: "Production rollout",
      },
    ]);

    const result = await service.listPlanAssignments({
      environment: "prod",
      status: "active",
    });

    expect(assignments.findMany).toHaveBeenCalledWith({
      where: {
        environment: "prod",
        status: "active",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    expect(result).toHaveLength(1);
  });
});
