jest.mock("@governance", () => ({
  ApprovalRequestService: class {},
  TribePlanService: class {},
  TribeQuotaPolicyService: class {},
}));
jest.mock("@auth/guards/scoped-admin.guard", () => ({ ScopedAdminGuard: class {} }));

import { AuditEventsService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/audit-events.service";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { PromotionEvidenceBundleController } from "../../../../apps/gateway/src/domains/runtime-ops/operations/promotion-evidence-bundle.controller";
import { PromotionEvidenceBundleService } from "../../../../apps/gateway/src/domains/runtime-ops/operations/promotion-evidence-bundle.service";

describe("PromotionEvidenceBundleController", () => {
  const registry = {
    get: jest.fn(),
  } as unknown as RegistryService;
  const quotaPolicies = {
    listPolicies: jest.fn(),
  };
  const planService = {
    listPlanAssignments: jest.fn(),
  };
  const approvals = {
    listRequests: jest.fn(),
  };

  let auditEvents: { record: jest.Mock };
  let controller: PromotionEvidenceBundleController;

  beforeEach(() => {
    jest.clearAllMocks();
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    controller = new PromotionEvidenceBundleController(
      registry,
      new PromotionEvidenceBundleService(),
      quotaPolicies as any,
      planService as any,
      approvals as any,
      auditEvents as unknown as AuditEventsService,
    );
  });

  it("returns markdown evidence for current service and governance data", async () => {
    (registry.get as jest.Mock).mockReturnValue({
      serviceId: "campus-one",
      ownerTribeId: "campus-one",
      consumes: ["kafka"],
    });
    quotaPolicies.listPolicies.mockResolvedValue([
      { id: "quota-1", status: "active" },
    ]);
    planService.listPlanAssignments.mockResolvedValue([
      { id: "plan-1", status: "active" },
    ]);
    approvals.listRequests.mockResolvedValue([
      { id: "approval-1", status: "approved", targetId: "campus-one" },
    ]);

    const response = await controller.getEvidence("campus-one", "md");

    expect(response).toContain("# Promotion Evidence: campus-one");
    expect(response).toContain("## Pipeline");
  });

  it("does not mark quota, plan, approval, or pipeline as passing when evidence is missing", async () => {
    (registry.get as jest.Mock).mockReturnValue({
      serviceId: "campus-one",
      ownerTribeId: "campus-one",
      healthy: true,
      consumes: [],
    });
    quotaPolicies.listPolicies.mockResolvedValue([]);
    planService.listPlanAssignments.mockResolvedValue([]);
    approvals.listRequests.mockResolvedValue([]);

    const response = await controller.getEvidence("campus-one", undefined);

    expect(response).toMatchObject({ success: true });
    if (typeof response === "string") throw new Error("Expected JSON response");
    expect(response.data.ready).toBe(false);
    expect(response.meta.sourceMetadata).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceName: "promotion-evidence-memory-bundles",
          sourceType: "volatile",
        }),
      ]),
    );
    expect(response.data.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "quota", status: "fail" }),
        expect.objectContaining({ key: "plan", status: "fail" }),
        expect.objectContaining({ key: "approval", status: "fail" }),
        expect.objectContaining({ key: "pipeline", status: "fail" }),
      ]),
    );
  });

  it("uses owner tribe for quota and plan evidence lookup", async () => {
    (registry.get as jest.Mock).mockReturnValue({
      serviceId: "student-api",
      ownerTribeId: "campus-one",
      healthy: true,
    });
    quotaPolicies.listPolicies.mockResolvedValue([
      { id: "quota-1", status: "active" },
    ]);
    planService.listPlanAssignments.mockResolvedValue([
      { id: "plan-1", status: "active" },
    ]);
    approvals.listRequests.mockResolvedValue([
      { id: "approval-1", status: "approved", targetId: "student-api" },
    ]);

    const response = await controller.getEvidence("student-api", undefined);

    expect(quotaPolicies.listPolicies).toHaveBeenCalledWith("campus-one");
    expect(planService.listPlanAssignments).toHaveBeenCalledWith({
      ownerTribeId: "campus-one",
      status: "active",
    });
    if (typeof response === "string") throw new Error("Expected JSON response");
    expect(auditEvents.record).toHaveBeenCalledWith({
      type: "promotion.evidence.generated",
      actionFamily: "promotion",
      serviceId: "student-api",
      severity: "warning",
      message: "Promotion evidence generated for student-api",
      payload: expect.objectContaining({
        ready: false,
        sectionStatuses: {
          health: "pass",
          quota: "pass",
          plan: "pass",
          approval: "pass",
          smoke: "pass",
          manifest: "pass",
          pipeline: "fail",
        },
        sourceMetadata: expect.any(Array),
      }),
    });
  });
});
