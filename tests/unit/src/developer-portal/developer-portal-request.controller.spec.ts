import { DeveloperPortalRequestController } from "../../../../apps/gateway/src/developer-portal/developer-portal-request.controller";
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
});
