import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AuditEventsService } from "../analytics/audit-events.service";
import { ScopedAdminGuard } from "../auth/guards/scoped-admin.guard";
import { ApprovalRequestController } from "./approval-request.controller";
import { ApprovalRequestService } from "./approval-request.service";

describe("ApprovalRequestController", () => {
  const approvals = {
    approveRequest: jest.fn(),
    createRequest: jest.fn(),
    listRequests: jest.fn(),
    rejectRequest: jest.fn(),
  };
  let auditEvents: { recordRequired: jest.Mock };
  let controller: ApprovalRequestController;

  beforeEach(() => {
    jest.clearAllMocks();
    auditEvents = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    controller = new ApprovalRequestController(
      approvals as unknown as ApprovalRequestService,
      auditEvents as unknown as AuditEventsService,
    );
  });

  it("requires platform admin scope", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      ApprovalRequestController,
    );

    expect(guards).toContain(ScopedAdminGuard);
  });

  it("creates approval requests from preview payloads", async () => {
    approvals.createRequest.mockResolvedValue(request());

    const response = await controller.create(
      {
        actionType: "quota.enforce",
        targetId: "campus-one",
        targetEnvironment: "live",
        before: { mode: "observe" },
        after: { mode: "enforce" },
        riskLevel: "high",
        reason: "Production quota enforcement",
      },
      { user: { tribeId: "platform" }, correlationId: "corr-approval" } as any,
    );

    expect(approvals.createRequest).toHaveBeenCalledWith({
      actionType: "quota.enforce",
      targetId: "campus-one",
      targetEnvironment: "live",
      before: { mode: "observe" },
      after: { mode: "enforce" },
      riskLevel: "high",
      reason: "Production quota enforcement",
      requestedBy: "platform",
    });
    expect(response.meta.correlationId).toBe("corr-approval");
    expect(auditEvents.recordRequired).toHaveBeenCalledWith({
      type: "approval.request.created",
      actionFamily: "approval",
      actor: "platform",
      severity: "info",
      resourceType: "approval_request",
      resourceId: "approval-1",
      environment: "live",
      correlationId: "corr-approval",
      message: "approval.request.created for quota.enforce",
      payload: expect.objectContaining({
        approvalRequestId: "approval-1",
        actionType: "quota.enforce",
        targetEnvironment: "live",
        correlationId: "corr-approval",
      }),
    });
  });

  it("fails closed when approval decision audit evidence cannot be written", async () => {
    approvals.approveRequest.mockResolvedValue(
      request({ status: "approved", approvedBy: "platform" }),
    );
    auditEvents.recordRequired.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );

    await expect(
      controller.approve("approval-1", {
        user: { tribeId: "platform" },
      } as any),
    ).rejects.toThrow("audit unavailable");
  });

  it("approves and rejects requests", async () => {
    approvals.approveRequest.mockResolvedValue(
      request({ status: "approved", approvedBy: "platform" }),
    );
    approvals.rejectRequest.mockResolvedValue(
      request({ status: "rejected", rejectedBy: "platform" }),
    );

    await controller.approve("approval-1", {
      user: { tribeId: "platform" },
    } as any);
    await controller.reject(
      "approval-1",
      { reason: "Needs lower blast radius" },
      { user: { tribeId: "platform" } } as any,
    );

    expect(approvals.approveRequest).toHaveBeenCalledWith(
      "approval-1",
      "platform",
    );
    expect(approvals.rejectRequest).toHaveBeenCalledWith(
      "approval-1",
      "platform",
      "Needs lower blast radius",
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({ type: "approval.request.approved" }),
    );
    expect(auditEvents.recordRequired).toHaveBeenCalledWith(
      expect.objectContaining({ type: "approval.request.rejected" }),
    );
  });
});

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1",
    actionType: "quota.enforce",
    targetId: "campus-one",
    targetEnvironment: "live",
    status: "pending",
    before: { mode: "observe" },
    after: { mode: "enforce" },
    riskLevel: "high",
    reason: "Production quota enforcement",
    requestedBy: "platform",
    ...overrides,
  };
}
