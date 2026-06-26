import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { AuditEventsService } from "../analytics/audit-events.service";
import { ValidationError } from "../shared/errors";
import { TribeQuotaAdminController } from "./tribe-quota-admin.controller";
import { TribeQuotaPolicyService } from "./tribe-quota-policy.service";

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
      user: { tribeId: "platform", scopes: ["platform:admin"] },
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

    const response = await controller.listPolicies("campus-one", {
      correlationId: "corr-list",
    } as any);

    expect(response.data[0]).toEqual({
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
      updatedAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("requires approval before creating an enforced quota policy", async () => {
    policies.createPolicy.mockResolvedValue(policy({ mode: "enforce" }));
    const guardedController = new TribeQuotaAdminController(
      policies as unknown as TribeQuotaPolicyService,
      approvals as any,
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
      { user: { tribeId: "platform" } } as any,
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
