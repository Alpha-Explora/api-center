import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ScopedAdminGuard } from "../../../../apps/gateway/src/domains/auth-security/auth/guards/scoped-admin.guard";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ValidationError } from "../../../../apps/gateway/src/shared/errors";
import { TribeQuotaAdminController } from "../../../../apps/gateway/src/domains/governance/quotas/tribe-quota-admin.controller";
import { TribeQuotaPolicyService } from "../../../../apps/gateway/src/domains/governance/quotas/tribe-quota-policy.service";
import type { TenancyDirectory } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.types";

const tenancy: TenancyDirectory = {
  getTribe: jest.fn((tribeId: string) =>
    tribeId === "campus-one" ? ({ tribeId, name: "Campus One", status: "active" } as never) : null,
  ),
  resolveProject: jest.fn((projectId: string) =>
    projectId === "campus-lms"
      ? ({
          tribe: { tribeId: "campus-one", name: "Campus One", status: "active" },
          project: { projectId, tribeId: "campus-one", name: "LMS", status: "active" },
        } as never)
      : null,
  ),
  requireActiveProject: jest.fn(),
  resolveServicePlacement: jest.fn(),
};

describe("TribeQuotaAdminController", () => {
  const policies = {
    listPolicies: jest.fn(),
    createPolicy: jest.fn(),
    updatePolicy: jest.fn(),
    disablePolicy: jest.fn(),
  };
  const approvals = {
    assertApprovedForAction: jest.fn(),
  };

  let auditEvents: { recordRequired: jest.Mock };
  let controller: TribeQuotaAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    auditEvents = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    controller = new TribeQuotaAdminController(
      policies as unknown as TribeQuotaPolicyService,
      approvals as any,
      tenancy,
      auditEvents as unknown as AuditEventsService,
    );
  });

  it("requires platform admin scope to create a quota policy", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TribeQuotaAdminController,
    );

    expect(guards).toContain(ScopedAdminGuard);
  });

  it("rejects invalid quota windows and max requests", async () => {
    await expect(
      controller.createPolicy(
        {
          ownerTribeId: "campus-one",
          scope: "shared",
          windowSeconds: 0,
          maxRequests: 0,
          mode: "observe",
          reason: "invalid",
        },
        { user: { tribeId: "platform", scopes: ["platform:admin"] } } as any,
      ),
    ).rejects.toThrow(ValidationError);

    expect(policies.createPolicy).not.toHaveBeenCalled();
  });

  it("disables a policy instead of deleting it", async () => {
    policies.disablePolicy.mockResolvedValue(policy({ status: "disabled" }));

    const response = await controller.deletePolicy("quota-policy-1", {
      user: { sub: "platform", scopes: ["platform:admin"] },
      correlationId: "corr-admin",
    } as any);

    expect(policies.disablePolicy).toHaveBeenCalledWith("quota-policy-1", {
      updatedBy: "platform",
    });
    expect(response.data).toMatchObject({
      id: "quota-policy-1",
      status: "disabled",
    });
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "quota.policy.disabled",
      actionFamily: "quota",
      actor: "platform",
      severity: "info",
      resourceType: "quota_policy",
      resourceId: "quota-policy-1",
      environment: "live",
      correlationId: "corr-admin",
      message: "Quota policy updated for campus-one",
      payload: {
        ownerTribeId: "campus-one",
        correlationId: "corr-admin",
        mode: "observe",
        policyId: "quota-policy-1",
      },
    });
  });

  it("fails closed when quota policy audit evidence cannot be written", async () => {
    policies.disablePolicy.mockResolvedValue(policy({ status: "disabled" }));
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.deletePolicy("quota-policy-1", {
        user: { tribeId: "platform", scopes: ["platform:admin"] },
        correlationId: "corr-admin",
      } as any),
    ).rejects.toThrow("audit unavailable");
  });

  it("returns safe policy metadata when listing policies", async () => {
    policies.listPolicies.mockResolvedValue([
      policy({ createdBy: "operator", providerCredential: "secret" }),
    ]);

    const response = await controller.listPolicies("campus-one", undefined, {
      correlationId: "corr-list",
    } as any);

    expect(policies.listPolicies).toHaveBeenCalledWith({ ownerTribeId: "campus-one", projectId: undefined });
    expect(response.data[0]).toEqual({
      id: "quota-policy-1",
      ownerTribeId: "campus-one",
      projectId: null,
      level: "tribe",
      scope: "shared",
      targetServiceId: "payment-service",
      windowSeconds: 60,
      maxRequests: 100,
      burstRequests: null,
      mode: "observe",
      status: "active",
      reason: "rollout observation",
      updatedAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("requires approval before creating an enforced quota policy", async () => {
    policies.createPolicy.mockResolvedValue(policy({ mode: "enforce" }));
    const guardedController = new TribeQuotaAdminController(
      policies as unknown as TribeQuotaPolicyService,
      approvals as any,
      tenancy,
      auditEvents as unknown as AuditEventsService,
    );

    await guardedController.createPolicy(
      {
        ownerTribeId: "campus-one",
        scope: "all",
        windowSeconds: 86400,
        maxRequests: 25000,
        mode: "enforce",
        reason: "Go live enforcement",
        approvalRequestId: "approval-1",
      },
      { user: { sub: "platform" } } as any,
    );

    expect(approvals.assertApprovedForAction).toHaveBeenCalledWith({
      approvalRequestId: "approval-1",
      actionType: "quota.enforce",
      targetEnvironment: "live",
      targetId: "campus-one",
    });
    expect(policies.createPolicy).toHaveBeenCalledWith(
      expect.not.objectContaining({ approvalRequestId: expect.anything() }),
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "quota.policy.created",
        actionFamily: "quota",
        actor: "platform",
        payload: expect.objectContaining({
          ownerTribeId: "campus-one",
          mode: "enforce",
          policyId: "quota-policy-1",
        }),
      }),
    );
  });

  it("fails closed when enforce mode is requested without approval service", async () => {
    const unguardedController = new TribeQuotaAdminController(
      policies as unknown as TribeQuotaPolicyService,
      undefined as never,
      tenancy,
    );

    await expect(
      unguardedController.createPolicy(
        {
          ownerTribeId: "campus-one",
          scope: "all",
          windowSeconds: 86400,
          maxRequests: 25000,
          mode: "enforce",
          reason: "Live enforcement",
          approvalRequestId: "approval-1",
        },
        { user: { tribeId: "platform" } } as any,
      ),
    ).rejects.toThrow("ApprovalRequestService is required");

    expect(policies.createPolicy).not.toHaveBeenCalled();
  });

  it("creates a project budget whose tribe comes from the project", async () => {
    policies.createPolicy.mockResolvedValue(policy({ projectId: "campus-lms" }));

    const response = await controller.createPolicy(
      {
        projectId: "campus-lms",
        scope: "all",
        windowSeconds: 60,
        maxRequests: 500,
        mode: "observe",
        reason: "LMS budget",
      } as never,
      { user: { sub: "platform" } } as any,
    );

    expect(policies.createPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ownerTribeId: "campus-one", projectId: "campus-lms" }),
    );
    expect(response.data).toMatchObject({ projectId: "campus-lms", level: "project" });
  });

  it("rejects a project budget whose ownerTribeId disagrees with the project", async () => {
    await expect(
      controller.createPolicy(
        {
          projectId: "campus-lms",
          ownerTribeId: "other-tribe",
          scope: "all",
          windowSeconds: 60,
          maxRequests: 500,
          reason: "mismatch",
        } as never,
        { user: { sub: "platform" } } as any,
      ),
    ).rejects.toThrow("Project 'campus-lms' belongs to tribe 'campus-one', not 'other-tribe'");
  });

  it("rejects unknown projects and unknown tribes", async () => {
    const base = { scope: "all", windowSeconds: 60, maxRequests: 10, reason: "x" };
    await expect(
      controller.createPolicy({ ...base, projectId: "missing" } as never, { user: {} } as any),
    ).rejects.toThrow("Project 'missing' is not registered");
    await expect(
      controller.createPolicy({ ...base, ownerTribeId: "missing-tribe" } as never, { user: {} } as any),
    ).rejects.toThrow("Tribe 'missing-tribe' is not registered");
    expect(policies.createPolicy).not.toHaveBeenCalled();
  });

  it("targets the project when approving an enforced project budget", async () => {
    policies.createPolicy.mockResolvedValue(policy({ mode: "enforce", projectId: "campus-lms" }));

    await controller.createPolicy(
      {
        projectId: "campus-lms",
        scope: "all",
        windowSeconds: 60,
        maxRequests: 500,
        mode: "enforce",
        reason: "LMS go-live",
        approvalRequestId: "approval-2",
      } as never,
      { user: { sub: "platform" } } as any,
    );

    expect(approvals.assertApprovedForAction).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: "campus-lms" }),
    );
  });

  it("does not let an update move a policy to another project", async () => {
    await expect(
      controller.updatePolicy("quota-policy-1", { projectId: "campus-lms" } as never, { user: {} } as any),
    ).rejects.toThrow("projectId cannot change");
  });
});

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: "quota-policy-1",
    ownerTribeId: "campus-one",
    scope: "shared",
    targetServiceId: "payment-service",
    windowSeconds: 60,
    maxRequests: 100,
    burstRequests: null,
    mode: "observe",
    status: "active",
    reason: "rollout observation",
    updatedAt: new Date("2026-05-25T00:00:00.000Z"),
    ...overrides,
  };
}
