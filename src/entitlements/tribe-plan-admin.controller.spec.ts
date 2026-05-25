import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { ValidationError } from "../shared/errors";
import { TribePlanAdminController } from "./tribe-plan-admin.controller";
import { TribePlanService } from "./tribe-plan.service";

describe("TribePlanAdminController", () => {
  const plans = {
    listPlanDefinitions: jest.fn(),
    listPlanAssignments: jest.fn(),
    assignPlan: jest.fn(),
  };
  let controller: TribePlanAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TribePlanAdminController(
      plans as unknown as TribePlanService,
    );
  });

  it("requires platform admin scope", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TribePlanAdminController,
    );

    expect(guards).toContain(ScopedAdminGuard);
  });

  it("returns plan definitions", () => {
    plans.listPlanDefinitions.mockReturnValue([
      { planKey: "starter", displayName: "Starter" },
    ]);

    const response = controller.listDefinitions({
      correlationId: "corr-plan",
    } as any);

    expect(response.data).toEqual([
      { planKey: "starter", displayName: "Starter" },
    ]);
    expect(response.meta.correlationId).toBe("corr-plan");
  });

  it("returns plan assignments with optional filters", async () => {
    plans.listPlanAssignments.mockResolvedValue([
      {
        id: "assignment-1",
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "prod",
        status: "active",
      },
    ]);

    const response = await controller.listAssignments(
      { environment: "prod", status: "active" },
      {
        correlationId: "corr-assignments",
      } as any,
    );

    expect(plans.listPlanAssignments).toHaveBeenCalledWith({
      environment: "prod",
      status: "active",
    });
    expect(response.data).toEqual([
      expect.objectContaining({ ownerTribeId: "campus-one" }),
    ]);
  });

  it("creates a plan assignment and includes generated quota proposals", async () => {
    plans.assignPlan.mockResolvedValue({
      assignment: {
        id: "assignment-1",
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "test",
        status: "active",
        effectiveAt: "2026-05-25T00:00:00.000Z",
        reason: "Initial rollout",
      },
      quotaProposals: [
        {
          ownerTribeId: "campus-one",
          scope: "all",
          targetServiceId: null,
          windowSeconds: 86400,
          maxRequests: 25_000,
          mode: "observe",
          reason: "Plan standard default gateway quota for test",
        },
      ],
    });

    const response = await controller.assignPlan(
      {
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "test",
        effectiveAt: "2026-05-25T00:00:00.000Z",
        reason: "Initial rollout",
      },
      {
        user: { tribeId: "platform" },
        correlationId: "corr-assign",
      } as any,
    );

    expect(plans.assignPlan).toHaveBeenCalledWith({
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "test",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Initial rollout",
      assignedBy: "platform",
    });
    expect(response.data.quotaProposals).toHaveLength(1);
  });

  it("rejects incomplete assignments", async () => {
    await expect(
      controller.assignPlan(
        {
          ownerTribeId: "",
          planKey: "standard",
          environment: "test",
          reason: "",
        },
        {} as any,
      ),
    ).rejects.toThrow(ValidationError);
  });
});
