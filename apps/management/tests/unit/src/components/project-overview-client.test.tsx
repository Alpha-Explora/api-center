import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectOverviewClient } from "@/components/project-overview-client";

vi.mock("@/components/page-heading", () => ({ PageHeading: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));

describe("ProjectOverviewClient", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("loads and displays the project overview from its local API route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      success: true,
      data: {
        project: { projectId: "shop", name: "Shop", status: "active" },
        tribe: { tribeId: "acme", name: "Acme", status: "active" },
        services: [{ serviceId: "checkout", name: "Checkout", status: "active", environments: [{ environment: "live", status: "healthy" }] }],
        plans: [{ environment: "live", assignment: { planKey: "pro", status: "active" }, effectiveLimits: [{ scope: "all", maxRequests: 9000, windowSeconds: 86400, source: "plan" }] }],
        quotaPolicyOverrides: [],
        paymentConsumerRegistrations: [],
        recentQuotaDecisions: [],
      },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ProjectOverviewClient projectId="shop" /></QueryClientProvider>);

    expect(await screen.findByRole("heading", { name: "Shop" })).toBeTruthy();
    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("live: pro")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/local/tenancy/projects/shop/overview", { cache: "no-store" });
    queryClient.clear();
  });
});
