import { ConsumerScorecardController } from "./consumer-scorecard.controller";
import { ConsumerScorecardService } from "./consumer-scorecard.service";

describe("ConsumerScorecardController", () => {
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
      tribeApiQuotaDecision: {
        findMany: jest.fn().mockResolvedValue([
          { requestCount: 92, maxRequests: 100 },
          { requestCount: 25, maxRequests: 100 },
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
      tribeApiQuotaDecision: {
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
