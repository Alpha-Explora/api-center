import { TribePlanService } from "../../../../apps/gateway/src/domains/governance/entitlements/tribe-plan.service";

describe("TribePlanService", () => {
  const assignments = {
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    findMany: jest.fn(),
  };
  const quotaPolicy = { findMany: jest.fn() };
  const prisma = {
    entitlementAssignment: assignments,
    quotaPolicy,
    $transaction: jest.fn((callback: (transaction: unknown) => unknown) =>
      callback({ entitlementAssignment: assignments }),
    ),
  };
  let service: TribePlanService;

  beforeEach(() => {
    jest.clearAllMocks();
    quotaPolicy.findMany.mockResolvedValue([]);
    assignments.updateMany.mockResolvedValue({ count: 0 });
    service = new TribePlanService(prisma as any);
  });

  it("keeps the plan catalogue in code", () => {
    expect(service.listPlanDefinitions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          planKey: "starter",
          gatewayCallsPerDay: 1_000,
          kafkaPublishesPerDay: 100,
        }),
        expect.objectContaining({
          planKey: "enterprise",
          gatewayCallsPerDay: null,
          kafkaPublishesPerDay: null,
        }),
      ]),
    );
  });

  it("archives the active assignment and inserts its replacement in one transaction", async () => {
    const oldAssignment = {
      status: "active",
      reason: "Original assignment reason",
      assignedBy: "original-operator",
    };
    assignments.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(oldAssignment, data);
      return { count: 1 };
    });
    assignments.create.mockResolvedValue({
      id: "assignment-new",
      ownerTribeId: "campus-one",
      projectId: "campus-lms",
      planKey: "standard",
      environment: "test",
      status: "active",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Plan upgrade",
      assignedBy: "platform",
    });

    const result = await service.assignPlan({
      projectId: "campus-lms",
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "test",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Plan upgrade",
      assignedBy: "platform",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(assignments.updateMany).toHaveBeenCalledWith({
      where: {
        ownerTribeId: "campus-one",
        projectId: "campus-lms",
        environment: "test",
        status: "active",
      },
      data: {
        status: "archived",
      },
    });
    expect(oldAssignment).toEqual({
      status: "archived",
      reason: "Original assignment reason",
      assignedBy: "original-operator",
    });
    expect(assignments.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: "campus-lms",
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "test",
        status: "active",
      }),
    });
    expect(result.assignment).toMatchObject({
      id: "assignment-new",
      effectiveLimits: [
        {
          scope: "all",
          maxRequests: 25_000,
          windowSeconds: 86_400,
          mode: "enforce",
          source: "plan",
        },
        {
          scope: "kafka_publish",
          maxRequests: 5_000,
          windowSeconds: 86_400,
          mode: "enforce",
          source: "plan",
        },
      ],
    });
  });

  it("reports active explicit project quota policies as the effective override", async () => {
    assignments.findMany.mockResolvedValue([
      {
        id: "assignment-1",
        ownerTribeId: "campus-one",
        projectId: "campus-lms",
        planKey: "standard",
        environment: "live",
        status: "active",
        effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
        reason: "Production rollout",
      },
    ]);
    quotaPolicy.findMany.mockResolvedValue([
      {
        id: "policy-1",
        ownerTribeId: "campus-one",
        projectId: "campus-lms",
        scope: "all",
        targetServiceId: null,
        maxRequests: 800,
        windowSeconds: 3600,
        mode: "enforce",
        status: "active",
        reason: "Approved capacity exception",
      },
    ]);

    const [assignment] = await service.listPlanAssignments({
      projectId: "campus-lms",
      environment: "live",
      status: "active",
    });

    expect(assignment.effectiveLimits).toEqual([
      expect.objectContaining({
        scope: "all",
        maxRequests: 800,
        windowSeconds: 3600,
        mode: "enforce",
        source: "override",
        policyId: "policy-1",
        reason: "Approved capacity exception",
      }),
      expect.objectContaining({
        scope: "kafka_publish",
        maxRequests: 5_000,
        source: "plan",
      }),
    ]);
    expect(quotaPolicy.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [{ ownerTribeId: "campus-one", projectId: "campus-lms" }],
      },
    });
  });

  it("archives an assignment when it is explicitly retired", async () => {
    assignments.update.mockResolvedValue({
      id: "assignment-1",
      ownerTribeId: "campus-one",
      projectId: "campus-lms",
      planKey: "standard",
      environment: "live",
      status: "archived",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Retired service",
      assignedBy: "platform",
    });

    const result = await service.updatePlanAssignment({
      assignmentId: "assignment-1",
      status: "archived",
      reason: "Retired service",
      updatedBy: "platform",
    });

    expect(assignments.update).toHaveBeenCalledWith({
      where: { id: "assignment-1" },
      data: {
        status: "archived",
        reason: "Retired service",
        assignedBy: "platform",
      },
    });
    expect(result.status).toBe("archived");
  });

  it("does not expose effective limits on archived assignments", async () => {
    assignments.findMany.mockResolvedValue([
      {
        id: "assignment-old",
        ownerTribeId: "campus-one",
        projectId: "campus-lms",
        planKey: "starter",
        environment: "test",
        status: "archived",
      },
    ]);

    const [assignment] = await service.listPlanAssignments();
    expect(assignment.effectiveLimits).toEqual([]);
  });
});
