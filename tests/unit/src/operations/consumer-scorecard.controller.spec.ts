import { ConsumerScorecardController } from "../../../../apps/gateway/src/operations/consumer-scorecard.controller";
import { ConsumerScorecardService } from "../../../../apps/gateway/src/operations/consumer-scorecard.service";

describe("ConsumerScorecardController", () => {
  it("loads quota decisions once for distinct owner tribes", async () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        orders: {
          serviceId: "orders",
          ownerTribeId: "commerce",
          status: "active",
        },
        checkout: {
          serviceId: "checkout",
          ownerTribeId: "commerce",
          status: "active",
        },
        logistics: {
          serviceId: "logistics",
          status: "active",
        },
      }),
    };
    const scorecards = {
      score: jest.fn((input) => ({
        ownerTribeId: input.ownerTribeId,
        quotaUsagePercent: input.quotaUsagePercent,
      })),
    };
    const quotaFindMany = jest.fn().mockResolvedValue([
      { ownerTribeId: "commerce", requestCount: 90, maxRequests: 100 },
      { ownerTribeId: "logistics", requestCount: 10, maxRequests: 100 },
    ]);
    const prisma = {
      quotaEvaluation: {
        findMany: quotaFindMany,
      },
    };
    const gatewayTraffic = {
      getSummary: jest.fn().mockResolvedValue({
        totalProxyRequests: 0,
        status4xx: 0,
        status5xx: 0,
      }),
    };

    const controller = new ConsumerScorecardController(
      registry as any,
      scorecards as any,
      prisma as any,
      gatewayTraffic as any,
    );

    const response = await controller.list();

    expect(quotaFindMany).toHaveBeenCalledTimes(1);
    expect(quotaFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerTribeId: {
            in: ["commerce", "logistics"],
          },
        },
      }),
    );
    expect(response.data).toEqual([
      expect.objectContaining({
        ownerTribeId: "commerce",
        quotaUsagePercent: 90,
      }),
      expect.objectContaining({
        ownerTribeId: "commerce",
        quotaUsagePercent: 90,
      }),
      expect.objectContaining({
        ownerTribeId: "logistics",
        quotaUsagePercent: 10,
      }),
    ]);
  });

  it("uses explicit sdk metadata and metric-backed scorecard inputs", async () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        "student-api": {
          serviceId: "student-api",
          ownerTribeId: "campus-one",
          version: "service-version",
          metadata: { sdkVersion: "1.0.0" },
        },
      }),
    };
    const prisma = {
      quotaEvaluation: {
        findMany: jest.fn().mockResolvedValue([
          { ownerTribeId: "campus-one", requestCount: 92, maxRequests: 100 },
          { ownerTribeId: "campus-one", requestCount: 25, maxRequests: 100 },
        ]),
      },
    };
    const gatewayTraffic = {
      getSummary: jest.fn().mockResolvedValue({
        totalProxyRequests: 100,
        status4xx: 1,
        status5xx: 2,
      }),
    };
    const controller = new ConsumerScorecardController(
      registry as any,
      new ConsumerScorecardService(),
      prisma as any,
      gatewayTraffic as any,
    );

    const response = await controller.list();

    expect(response.data[0]).toEqual(
      expect.objectContaining({
        ownerTribeId: "campus-one",
        sdkVersion: "1.0.0",
        quotaUsagePercent: 92,
        errorRatePercent: 3,
        status: "needs_attention",
      }),
    );
    expect(response.data[0].findings).toEqual(
      expect.arrayContaining([
        "SDK version is behind the current supported version.",
        "Quota usage is above 90 percent.",
        "Error rate is above the platform threshold.",
      ]),
    );
  });

  it("reports unavailable metrics instead of hard-coded zeroes", async () => {
    const registry = {
      getAll: jest.fn().mockReturnValue({
        "student-api": {
          serviceId: "student-api",
          ownerTribeId: "campus-one",
        },
      }),
    };
    const prisma = {
      quotaEvaluation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const gatewayTraffic = {
      getSummary: jest.fn().mockResolvedValue({
        totalProxyRequests: 0,
        status4xx: 0,
        status5xx: 0,
      }),
    };
    const controller = new ConsumerScorecardController(
      registry as any,
      new ConsumerScorecardService(),
      prisma as any,
      gatewayTraffic as any,
    );

    const response = await controller.list();

    expect(response.data[0].findings).toEqual(
      expect.arrayContaining([
        "SDK version is not reported.",
        "Quota usage metric is unavailable.",
        "Gateway error rate metric is unavailable.",
      ]),
    );
  });
});
