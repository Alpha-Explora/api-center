import { ApiSubscriptionsService } from "../../../../apps/gateway/src/domains/governance/api-subscriptions/api-subscriptions.service";

describe("ApiSubscriptionsService", () => {
  const row = {
    id: "subscription-1",
    consumerProjectId: "consumer-project",
    apiProjectId: "owner-project",
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
  const tenancy = {
    requireActiveProject: jest.fn(),
    resolveProject: jest.fn((projectId: string) => {
      const organizationId: Record<string, string> = {
        "consumer-project": "org-a",
        "owner-project": "org-b",
        "consumer-project-2": "org-c",
        "owner-project-2": "org-a",
        "consumer-project-3": "org-c",
        "owner-project-3": "org-d",
      };
      const resolved = organizationId[projectId];
      return resolved ? { tribe: { organizationId: resolved } } : null;
    }),
  };
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
  const logger = { warn: jest.fn() };
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
    prisma.apiSubscription.findMany.mockResolvedValue([]);
    service = new ApiSubscriptionsService(
      prisma as never,
      registry as never,
      tenancy as never,
      logger as never,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    delete process.env.DATABASE_ENABLED;
    delete process.env.API_SUBSCRIPTION_REFRESH_MS;
    delete process.env.API_SUBSCRIPTION_MAX_STALENESS_MS;
  });

  it("starts pending, grants only after approval, and clears access after revoke", async () => {
    await service.request("consumer-user", {
      consumerProjectId: "consumer-project",
      apiServiceId: "owner-api",
      environment: "test",
      reason: "Need customer profile lookup",
    });
    expect(prisma.apiSubscription.findFirst).toHaveBeenCalledWith({
      where: {
        consumerProjectId: "consumer-project",
        apiProjectId: "owner-project",
        apiServiceId: "owner-api",
        environment: "test",
        status: { in: ["pending", "approved"] },
      },
    });
    expect(prisma.apiSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        consumerProjectId: "consumer-project",
        apiProjectId: "owner-project",
        requestedBy: "consumer-user",
      }),
    });
    expect(registry.setSubscriptionStatus).toHaveBeenLastCalledWith(
      "consumer-project",
      "owner-project",
      "owner-api",
      "test",
      "pending",
    );

    await service.decide("subscription-1", "owner-user", "approve");
    expect(registry.setSubscriptionStatus).toHaveBeenLastCalledWith(
      "consumer-project",
      "owner-project",
      "owner-api",
      "test",
      "approved",
    );
    await service.decide("subscription-1", "owner-user", "revoke");
    expect(registry.setSubscriptionStatus).toHaveBeenLastCalledWith(
      "consumer-project",
      "owner-project",
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

  it("filters subscription listings to either side's allowed organizations", async () => {
    const other = (id: string, consumerProjectId: string, apiProjectId: string) => ({
      ...row,
      id,
      consumerProjectId,
      apiProjectId,
    });
    prisma.apiSubscription.findMany.mockResolvedValue([
      row,
      other("subscription-2", "consumer-project-2", "owner-project-2"),
      other("subscription-3", "consumer-project-3", "owner-project-3"),
    ]);

    const result = await service.list({ organizationIds: ["org-a"] });

    expect(result.map((subscription) => subscription.id)).toEqual([
      "subscription-1",
      "subscription-2",
    ]);
  });

  it("does not approve a pending request after the API slug changes owner", async () => {
    registry.get.mockReturnValue({
      serviceId: "owner-api",
      projectId: "new-owner-project",
      serviceType: "tribe",
      environments: [{ environment: "test" }],
    } as never);

    await expect(
      service.decide("subscription-1", "new-owner-user", "approve"),
    ).rejects.toThrow("API owner changed");
    expect(prisma.apiSubscription.updateMany).not.toHaveBeenCalled();
    expect(registry.setSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("refreshes the shared snapshot periodically and keeps the last snapshot on failure", async () => {
    jest.useFakeTimers();
    process.env.DATABASE_ENABLED = "true";
    process.env.API_SUBSCRIPTION_REFRESH_MS = "1000";
    prisma.apiSubscription.findMany.mockResolvedValueOnce([row]);
    await service.onApplicationBootstrap();
    expect(registry.replaceSubscriptions).toHaveBeenLastCalledWith(
      [row],
      45_000,
    );

    prisma.apiSubscription.findMany.mockRejectedValueOnce(
      new Error("db offline"),
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect(registry.replaceSubscriptions).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("API subscription status refresh failed"),
      "ApiSubscriptionsService",
    );

    prisma.apiSubscription.findMany.mockResolvedValueOnce([
      { ...row, status: "revoked" },
    ]);
    await jest.advanceTimersByTimeAsync(1000);
    expect(registry.replaceSubscriptions).toHaveBeenLastCalledWith(
      [{ ...row, status: "revoked" }],
      45_000,
    );
  });

  it("does not load a fresh snapshot when database support is disabled", async () => {
    process.env.DATABASE_ENABLED = "false";
    await service.onApplicationBootstrap();
    expect(prisma.apiSubscription.findMany).not.toHaveBeenCalled();
    expect(registry.replaceSubscriptions).not.toHaveBeenCalled();
  });
});
