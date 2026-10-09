import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ScopedAdminGuard } from "../../../../apps/gateway/src/domains/auth-security/auth/guards/scoped-admin.guard";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";
import { TribePlanAdminController } from "../../../../apps/gateway/src/domains/governance/entitlements/tribe-plan-admin.controller";
import { TribePlanService } from "../../../../apps/gateway/src/domains/governance/entitlements/tribe-plan.service";
import type { TenancyDirectory } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.types";

const tenancy: TenancyDirectory = {
  getTribe: jest.fn(),
  resolveProject: jest.fn((projectId: string) =>
    projectId === "campus-lms"
      ? ({
          tribe: {
            tribeId: "campus-one",
            name: "Campus One",
            status: "active",
          },
          project: {
            projectId,
            tribeId: "campus-one",
            name: "LMS",
            status: "active",
          },
        } as never)
      : null,
  ),
  requireActiveProject: jest.fn(),
  resolveServicePlacement: jest.fn(),
};

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
      tenancy,
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
        environment: "live",
        status: "active",
      },
    ]);

    const response = await controller.listAssignments(
      { environment: "live", status: "active" },
      {
        correlationId: "corr-assignments",
      } as any,
    );

    expect(plans.listPlanAssignments).toHaveBeenCalledWith({
      environment: "live",
      status: "active",
    });
    expect(response.data).toEqual([
      expect.objectContaining({ ownerTribeId: "campus-one" }),
    ]);
  });

  it("creates a plan assignment without generated quota proposals", async () => {
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
    });

    const response = await controller.assignPlan(
      {
        projectId: "campus-lms",
        planKey: "standard",
        environment: "test",
        effectiveAt: "2026-05-25T00:00:00.000Z",
        reason: "Initial rollout",
      },
      {
        user: { sub: "platform" },
        correlationId: "corr-assign",
      } as any,
    );

    expect(plans.assignPlan).toHaveBeenCalledWith({
      projectId: "campus-lms",
      ownerTribeId: "campus-one",
      planKey: "standard",
      environment: "test",
      effectiveAt: new Date("2026-05-25T00:00:00.000Z"),
      reason: "Initial rollout",
      assignedBy: "platform",
    });
    expect(response.data).not.toHaveProperty("quotaProposals");
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "entitlement.assignment.created",
      actionFamily: "plan",
      actor: "platform",
      severity: "info",
      resourceType: "entitlement_assignment",
      resourceId: "assignment-1",
      environment: "test",
      correlationId: "corr-assign",
      message: "Plan standard assigned to project campus-lms",
      payload: {
        ownerTribeId: "campus-one",
        projectId: "campus-lms",
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
      projectId: "campus-lms",
      planKey: "standard",
      environment: "live",
      status: "archived",
      effectiveAt: "2026-05-25T00:00:00.000Z",
      reason: "Retired service",
    });

    const response = await controller.updateAssignment(
      "assignment-1",
      { status: "archived", reason: "Retired service" },
      {
        user: { sub: "platform" },
        correlationId: "corr-update",
      } as any,
    );

    expect(plans.updatePlanAssignment).toHaveBeenCalledWith({
      assignmentId: "assignment-1",
      status: "archived",
      reason: "Retired service",
      updatedBy: "platform",
    });
    expect(response.data.status).toBe("archived");
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "entitlement.assignment.updated",
      actionFamily: "plan",
      actor: "platform",
      resourceType: "entitlement_assignment",
      resourceId: "assignment-1",
      environment: "live",
      correlationId: "corr-update",
      severity: "info",
      message: "Plan assignment assignment-1 updated",
      payload: {
        assignmentId: "assignment-1",
        ownerTribeId: "campus-one",
        projectId: "campus-lms",
        planKey: "standard",
        environment: "live",
        status: "archived",
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
      environment: "live",
      status: "archived",
      effectiveAt: "2026-05-25T00:00:00.000Z",
      reason: "Retired service",
    });
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.updateAssignment(
        "assignment-1",
        { status: "archived", reason: "Retired service" },
        { user: { tribeId: "platform" } } as any,
      ),
    ).rejects.toThrow("audit unavailable");
  });

  it("rejects incomplete assignment updates", async () => {
    await expect(
      controller.updateAssignment(
        "",
        { status: "archived", reason: "" },
        {} as any,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("fails closed when plan assignment audit evidence cannot be written", async () => {
    plans.assignPlan.mockResolvedValue({
      assignment: { id: "assignment-1" },
    });
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.assignPlan(
        {
          projectId: "campus-lms",
          planKey: "standard",
          environment: "test",
          reason: "Initial rollout",
        },
        { user: { sub: "platform" } } as any,
      ),
    ).rejects.toThrow("audit unavailable");
  });

  it("rejects incomplete assignments", async () => {
    await expect(
      controller.assignPlan(
        {
          projectId: "",
          planKey: "standard",
          environment: "test",
          reason: "",
        },
        {} as any,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects tribe-level assignments and unknown projects", async () => {
    await expect(
      controller.assignPlan(
        {
          ownerTribeId: "campus-one",
          planKey: "standard",
          environment: "test",
          reason: "x",
        },
        {} as any,
      ),
    ).rejects.toThrow("Plans are assigned to projects");
    await expect(
      controller.assignPlan(
        {
          projectId: "missing",
          planKey: "standard",
          environment: "test",
          reason: "x",
        },
        {} as any,
      ),
    ).rejects.toThrow("Project 'missing' is not registered");
    expect(plans.assignPlan).not.toHaveBeenCalled();
  });
});
