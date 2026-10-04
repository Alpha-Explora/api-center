import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { TribeQuotaPolicyService } from "../../../../apps/gateway/src/domains/governance/quotas/tribe-quota-policy.service";

describe("TribeQuotaPolicyService", () => {
  let prisma: {
    quotaPolicy: {
      findMany: jest.Mock;
    };
  };
  let service: TribeQuotaPolicyService;

  beforeEach(() => {
    prisma = {
      quotaPolicy: {
        findMany: jest.fn(),
      },
    };
    service = new TribeQuotaPolicyService(prisma as unknown as PrismaService);
  });

  it("chooses the most specific active policy for a tribe target", async () => {
    prisma.quotaPolicy.findMany.mockResolvedValue([
      {
        id: "policy-all",
        ownerTribeId: "campus-one",
        scope: "all",
        targetServiceId: null,
        maxRequests: 1000,
        windowSeconds: 60,
        burstRequests: null,
        mode: "observe",
        status: "active",
        reason: "default observe",
      },
      {
        id: "policy-payment",
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "payment-service",
        maxRequests: 120,
        windowSeconds: 60,
        burstRequests: null,
        mode: "enforce",
        status: "active",
        reason: "payment-service protection",
      },
    ]);

    await expect(
      service.resolvePolicy({
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "payment-service",
      }),
    ).resolves.toMatchObject({
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment-service",
      maxRequests: 120,
      mode: "enforce",
    });
  });

  it("falls back to a namespace policy before an all-scope policy", async () => {
    prisma.quotaPolicy.findMany.mockResolvedValue([
      {
        id: "policy-all",
        ownerTribeId: "campus-one",
        scope: "all",
        targetServiceId: null,
        maxRequests: 1000,
        windowSeconds: 60,
        burstRequests: null,
        mode: "observe",
        status: "active",
        reason: "default observe",
      },
      {
        id: "policy-shared",
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: null,
        maxRequests: 300,
        windowSeconds: 60,
        burstRequests: null,
        mode: "enforce",
        status: "active",
        reason: "shared-service protection",
      },
    ]);

    await expect(
      service.resolvePolicy({
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "email-service",
      }),
    ).resolves.toMatchObject({
      id: "policy-shared",
      scope: "shared",
      targetServiceId: null,
      maxRequests: 300,
    });
  });
});
