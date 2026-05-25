import { ConfigService } from "../config/config.service";
import { PrismaService } from "../database/prisma.service";
import { TribeCostService } from "../costs/tribe-cost.service";
import { TribeQuotaEnforcerService } from "./tribe-quota-enforcer.service";
import { TribeQuotaPolicyService } from "./tribe-quota-policy.service";

describe("TribeQuotaEnforcerService", () => {
  let policies: {
    resolvePolicy: jest.Mock;
  };
  let prisma: {
    tribeApiQuotaDecision: {
      create: jest.Mock;
    };
  };
  let service: TribeQuotaEnforcerService;

  beforeEach(() => {
    policies = {
      resolvePolicy: jest.fn(),
    };
    prisma = {
      tribeApiQuotaDecision: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    service = new TribeQuotaEnforcerService(
      policies as unknown as TribeQuotaPolicyService,
      prisma as unknown as PrismaService,
      {
        redis: { rateLimitUrl: "" },
      } as ConfigService,
      new TribeCostService(),
    );
  });

  it("allows calls under an enforce policy", async () => {
    policies.resolvePolicy.mockResolvedValue(policy({ maxRequests: 2 }));

    await expect(service.check(request())).resolves.toBeUndefined();
    await expect(service.check(request())).resolves.toBeUndefined();

    expect(prisma.tribeApiQuotaDecision.create).toHaveBeenCalledTimes(2);
    expect(prisma.tribeApiQuotaDecision.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        ownerTribeId: "campus-one",
        requestCount: 2,
        maxRequests: 2,
        mode: "enforce",
        outcome: "allowed",
      }),
    });
  });

  it("records observed_exceeded without blocking when policy mode is observe", async () => {
    policies.resolvePolicy.mockResolvedValue(
      policy({ mode: "observe", maxRequests: 1 }),
    );

    await service.check(request());
    await expect(service.check(request())).resolves.toBeUndefined();

    expect(prisma.tribeApiQuotaDecision.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        requestCount: 2,
        maxRequests: 1,
        mode: "observe",
        outcome: "observed_exceeded",
      }),
    });
  });

  it("throws QuotaExceededError when an enforce policy is exceeded", async () => {
    policies.resolvePolicy.mockResolvedValue(policy({ maxRequests: 1 }));

    await service.check(request());
    await expect(service.check(request())).rejects.toMatchObject({
      status: 429,
      code: "TRIBE_API_QUOTA_EXCEEDED",
      detail: expect.objectContaining({
        ownerTribeId: "campus-one",
        retryAfterSeconds: expect.any(Number),
        quota: {
          maxRequests: 1,
          windowSeconds: 60,
          scope: "shared",
          targetServiceId: "payment-service",
        },
      }),
    });
  });

  it("falls back to memory counters when Redis is not writeable", async () => {
    policies.resolvePolicy.mockResolvedValue(policy({ maxRequests: 1 }));
    (service as unknown as { getRedis: jest.Mock }).getRedis = jest
      .fn()
      .mockResolvedValue({
        incr: jest.fn().mockRejectedValue(new Error("Stream isn't writeable")),
      });

    await service.check(request());
    await expect(service.check(request())).rejects.toMatchObject({
      status: 429,
      code: "TRIBE_API_QUOTA_EXCEEDED",
    });
  });

  it("does nothing when no policy is active", async () => {
    policies.resolvePolicy.mockResolvedValue(null);

    await expect(service.check(request())).resolves.toBeUndefined();

    expect(prisma.tribeApiQuotaDecision.create).not.toHaveBeenCalled();
  });

  it("estimates chargeback when usage is above 80 percent of quota", () => {
    expect(
      service.estimateUsageChargeback({
        requestCount: 90,
        maxRequests: 100,
        scope: "shared",
      }),
    ).toEqual({
      apiCallCost: 0.05,
      kafkaPublishCost: 0,
      analyticsScanCost: 0,
      totalCost: 0.05,
    });
  });
});

function policy(overrides: Record<string, unknown> = {}) {
  return {
    id: "policy-payment",
    ownerTribeId: "campus-one",
    scope: "shared",
    targetServiceId: "payment-service",
    windowSeconds: 60,
    maxRequests: 100,
    burstRequests: null,
    mode: "enforce",
    status: "active",
    reason: "payment-service protection",
    ...overrides,
  };
}

function request() {
  return {
    ownerTribeId: "campus-one",
    scope: "shared" as const,
    targetServiceId: "payment-service",
    routeFamily: "shared-service",
    correlationId: "corr-123",
  };
}
