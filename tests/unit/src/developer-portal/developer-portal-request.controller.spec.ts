import { DeveloperPortalRequestController } from "../../../../apps/gateway/src/domains/governance/developer-portal/developer-portal-request.controller";
import { ForbiddenError } from "../../../../apps/gateway/src/shared/errors";

describe("DeveloperPortalRequestController", () => {
  it("creates a quota increase request instead of changing quota directly", async () => {
    const approvals = {
      createRequest: jest.fn().mockResolvedValue({
        id: "approval-1",
        actionType: "quota.increase",
        status: "pending",
      }),
    };
    const controller = new DeveloperPortalRequestController(approvals as any);

    const response = await controller.requestQuotaIncrease(
      {
        ownerTribeId: "campus-one",
        requestedMaxRequests: 50000,
        reason: "Enrollment launch",
      },
      { user: { tribeId: "campus-one" } } as any,
    );

    expect(response.data.status).toBe("pending");
    expect(approvals.createRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: "quota.increase",
        targetId: "campus-one",
      }),
    );
  });

  it("rejects quota increase requests for another tribe", async () => {
    const approvals = {
      createRequest: jest.fn(),
    };
    const controller = new DeveloperPortalRequestController(approvals as any);

    await expect(
      controller.requestQuotaIncrease(
        {
          ownerTribeId: "other-tribe",
          requestedMaxRequests: 50000,
          reason: "Enrollment launch",
        },
        { user: { tribeId: "campus-one" } } as any,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(approvals.createRequest).not.toHaveBeenCalled();
  });

  it("requires a tribe token", async () => {
    const approvals = {
      createRequest: jest.fn(),
    };
    const controller = new DeveloperPortalRequestController(approvals as any);

    await expect(
      controller.requestQuotaIncrease(
        {
          ownerTribeId: "campus-one",
          requestedMaxRequests: 50000,
          reason: "Enrollment launch",
        },
        {} as any,
      ),
    ).rejects.toThrow("Quota increase requests require a tribe token.");
  });

  it("lets the requesting tribe cancel its own pending request", async () => {
    const approvals = {
      cancelRequest: jest
        .fn()
        .mockResolvedValue({ id: "approval-1", status: "cancelled" }),
    };
    const controller = new DeveloperPortalRequestController(approvals as any);

    const response = await controller.cancelQuotaRequest("approval-1", {
      user: { tribeId: "campus-one" },
    } as any);

    expect(response.data.status).toBe("cancelled");
    expect(approvals.cancelRequest).toHaveBeenCalledWith(
      "approval-1",
      "campus-one",
      {
        isAdmin: false,
      },
    );
  });

  it("requires a tribe token to cancel a request", async () => {
    const approvals = { cancelRequest: jest.fn() };
    const controller = new DeveloperPortalRequestController(approvals as any);

    await expect(
      controller.cancelQuotaRequest("approval-1", {} as any),
    ).rejects.toThrow(ForbiddenError);
    expect(approvals.cancelRequest).not.toHaveBeenCalled();
  });
});
