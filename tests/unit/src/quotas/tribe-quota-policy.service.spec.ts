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
      service.resolvePolicies({
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "payment-service",
      }),
    ).resolves.toMatchObject({
      project: null,
      tribe: {
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "payment-service",
        maxRequests: 120,
        mode: "enforce",
      },
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
      service.resolvePolicies({
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "email-service",
      }),
    ).resolves.toMatchObject({
      tribe: {
        id: "policy-shared",
        scope: "shared",
        targetServiceId: null,
        maxRequests: 300,
      },
    });
  });

  it("resolves the caller's project budget and the tribe ceiling separately, ignoring sibling projects", async () => {
    prisma.quotaPolicy.findMany.mockResolvedValue([
      { id: "tribe-ceiling", ownerTribeId: "campus-one", projectId: null, scope: "all", targetServiceId: null, maxRequests: 10000, windowSeconds: 60, mode: "enforce", status: "active", reason: "ceiling" },
      { id: "lms-budget", ownerTribeId: "campus-one", projectId: "campus-lms", scope: "all", targetServiceId: null, maxRequests: 500, windowSeconds: 60, mode: "enforce", status: "active", reason: "lms" },
      { id: "billing-budget", ownerTribeId: "campus-one", projectId: "campus-billing", scope: "all", targetServiceId: null, maxRequests: 50, windowSeconds: 60, mode: "enforce", status: "active", reason: "billing" },
    ]);

    const resolved = await service.resolvePolicies({
      ownerTribeId: "campus-one",
      projectId: "campus-lms",
      scope: "tribe",
      targetServiceId: "grades",
    });

    expect(resolved.project?.id).toBe("lms-budget");
    expect(resolved.tribe?.id).toBe("tribe-ceiling");
    expect(prisma.quotaPolicy.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerTribeId: "campus-one",
          AND: expect.arrayContaining([
            { OR: [{ projectId: null }, { projectId: "campus-lms" }] },
          ]),
        }),
      }),
    );
  });

  it("returns no project budget when the caller has no project", async () => {
    prisma.quotaPolicy.findMany.mockResolvedValue([
      { id: "lms-budget", ownerTribeId: "campus-one", projectId: "campus-lms", scope: "all", targetServiceId: null, maxRequests: 500, windowSeconds: 60, mode: "enforce", status: "active", reason: "lms" },
    ]);

    await expect(
      service.resolvePolicies({ ownerTribeId: "campus-one", scope: "all" }),
    ).resolves.toEqual({ project: null, tribe: null });
  });
});
