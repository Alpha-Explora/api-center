import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuditEventsService } from "../../../../apps/gateway/src/analytics/audit-events.service";
import { ScopedAdminGuard } from "../../../../apps/gateway/src/auth/guards/scoped-admin.guard";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";
import { TribePlanAdminController } from "../../../../apps/gateway/src/entitlements/tribe-plan-admin.controller";
import { TribePlanService } from "../../../../apps/gateway/src/entitlements/tribe-plan.service";

describe("TribePlanAdminController", () => {
  const plans = {
    listPlanDefinitions: jest.fn(),
    listPlanAssignments: jest.fn(),
    assignPlan: jest.fn(),
    updatePlanAssignment: jest.fn(),
  };
  let auditEvents: { recordRequired: jest.Mock };
  let controller: TribePlanAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    auditEvents = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    controller = new TribePlanAdminController(
      plans as unknown as TribePlanService,
      auditEvents as unknown as AuditEventsService,
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
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "entitlement.assignment.created",
      actionFamily: "plan",
      actor: "platform",
      severity: "info",
      resourceType: "entitlement_assignment",
      resourceId: "assignment-1",
      environment: "test",
      correlationId: "corr-assign",
      message: "Plan standard assigned to campus-one",
      payload: {
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "test",
        correlationId: "corr-assign",
      },
    });
  });

  it("updates a plan assignment and records required audit evidence", async () => {
    plans.updatePlanAssignment.mockResolvedValue({
      id: "assignment-1",
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "prod",
      status: "disabled",
      effectiveAt: "2026-05-25T00:00:00.000Z",
      reason: "Retired service",
    });

    const response = await controller.updateAssignment(
      "assignment-1",
      { status: "disabled", reason: "Retired service" },
      {
        user: { tribeId: "platform" },
        correlationId: "corr-update",
      } as any,
    );

    expect(plans.updatePlanAssignment).toHaveBeenCalledWith({
      assignmentId: "assignment-1",
      status: "disabled",
      reason: "Retired service",
      updatedBy: "platform",
    });
    expect(response.data.status).toBe("disabled");
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "entitlement.assignment.updated",
      actionFamily: "plan",
      actor: "platform",
      resourceType: "entitlement_assignment",
      resourceId: "assignment-1",
      environment: "prod",
      correlationId: "corr-update",
      severity: "info",
      message: "Plan assignment assignment-1 updated",
      payload: {
        assignmentId: "assignment-1",
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "prod",
        status: "disabled",
        reason: "Retired service",
        correlationId: "corr-update",
      },
    });
  });

  it("fails closed when plan assignment update audit evidence cannot be written", async () => {
    plans.updatePlanAssignment.mockResolvedValue({
      id: "assignment-1",
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "prod",
      status: "disabled",
      effectiveAt: "2026-05-25T00:00:00.000Z",
      reason: "Retired service",
    });
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.updateAssignment(
        "assignment-1",
        { status: "disabled", reason: "Retired service" },
        { user: { tribeId: "platform" } } as any,
      ),
    ).rejects.toThrow("audit unavailable");
  });

  it("rejects incomplete assignment updates", async () => {
    await expect(
      controller.updateAssignment(
        "",
        { status: "disabled", reason: "" },
        {} as any,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("fails closed when plan assignment audit evidence cannot be written", async () => {
    plans.assignPlan.mockResolvedValue({
      assignment: { id: "assignment-1" },
      quotaProposals: [],
    });
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.assignPlan(
        {
          ownerTribeId: "campus-one",
          planKey: "standard",
          environment: "test",
          reason: "Initial rollout",
        },
        { user: { tribeId: "platform" } } as any,
      ),
    ).rejects.toThrow("audit unavailable");
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
