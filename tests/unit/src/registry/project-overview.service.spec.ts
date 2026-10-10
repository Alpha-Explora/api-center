import { ProjectOverviewService } from "../../../../apps/gateway/src/domains/catalog-registry/project-overview/project-overview.service";

describe("ProjectOverviewService", () => {
  it("assembles project data from the owning domains and scopes recent decisions to the project", async () => {
    const tenancy = {
      getProject: jest.fn(() => ({ projectId: "shop", tribeId: "acme", name: "Shop", status: "active" })),
      getTribe: jest.fn(() => ({ tribeId: "acme", organizationId: "org-a", name: "Acme", status: "active" })),
    };
    const registry = {
      getProjectServices: jest.fn(() => [{
        serviceId: "checkout", name: "Checkout", status: "active",
        environments: [{ environment: "live", status: "healthy" }],
      }]),
    };
    const plans = { listPlanAssignments: jest.fn(async () => [{ environment: "live", planKey: "pro", effectiveLimits: [{ scope: "all", maxRequests: 9000 }] }]) };
    const quotaPolicies = { listPolicies: jest.fn(async () => [{ id: "budget", projectId: "shop", scope: "all" }]) };
    const paymentConsumers = { list: jest.fn(async () => [{ ownerTribeId: "acme", consumerServiceId: "checkout", environment: "live", status: "active" }]) };
    const quotaLedger = { listSince: jest.fn(async () => [{ id: "decision-1", projectId: "shop", outcome: "allowed" }]) };
    const service = new ProjectOverviewService(
      tenancy as never, registry as never, plans as never, quotaPolicies as never,
      paymentConsumers as never, quotaLedger as never,
    );

    const overview = await service.getOverview("shop", "org-a");

    expect(overview).toMatchObject({
      project: { projectId: "shop" },
      tribe: { tribeId: "acme" },
      services: [{ serviceId: "checkout", environments: [{ environment: "live", status: "healthy" }] }],
      plans: [{ environment: "live", effectiveLimits: [{ maxRequests: 9000 }] }],
      quotaPolicyOverrides: [{ id: "budget" }],
      paymentConsumerRegistrations: [{ consumerServiceId: "checkout" }],
      recentQuotaDecisions: [{ id: "decision-1" }],
    });
    expect(plans.listPlanAssignments).toHaveBeenCalledWith({ projectId: "shop", status: "active" });
    expect(quotaPolicies.listPolicies).toHaveBeenCalledWith({ projectId: "shop" });
    expect(quotaLedger.listSince).toHaveBeenCalledWith(expect.objectContaining({ ownerTribeId: "acme", projectId: "shop", limit: 20 }));
  });

  it("hides projects outside the requested organization filter", async () => {
    const service = new ProjectOverviewService(
      { getProject: () => ({ projectId: "shop", tribeId: "acme" }), getTribe: () => ({ tribeId: "acme", organizationId: "org-a" }) } as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    await expect(service.getOverview("shop", "org-b")).rejects.toThrow("requested organization scope");
  });
});
