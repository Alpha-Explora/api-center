import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectOverviewClient } from "@/components/project-overview-client";

vi.mock("@/components/page-heading", () => ({ PageHeading: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));

function overviewData() {
  return {
    project: { projectId: "shop", name: "Shop", status: "active" },
    tribe: { tribeId: "acme", name: "Acme", status: "active" },
    services: [
      { serviceId: "checkout", name: "Checkout", status: "active", environments: [{ environment: "test", status: "healthy" }, { environment: "live", status: "healthy" }] },
      { serviceId: "orders", name: "Orders", status: "active", environments: [{ environment: "test", status: "healthy" }, { environment: "live", status: "healthy" }] },
    ],
    plans: [{ environment: "live", assignment: { planKey: "pro", status: "active" }, effectiveLimits: [{ scope: "all", maxRequests: 9000, windowSeconds: 86400, source: "plan" }] }],
    quotaPolicyOverrides: [],
    paymentConsumerRegistrations: [],
    recentQuotaDecisions: [],
  };
}

function responseForRequest(input: RequestInfo | URL) {
  const url = String(input);
  if (url.includes("/setup-status?")) {
    const parsed = new URL(url, "http://localhost");
    const serviceId = parsed.searchParams.get("serviceId") ?? "";
    const environment = parsed.searchParams.get("environment") ?? "test";
    return Response.json({
      success: true,
      data: {
        projectId: "shop",
        serviceId,
        environment,
        checks: [{ id: "service-registration", status: "ready", detail: `setup:${serviceId}:${environment}`, fix: "" }],
      },
    });
  }
  return Response.json({ success: true, data: overviewData() });
}

describe("ProjectOverviewClient", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("loads and displays the project overview from its local API route", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => responseForRequest(input));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ProjectOverviewClient projectId="shop" /></QueryClientProvider>);

    expect(await screen.findByRole("heading", { name: "Shop" })).toBeTruthy();
    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("live: pro")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/local/tenancy/projects/shop/overview", { cache: "no-store" });
    queryClient.clear();
  });

  it("keeps hook order through overview loading and refreshes setup checks when service or environment changes", async () => {
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      requests.push(String(input));
      return responseForRequest(input);
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ProjectOverviewClient projectId="shop" /></QueryClientProvider>);

    expect(screen.queryByText("Setup status")).toBeNull();
    expect(await screen.findByText("setup:checkout:test")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "orders" } });
    expect(await screen.findByText("setup:orders:test")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "live" } });
    expect(await screen.findByText("setup:orders:live")).toBeTruthy();
    await waitFor(() => expect(requests).toContain("/api/local/tenancy/projects/shop/setup-status?serviceId=orders&environment=live"));
    expect(fetchMock).toHaveBeenCalled();
    queryClient.clear();
  });
});
