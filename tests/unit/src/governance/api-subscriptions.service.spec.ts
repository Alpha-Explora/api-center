import { ApiSubscriptionsService } from "../../../../apps/gateway/src/domains/governance/api-subscriptions/api-subscriptions.service";

describe("ApiSubscriptionsService", () => {
  const row = {
    id: "subscription-1",
    consumerProjectId: "consumer-project",
    apiServiceId: "owner-api",
    environment: "test",
    status: "pending",
    requestedBy: "consumer-user",
    decidedBy: null as string | null,
    decidedAt: null as Date | null,
    reason: "Need customer profile lookup",
    requestedAt: new Date(),
    updatedAt: new Date(),
  };
  const registry = {
    get: jest.fn(() => ({
      serviceId: "owner-api",
      projectId: "owner-project",
      serviceType: "tribe",
      environments: [{ environment: "test" }],
    })),
    replaceSubscriptions: jest.fn(),
    setSubscriptionStatus: jest.fn(),
  };
  const tenancy = { requireActiveProject: jest.fn() };
  const prisma = {
    apiSubscription: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
  };
  let service: ApiSubscriptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    row.status = "pending";
    row.decidedBy = null;
    row.decidedAt = null;
    prisma.apiSubscription.findFirst.mockResolvedValue(null);
    prisma.apiSubscription.create.mockResolvedValue(row);
    prisma.apiSubscription.findUnique.mockImplementation(async () => ({
      ...row,
    }));
    prisma.apiSubscription.updateMany.mockImplementation(async ({ data }) => {
      Object.assign(row, data);
      return { count: 1 };
    });
    prisma.apiSubscription.findUniqueOrThrow.mockImplementation(async () => ({
      ...row,
    }));
    service = new ApiSubscriptionsService(
      prisma as never,
      registry as never,
      tenancy as never,
    );
  });

  it("starts pending, grants only after approval, and clears access after revoke", async () => {
    await service.request("consumer-user", {
      consumerProjectId: "consumer-project",
      apiServiceId: "owner-api",
      environment: "test",
      reason: "Need customer profile lookup",
    });
    expect(prisma.apiSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consumerProjectId: "consumer-project",
        requestedBy: "consumer-user",
      }),
    });
    expect(registry.setSubscriptionStatus).toHaveBeenLastCalledWith(
      "consumer-project",
      "owner-api",
      "test",
      "pending",
    );

    await service.decide("subscription-1", "owner-user", "approve");
    expect(registry.setSubscriptionStatus).toHaveBeenLastCalledWith(
      "consumer-project",
      "owner-api",
      "test",
      "approved",
    );
    await service.decide("subscription-1", "owner-user", "revoke");
    expect(registry.setSubscriptionStatus).toHaveBeenLastCalledWith(
      "consumer-project",
      "owner-api",
      "test",
      "revoked",
    );
  });

  it("rejects invalid transitions and does not grant access", async () => {
    row.status = "rejected";
    await expect(
      service.decide("subscription-1", "owner-user", "approve"),
    ).rejects.toThrow("Cannot approve a rejected subscription");
    expect(registry.setSubscriptionStatus).not.toHaveBeenCalled();
  });
});
