import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
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

  let controller: TribeQuotaAdminController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TribeQuotaAdminController(
      policies as unknown as TribeQuotaPolicyService,
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
