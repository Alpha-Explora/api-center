import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceDetailClient } from "@/components/service-detail-client";
import type {
  PlatformLifecycle,
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  activateService: vi.fn(),
  checkServiceHealth: vi.fn(),
  deprecateService: vi.fn(),
  deregisterService: vi.fn(),
  getDataPipelineCost: vi.fn(),
  getDataPipelineDecisionSignals: vi.fn(),
  getDataPipelineGatewayDecisions: vi.fn(),
  getDataPipelineHealth: vi.fn(),
  getDataPipelineQuality: vi.fn(),
  getDataPipelineSharedServiceUsage: vi.fn(),
  getApiCenterBaseUrl: vi.fn(),
  getPlatformLifecycleEvidence: vi.fn(),
  getQuotaUsage: vi.fn(),
  getService: vi.fn(),
  listQuotaPolicies: vi.fn(),
  listServices: vi.fn(),
  previewTribeSecretProvision: vi.fn(),
  provisionTribeSecret: vi.fn(),
  retireService: vi.fn(),
}));

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/components/confluent-provisioning-card", () => ({
  ConfluentProvisioningCard: () => <section>Confluent data pipeline</section>,
}));

vi.mock("@/components/contract-tester-panel", () => ({
  ContractTesterPanel: () => <section>Contract tester</section>,
}));

vi.mock("@/components/event-mapping-panel", () => ({
  EventMappingPanel: () => <section>Event and S3 mapping</section>,
}));

vi.mock("@/components/onboarding-checklist-panel", () => ({
  OnboardingChecklistPanel: () => <section>Onboarding checklist</section>,
}));

vi.mock("@/components/sdk-config-panel", () => ({
  SdkConfigPanel: () => <section>SDK onboarding</section>,
}));

vi.mock("@/components/tribe-deprovisioning-card", () => ({
  TribeDeprovisioningCard: () => <section>Tribe deprovisioning</section>,
}));

vi.mock("@/components/tribe-observability-panel", () => ({
  TribeObservabilityPanel: () => <section>Tribe observability</section>,
}));

vi.mock("@/components/service-detail/service-pipeline-panel", () => ({
  ServicePipelinePanel: ({ pipelineHealthRows = [] }: { pipelineHealthRows?: Array<{ eventType?: string }> }) => (
    <section>
      Data pipeline health
      {pipelineHealthRows.map((row) => (
        <span key={row.eventType}>{row.eventType}</span>
      ))}
    </section>
  ),
}));

vi.mock("@/components/tribe-onboarding-flow", () => ({
  TribeOnboardingFlow: () => <section>Onboarding flow</section>,
}));

const service: ServiceRegistryEntry = {
  serviceId: "smoke-tribe",
  name: "Smoke Tribe",
  baseUrl: "https://smoke.example.test",
  requiredScopes: ["payment:checkout"],
  exposes: ["/orders"],
  consumes: ["payment"],
  serviceType: "tribe",
  healthCheck: "/health",
  version: "1.0.0",
  tags: ["smoke"],
  ownerTeam: "Platform",
  contact: "platform@example.test",
  serviceTier: "standard",
  costCenter: "ENG",
  registeredAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  status: "active",
  environments: [
    {
      environment: "test",
      baseUrl: "https://smoke.example.test",
      healthCheck: "/health",
      status: "active",
    },
  ],
};

const sharedPaymentService: ServiceRegistryEntry = {
  serviceId: "payment",
  name: "Payment Service",
  baseUrl: "https://payment.example.test",
  requiredScopes: ["payment:checkout"],
  exposes: ["/charge"],
  consumes: [],
  serviceType: "shared",
  healthCheck: "/health",
  version: "2.1.0",
  tags: ["payment"],
  ownerTeam: "Shared Services",
  contact: "shared@example.test",
  serviceTier: "standard",
  registeredAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  status: "active",
  environments: [
    {
      environment: "test",
      baseUrl: "https://payment.example.test",
      healthCheck: "/health",
      status: "active",
    },
  ],
};

const checkoutConsumerService: ServiceRegistryEntry = {
  serviceId: "checkout-tribe",
  name: "Checkout Tribe",
  baseUrl: "https://checkout.example.test",
  requiredScopes: ["checkout:write"],
  exposes: ["/checkout"],
  consumes: ["smoke-tribe"],
  serviceType: "tribe",
  healthCheck: "/health",
  version: "1.2.0",
  tags: ["checkout"],
  ownerTeam: "Checkout",
  contact: "checkout@example.test",
  serviceTier: "standard",
  registeredAt: "2026-05-16T00:00:00.000Z",
  updatedAt: "2026-05-16T00:00:00.000Z",
  status: "active",
  environments: [
    {
      environment: "test",
      baseUrl: "https://checkout.example.test",
      healthCheck: "/health",
      status: "active",
    },
  ],
};

const sourceLifecycle: PlatformLifecycle = {
  generatedAt: "2026-06-15T04:00:00.000Z",
  summary: {
    total: 1,
    blocked: 1,
    attention: 0,
    ready: 0,
  },
  entries: [
    {
      service,
      ownerTribeId: "smoke-tribe",
      status: "blocked",
      blockedCount: 1,
      attentionCount: 0,
      nextAction: {
        stageId: "pipeline",
        label: "Verify topic and S3 sink inclusion.",
        href: "/tribes/smoke-tribe?section=pipeline",
      },
      stages: [
        {
          id: "pipeline",
          label: "Pipeline",
          status: "blocked",
          evidence: "No prod pipeline-health row is available.",
          source: "pipeline-health",
          action: "Verify topic and S3 sink inclusion.",
          href: "/tribes/smoke-tribe?section=pipeline",
        },
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
    },
  ],
};

const quotaPolicies: QuotaPolicy[] = [
  {
    id: "claims-weekly-risk",
    ownerTribeId: "smoke-tribe",
    scope: "tribe",
    windowSeconds: 604800,
    maxRequests: 1000,
    burstRequests: 100,
    mode: "observe",
    status: "active",
    reason: "Weekly risk forecast",
    updatedAt: "2026-06-15T03:00:00.000Z",
  },
];

const quotaUsage: QuotaUsageDecision[] = [
  {
    id: "usage-weekly-risk",
    ownerTribeId: "smoke-tribe",
    policyId: "claims-weekly-risk",
    scope: "tribe",
    routeFamily: "orders",
    windowStart: "2026-06-14T04:00:00.000Z",
    windowEnd: "2026-06-15T04:00:00.000Z",
    requestCount: 920,
    maxRequests: 1000,
    mode: "observe",
    outcome: "allowed",
    forecast: {
      status: "warning",
      daysUntilExhaustion: 2,
      projectedMonthlyUsage: 28000,
    },
    correlationId: "quota-correlation-1",
    createdAt: "2026-06-15T04:00:00.000Z",
  },
];

describe("ServiceDetailClient route sections", () => {
  beforeEach(() => {
    navigation.searchParams = new URLSearchParams();
    apiClient.getDataPipelineCost.mockResolvedValue([]);
    apiClient.getDataPipelineDecisionSignals.mockResolvedValue([]);
    apiClient.getDataPipelineGatewayDecisions.mockResolvedValue([]);
    apiClient.getDataPipelineHealth.mockResolvedValue([]);
    apiClient.getDataPipelineQuality.mockResolvedValue([]);
    apiClient.getDataPipelineSharedServiceUsage.mockResolvedValue([]);
    apiClient.getApiCenterBaseUrl.mockReturnValue(
      "https://api-center.itsandbox.site",
    );
    apiClient.getPlatformLifecycleEvidence.mockResolvedValue(sourceLifecycle);
    apiClient.getQuotaUsage.mockResolvedValue(quotaUsage);
    apiClient.getService.mockResolvedValue(service);
    apiClient.listQuotaPolicies.mockResolvedValue(quotaPolicies);
    apiClient.listServices.mockResolvedValue([service]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    { section: undefined, activeSection: "Summary", visibleText: "Current issue" },
    { section: "health", activeSection: "Health", visibleText: "Service health" },
    { section: "dependencies", activeSection: "Dependencies", visibleText: "Dependency impact" },
    { section: "quotas", activeSection: "Quotas", visibleText: "Quota posture" },
    { section: "pipeline", activeSection: "Pipeline", visibleText: "Pipeline posture" },
    { section: "governance", activeSection: "Governance", visibleText: "Governance posture" },
    { section: "evidence", activeSection: "Evidence", visibleText: "Evidence timeline" },
    { section: "actions", activeSection: "Actions", visibleText: "Safe actions" },
  ])(
    "selects the $activeSection section from the route query",
    async ({ section, activeSection, visibleText }) => {
      const { container } = renderWithClient(
        <ServiceDetailClient
          serviceId="smoke-tribe"
          initialSection={section}
        />,
      );

      await screen.findByText(visibleText);

      const activeLink = container.querySelector(
        '[data-service-section][aria-current="page"]',
      );
      expect(activeLink?.textContent).toContain(activeSection);
    },
  );

  it("renders only the selected service detail section", async () => {
    renderWithClient(
      <ServiceDetailClient
        serviceId="smoke-tribe"
        initialSection="dependencies"
      />,
    );

    expect(await screen.findByText("Dependency impact")).toBeTruthy();
    expect(screen.queryByText("Service health")).toBeNull();
    expect(screen.queryByText("Evidence timeline")).toBeNull();
  });

  it("loads data pipeline health rows for tribe observability", async () => {
    apiClient.getService.mockResolvedValue({
      ...service,
      serviceId: "codex-sdk-20260520041053",
      name: "Codex SDK Smoke",
      ownerTribeId: "codex-sdk-20260520041053",
    });
    apiClient.getDataPipelineHealth.mockResolvedValue([
      {
        environment: "test",
        tribeId: "codex-sdk-20260520041053",
        sourceServiceId: "codex-sdk-20260520041053-api",
        eventType: "codex.pipeline.flush",
        eventDay: "2026-05-20",
        eventCount: 1000,
        latestOccurredAt: "2026-05-20T09:41:45.721Z",
        latestIngestedAt: "2026-05-20T09:42:00.000Z",
      },
    ]);

    renderWithClient(
      <ServiceDetailClient
        serviceId="codex-sdk-20260520041053"
        initialSection="observability"
      />,
    );

    expect(await screen.findByText("Data pipeline health")).toBeTruthy();
    expect(await screen.findByText("codex.pipeline.flush")).toBeTruthy();
    expect(apiClient.getDataPipelineHealth).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({
        day: expect.any(String),
        month: expect.any(String),
        year: expect.any(String),
      }),
    );
  });

  it("shows environment-specific endpoints on service detail", async () => {
    apiClient.getService.mockResolvedValue({
      ...service,
      serviceId: "trinithrive",
      name: "TriniThrive",
      baseUrl: "https://trinithrive-test.example.com",
      environments: [
        {
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
          healthCheck: "/health",
          status: "active",
        },
        {
          environment: "staging",
          baseUrl: "https://trinithrive-staging.example.com",
          healthCheck: "/health",
          status: "active",
        },
      ],
    });
    apiClient.listServices.mockResolvedValue([]);

    renderWithClient(
      <ServiceDetailClient serviceId="trinithrive" initialSection="summary" />,
    );

    expect(await screen.findByText("Service environments")).toBeTruthy();
    expect(screen.getByText("test")).toBeTruthy();
    expect(
      screen.getAllByText("https://trinithrive-test.example.com").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("staging")).toBeTruthy();
    expect(
      screen.getAllByText("https://trinithrive-staging.example.com").length,
    ).toBeGreaterThan(0);
  });

  it("updates the section query parameter when a section is selected", async () => {
    renderWithClient(
      <ServiceDetailClient serviceId="smoke-tribe" initialSection="summary" />,
    );

    await screen.findByText("Current issue");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Health Runtime checks and service ownership",
      }),
    );

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/tribes/smoke-tribe?section=health",
        { scroll: false },
      ),
    );
  });

  it("syncs the selected section when the route query changes without remounting", async () => {
    navigation.searchParams = new URLSearchParams("section=evidence");
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const { container, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ServiceDetailClient serviceId="smoke-tribe" initialSection="evidence" />
      </QueryClientProvider>,
    );

    await screen.findByText("Evidence timeline");

    navigation.searchParams = new URLSearchParams("section=pipeline");
    rerender(
      <QueryClientProvider client={queryClient}>
        <ServiceDetailClient serviceId="smoke-tribe" initialSection="evidence" />
      </QueryClientProvider>,
    );

    await screen.findByText("Data pipeline health");

    const activeLink = container.querySelector(
      '[data-service-section][aria-current="page"]',
    );
    expect(activeLink?.textContent).toContain("Pipeline");
  });

  it("turns the summary into a source-backed lifecycle command map", async () => {
    renderWithClient(
      <ServiceDetailClient serviceId="smoke-tribe" initialSection="summary" />,
    );

    const commandMap = await screen.findByLabelText(
      "Service lifecycle command map",
    );

    expect(apiClient.getPlatformLifecycleEvidence).toHaveBeenCalled();
    expect(commandMap.textContent).toContain("blocked");
    expect(commandMap.textContent).toContain(
      "Verify topic and S3 sink inclusion.",
    );
    expect(commandMap.textContent).toContain("Pipeline");
    expect(commandMap.textContent).toContain(
      "No prod pipeline-health row is available.",
    );
    expect(commandMap.textContent).toContain("pipeline-health");
    expect(commandMap.textContent).toContain("Promotion");
    expect(commandMap.textContent).toContain("Approved request approval-1.");
    expect(
      screen
        .getByRole("link", { name: "Open next action" })
        .getAttribute("href"),
    ).toBe("/tribes/smoke-tribe?section=pipeline");
    expect(
      screen
        .getByRole("link", { name: "Review live promotion gates." })
        .getAttribute("href"),
    ).toBe("/tribes/smoke-tribe?section=governance");
  });

  it("shows service-specific quota evidence in the quotas section", async () => {
    renderWithClient(
      <ServiceDetailClient serviceId="smoke-tribe" initialSection="quotas" />,
    );

    const quotaReview = await screen.findByText("Quota review");

    expect(quotaReview).toBeTruthy();
    expect(apiClient.listQuotaPolicies).toHaveBeenCalledWith("smoke-tribe");
    expect(apiClient.getQuotaUsage).toHaveBeenCalledWith({
      ownerTribeId: "smoke-tribe",
      window: "24h",
    });
    expect(await screen.findByText("claims-weekly-risk")).toBeTruthy();
    expect(screen.getByText("920 of 1,000 requests")).toBeTruthy();
    expect(screen.getByText("92% used")).toBeTruthy();
    expect(screen.getByText("forecast warning")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open quota workspace" })
        .getAttribute("href"),
    ).toBe("/tribes/smoke-tribe?section=quotas");
  });

  it("shows source-backed promotion readiness in the governance section", async () => {
    renderWithClient(
      <ServiceDetailClient
        serviceId="smoke-tribe"
        initialSection="governance"
      />,
    );

    const governanceReview = await screen.findByText("Governance review");

    expect(governanceReview).toBeTruthy();
    expect(screen.getByText("Promotion readiness")).toBeTruthy();
    expect(screen.getByText("Approved request approval-1.")).toBeTruthy();
    expect(screen.getByText("approval-request")).toBeTruthy();
    expect(screen.getByText("Review live promotion gates.")).toBeTruthy();
  });

  it("shows actionable dependency evidence in the dependencies section", async () => {
    apiClient.getService.mockResolvedValue({
      ...service,
      consumes: ["payment", "inventory"],
    });
    apiClient.listServices.mockResolvedValue([
      {
        ...service,
        consumes: ["payment", "inventory"],
      },
      sharedPaymentService,
      checkoutConsumerService,
    ]);

    renderWithClient(
      <ServiceDetailClient
        serviceId="smoke-tribe"
        initialSection="dependencies"
      />,
    );

    const dependencyReview = await screen.findByText("Dependency review");

    expect(dependencyReview).toBeTruthy();
    expect(screen.getAllByText("Direct dependencies").length).toBeGreaterThan(0);
    expect(screen.getByText("Payment Service")).toBeTruthy();
    expect(screen.getByText("payment")).toBeTruthy();
    expect(screen.getAllByText("inventory").length).toBeGreaterThan(0);
    expect(screen.getAllByText("missing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Consumer impact").length).toBeGreaterThan(0);
    expect(screen.getByText("Checkout Tribe")).toBeTruthy();
    expect(screen.getByText("Unresolved links")).toBeTruthy();
    expect(
      screen.getByText("Register inventory or remove it from the manifest."),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Edit dependency manifest" }).getAttribute(
        "href",
      ),
    ).toBe("/tribes/smoke-tribe/edit");
  });

  it("shows lifecycle evidence routes in the evidence section", async () => {
    renderWithClient(
      <ServiceDetailClient serviceId="smoke-tribe" initialSection="evidence" />,
    );

    const routeMap = await screen.findByLabelText("Lifecycle evidence route map");

    expect(routeMap.textContent).toContain("Pipeline");
    expect(routeMap.textContent).toContain(
      "No prod pipeline-health row is available.",
    );
    expect(routeMap.textContent).toContain("pipeline-health");
    expect(
      screen
        .getByRole("link", { name: "Open Pipeline section" })
        .getAttribute("href"),
    ).toBe("/tribes/smoke-tribe?section=pipeline");
  });

  it("keeps a lifecycle command map when source evidence has no matching service", async () => {
    apiClient.getPlatformLifecycleEvidence.mockResolvedValue({
      ...sourceLifecycle,
      entries: [],
      summary: {
        total: 0,
        blocked: 0,
        attention: 0,
        ready: 0,
      },
    });

    renderWithClient(
      <ServiceDetailClient serviceId="smoke-tribe" initialSection="summary" />,
    );

    const commandMap = await screen.findByLabelText(
      "Service lifecycle command map",
    );

    expect(commandMap.textContent).toContain("Registry");
    expect(commandMap.textContent).toContain("Ownership");
    expect(commandMap.textContent).toContain("Runtime");
    expect(commandMap.textContent).toContain("derived");
  });

  it("leaves page-level h1 ownership to the route shell", async () => {
    const { container } = renderWithClient(
      <ServiceDetailClient serviceId="smoke-tribe" initialSection="summary" />,
    );

    await screen.findByText("Current issue");

    expect(container.querySelectorAll("h1")).toHaveLength(0);
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
