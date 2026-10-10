import {
  ConflictError,
  ForbiddenError,
  ValidationError,
} from "../../../../apps/gateway/src/shared/errors";
import { ApprovalRequestService } from "../../../../apps/gateway/src/domains/governance/approvals/approval-request.service";

describe("ApprovalRequestService", () => {
  const approvals = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
  };
  let service: ApprovalRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    approvals.updateMany.mockResolvedValue({ count: 1 });
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

  it("requires a matching target when the caller opts in", async () => {
    approvals.findUnique.mockResolvedValue(request({
      id: "approval-1",
      actionType: "payments.live_access",
      targetId: null,
      status: "approved",
    }));

    await expect(service.assertApprovedForAction({
      approvalRequestId: "approval-1",
      actionType: "payments.live_access",
      targetEnvironment: "live",
      targetId: "project-one",
      requireTarget: true,
    })).rejects.toThrow(ForbiddenError);
    expect(approvals.updateMany).not.toHaveBeenCalled();
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
  describe("status transitions", () => {
    it("approves a pending request and records the approver", async () => {
      const store = inMemoryApprovals(request({ status: "pending" }));

      const result = await serviceFor(store).approveRequest(
        "approval-1",
        "approver",
      );

      expect(result).toMatchObject({
        status: "approved",
        approvedBy: "approver",
      });
    });

    it.each(["approved", "rejected", "cancelled", "applied"])(
      "returns 409 and changes nothing when approving a %s request",
      async (status) => {
        const store = inMemoryApprovals(request({ status }));

        await expect(
          serviceFor(store).approveRequest("approval-1", "approver"),
        ).rejects.toThrow(ConflictError);
        expect(store.row.status).toBe(status);
        expect(store.updateMany).not.toHaveBeenCalled();
      },
    );

    it("does not let the requester approve their own request", async () => {
      const store = inMemoryApprovals(
        request({ status: "pending", requestedBy: "platform" }),
      );

      await expect(
        serviceFor(store).approveRequest("approval-1", "platform"),
      ).rejects.toThrow(ForbiddenError);
      expect(store.row.status).toBe("pending");
    });

    it("lets only one of two concurrent approvals succeed", async () => {
      const store = inMemoryApprovals(request({ status: "pending" }));
      const service = serviceFor(store);

      const results = await Promise.allSettled([
        service.approveRequest("approval-1", "approver-a"),
        service.approveRequest("approval-1", "approver-b"),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(failure?.reason).toBeInstanceOf(ConflictError);
      expect(store.row).toMatchObject({ status: "approved" });
    });

    it("rejects only pending requests", async () => {
      const pending = inMemoryApprovals(request({ status: "pending" }));
      await expect(
        serviceFor(pending).rejectRequest("approval-1", "admin", "Too broad"),
      ).resolves.toMatchObject({
        status: "rejected",
        rejectionReason: "Too broad",
      });

      const approved = inMemoryApprovals(request({ status: "approved" }));
      await expect(
        serviceFor(approved).rejectRequest("approval-1", "admin", "Too late"),
      ).rejects.toThrow(ConflictError);
      expect(approved.row.status).toBe("approved");
    });

    it("lets the requester or an admin cancel a pending request", async () => {
      const byRequester = inMemoryApprovals(
        request({ status: "pending", requestedBy: "campus-one" }),
      );
      await expect(
        serviceFor(byRequester).cancelRequest("approval-1", "campus-one", {
          isAdmin: false,
        }),
      ).resolves.toMatchObject({
        status: "cancelled",
        cancelledBy: "campus-one",
      });

      const byAdmin = inMemoryApprovals(
        request({ status: "pending", requestedBy: "campus-one" }),
      );
      await expect(
        serviceFor(byAdmin).cancelRequest("approval-1", "platform-admin", {
          isAdmin: true,
        }),
      ).resolves.toMatchObject({ status: "cancelled" });
    });

    it("blocks other tribes from cancelling and blocks cancelling a decided request", async () => {
      const store = inMemoryApprovals(
        request({ status: "pending", requestedBy: "campus-one" }),
      );
      await expect(
        serviceFor(store).cancelRequest("approval-1", "campus-two", {
          isAdmin: false,
        }),
      ).rejects.toThrow(ForbiddenError);
      expect(store.row.status).toBe("pending");

      const approved = inMemoryApprovals(
        request({ status: "approved", requestedBy: "campus-one" }),
      );
      await expect(
        serviceFor(approved).cancelRequest("approval-1", "campus-one", {
          isAdmin: false,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("marks an approved request applied on first use and rejects a second use", async () => {
      const store = inMemoryApprovals(
        request({ status: "approved", targetId: "campus-one" }),
      );
      const service = serviceFor(store);
      const check = {
        approvalRequestId: "approval-1",
        actionType: "quota.enforce" as const,
        targetEnvironment: "live",
        targetId: "campus-one",
      };

      await service.assertApprovedForAction(check);
      expect(store.row).toMatchObject({ status: "applied" });
      expect(store.row.appliedAt).toBeInstanceOf(Date);

      await expect(service.assertApprovedForAction(check)).rejects.toThrow(
        ConflictError,
      );
    });

    it("lets only one of two concurrent live actions use the same approval", async () => {
      const store = inMemoryApprovals(
        request({ status: "approved", targetId: "campus-one" }),
      );
      const service = serviceFor(store);
      const check = {
        approvalRequestId: "approval-1",
        actionType: "quota.enforce" as const,
        targetEnvironment: "live",
        targetId: "campus-one",
      };

      const results = await Promise.allSettled([
        service.assertApprovedForAction(check),
        service.assertApprovedForAction(check),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(store.row).toMatchObject({ status: "applied" });
    });

    it("does not consume an approval for a non-live target", async () => {
      const store = inMemoryApprovals(
        request({ status: "approved", targetEnvironment: "test" }),
      );

      await expect(
        serviceFor(store).assertApprovedForAction({
          approvalRequestId: "approval-1",
          actionType: "quota.enforce" as const,
          targetEnvironment: "test",
        }),
      ).resolves.toBeNull();
      expect(store.row.status).toBe("approved");
      expect(store.updateMany).not.toHaveBeenCalled();
    });
  });
});

function inMemoryApprovals(initial: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...initial };
  return {
    row,
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(async () => ({ ...row })),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const matches = where.id === row.id && where.status === row.status;
        if (!matches) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    ),
  };
}

function serviceFor(store: ReturnType<typeof inMemoryApprovals>) {
  return new ApprovalRequestService({ approvalRequest: store } as any);
}

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
