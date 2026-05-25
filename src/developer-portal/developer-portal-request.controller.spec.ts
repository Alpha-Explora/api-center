import { DeveloperPortalRequestController } from "./developer-portal-request.controller";

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
});
