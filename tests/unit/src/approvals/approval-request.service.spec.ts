import { ForbiddenError, ValidationError } from "../../../../apps/gateway/src/shared/errors";
import { ApprovalRequestService } from "../../../../apps/gateway/src/approvals/approval-request.service";

describe("ApprovalRequestService", () => {
  const approvals = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  let service: ApprovalRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApprovalRequestService({
      approvalRequest: approvals,
    } as any);
  });

  it("creates approval requests with preview payloads", async () => {
    approvals.create.mockResolvedValue(request({ id: "approval-1" }));

    const result = await service.createRequest({
      actionType: "quota.enforce",
      targetId: "campus-one",
      targetEnvironment: "live",
      before: { mode: "observe" },
      after: { mode: "enforce" },
      riskLevel: "high",
      reason: "Production quota enforcement",
      requestedBy: "platform",
    });

    expect(approvals.create).toHaveBeenCalledWith({
      data: {
        actionType: "quota.enforce",
        targetId: "campus-one",
        targetEnvironment: "live",
        status: "pending",
        before: { mode: "observe" },
        after: { mode: "enforce" },
        riskLevel: "high",
        reason: "Production quota enforcement",
        requestedBy: "platform",
      },
    });
    expect(result.id).toBe("approval-1");
  });

  it("requires before and after preview payloads", async () => {
    await expect(
      service.createRequest({
        actionType: "quota.enforce",
        targetEnvironment: "live",
        before: {},
        after: undefined as any,
        riskLevel: "high",
        reason: "missing after",
        requestedBy: "platform",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("requires approved requests for live risky actions", async () => {
    await expect(
      service.assertApprovedForAction({
        actionType: "service.retire",
        targetEnvironment: "live",
        targetId: "orders",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("accepts matching approved requests", async () => {
    approvals.findUnique.mockResolvedValue(
      request({
        id: "approval-1",
        actionType: "service.retire",
        targetId: "orders",
        status: "approved",
      }),
    );

    await expect(
      service.assertApprovedForAction({
        approvalRequestId: "approval-1",
        actionType: "service.retire",
        targetEnvironment: "live",
        targetId: "orders",
      }),
    ).resolves.toBeTruthy();
  });

  it("rejects pending or mismatched approvals", async () => {
    approvals.findUnique.mockResolvedValue(
      request({
        id: "approval-1",
        actionType: "quota.enforce",
        targetId: "campus-one",
        status: "pending",
      }),
    );

    await expect(
      service.assertApprovedForAction({
        approvalRequestId: "approval-1",
        actionType: "quota.enforce",
        targetEnvironment: "live",
        targetId: "campus-one",
      }),
    ).rejects.toThrow(ForbiddenError);
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
