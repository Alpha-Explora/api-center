import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardClient } from "@/components/dashboard-client";
import type {
  PlatformLifecycle,
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  getPlatformLifecycleEvidence: vi.fn(),
  getQuotaUsage: vi.fn(),
  listQuotaPolicies: vi.fn(),
  listServices: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/dashboard-alert-strip", () => ({
  DashboardAlertStrip: () => <section>Issues summary</section>,
}));

vi.mock("@/components/gateway-traffic-summary", () => ({
  GatewayTrafficSummary: () => <section>Gateway traffic</section>,
}));

const services: ServiceRegistryEntry[] = [
  {
    serviceId: "payment-api",
    name: "Payment API",
    baseUrl: "https://payment.example.test",
    requiredScopes: ["payment:checkout"],
    exposes: ["/payments"],
    consumes: ["missing-risk-engine"],
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    tags: ["payment"],
    ownerTeam: "Payments",
    contact: "payments@example.test",
    serviceTier: "critical",
    costCenter: "PAY",
    registeredAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    status: "active",
  },
  {
    serviceId: "claims-api",
    name: "Claims API",
    baseUrl: "https://claims.example.test",
    requiredScopes: ["claims:read"],
    exposes: ["/claims"],
    consumes: [],
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    tags: ["claims"],
    ownerTeam: "Claims",
    contact: "claims@example.test",
    serviceTier: "standard",
    costCenter: "CLM",
    registeredAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
    status: "active",
  },
];

const quotaPolicies: QuotaPolicy[] = [
  {
    id: "claims-weekly-risk",
    ownerTribeId: "claims-api",
    scope: "all",
    targetServiceId: null,
    windowSeconds: 604800,
    maxRequests: 1000,
    burstRequests: null,
    mode: "observe",
    status: "active",
    reason: "Weekly risk forecast",
    updatedAt: "2026-05-16T00:00:00.000Z",
  },
];

const quotaUsage: QuotaUsageDecision[] = [
  {
    id: "usage-claims-weekly-risk",
    policyId: "claims-weekly-risk",
    ownerTribeId: "claims-api",
    scope: "all",
    targetServiceId: null,
    routeFamily: "all",
    windowStart: "2026-06-08T00:00:00.000Z",
    windowEnd: "2026-06-15T00:00:00.000Z",
    requestCount: 920,
    maxRequests: 1000,
    mode: "observe",
    outcome: "allowed",
    forecast: {
      status: "warning",
      daysUntilExhaustion: 2,
      projectedMonthlyUsage: 4000,
    },
    createdAt: "2026-06-14T00:00:00.000Z",
  },
];

const sourceLifecycle: PlatformLifecycle = {
  generatedAt: "2026-06-15T04:00:00.000Z",
  summary: {
    total: 1,
    blocked: 0,
    attention: 0,
    ready: 1,
  },
  entries: [
    {
      service: {
        serviceId: "source-api",
        name: "Source API",
        baseUrl: "https://source.example.test",
        requiredScopes: ["source:read"],
        exposes: ["/source"],
        consumes: [],
        ownerTribeId: "source",
        serviceType: "tribe",
        healthCheck: "/health",
        version: "1.0.0",
        tags: [],
        ownerTeam: "Source",
        contact: "source@example.test",
        serviceTier: "standard",
        registeredAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
        status: "active",
      },
      ownerTribeId: "source",
      status: "ready",
      stages: [
        {
          id: "promotion",
          label: "Promotion",
          status: "complete",
          evidence: "Approved request approval-1.",
          source: "approval-request",
          action: "Review live promotion gates.",
          href: "/promotions",
        },
      ],
      blockedCount: 0,
      attentionCount: 0,
      nextAction: {
        stageId: "promotion",
        label: "Review live promotion gates.",
        href: "/promotions",
      },
    },
  ],
};

describe("DashboardClient command center", () => {
  beforeEach(() => {
    apiClient.getPlatformLifecycleEvidence.mockResolvedValue(sourceLifecycle);
    apiClient.listServices.mockResolvedValue(services);
    apiClient.listQuotaPolicies.mockResolvedValue(quotaPolicies);
    apiClient.getQuotaUsage.mockResolvedValue(quotaUsage);
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("keeps meaningful dashboard structure visible while registry data loads", () => {
    apiClient.listServices.mockReturnValue(new Promise(() => undefined));

    renderWithClient(<DashboardClient />);

    expect(screen.getByRole("heading", { name: "Platform health" })).toBeTruthy();
    expect(screen.getByText("Loading registry data")).toBeTruthy();
    expect(screen.getByRole("link", { name: /readiness/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /open registry/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "Loading service registry, quotas, and governance evidence.",
    );
    expect(screen.getByText("Action queue")).toBeTruthy();
    expect(screen.getByText("Selected issue")).toBeTruthy();
  });

  it("renders platform health, severity-first action queue, and detail rail", async () => {
    renderWithClient(<DashboardClient />);

    expect(await screen.findByText("Service lifecycle")).toBeTruthy();
    expect(screen.getByText("Platform health")).toBeTruthy();
    expect(screen.getByRole("link", { name: /open full lifecycle/i })).toBeTruthy();
    expect(screen.getByText("Action queue")).toBeTruthy();
    expect(screen.getByText("Selected issue")).toBeTruthy();
    expect(screen.getAllByText("Evidence").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Next action").length).toBeGreaterThan(0);
    expect(screen.getByText("Critical")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getAllByText("Runtime").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Registry").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quotas").length).toBeGreaterThan(0);
  });

  it("uses source-backed lifecycle evidence on the dashboard when available", async () => {
    renderWithClient(<DashboardClient />);

    expect((await screen.findAllByText("Source API")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("1 ready")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Review live promotion gates." })
        .getAttribute("href"),
    ).toBe("/tribes/source-api?section=governance");
    expect(apiClient.getPlatformLifecycleEvidence).toHaveBeenCalled();
  });

  it("updates the detail rail without navigating when a queue item is selected", async () => {
    renderWithClient(<DashboardClient />);

    const quotaIssue = await screen.findByRole("button", {
      name: /Quota forecast crosses 90% this week/i,
    });
    fireEvent.click(quotaIssue);

    expect(screen.getByText("Selected issue")).toBeTruthy();
    expect(screen.getByText("Quota forecast crosses 90% this week")).toBeTruthy();
    expect(screen.getByText("Review quota policy")).toBeTruthy();
  });

  it("routes selected queue actions into the relevant service detail section", async () => {
    renderWithClient(<DashboardClient />);

    expect(
      (
        await screen.findByRole("link", {
          name: /open dependency detail/i,
        })
      ).getAttribute("href"),
    ).toBe("/tribes/payment-api?section=dependencies");

    fireEvent.click(
      screen.getByRole("button", {
        name: /Quota forecast crosses 90% this week/i,
      }),
    );

    expect(
      screen
        .getByRole("link", { name: /open quota detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/claims-api?section=quotas");
  });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
