import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentPromotionPanel } from "@/components/environment-promotion-panel";
import type {
  AuditEvent,
  QuotaPolicy,
  ServiceRegistrationRequest,
  ServiceRegistryEntry,
  TribePlanAssignment,
} from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  getAuditEvents: vi.fn(),
  getConfluentPipelineStatus: vi.fn(),
  listQuotaPolicies: vi.fn(),
  listRegistrationRequests: vi.fn(),
  listServices: vi.fn(),
  listTribePlanAssignments: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

const service: ServiceRegistryEntry = {
  serviceId: "logistics",
  name: "Logistics API",
  baseUrl: "https://logistics.example.test",
  requiredScopes: ["orders:read", "external:kafka:write"],
  exposes: ["/orders"],
  consumes: ["payment", "kafka"],
  serviceType: "tribe",
  healthCheck: "/health",
  version: "1.0.0",
  tags: [],
  projectId: "logistics-default",
  ownerTribeId: "logistics",
  ownerTeam: "Logistics",
  contact: "logistics@example.test",
  serviceTier: "standard",
  costCenter: "OPS",
  registeredAt: "2026-05-25T00:00:00.000Z",
  updatedAt: "2026-05-25T00:00:00.000Z",
  status: "active",
};

describe("EnvironmentPromotionPanel", () => {
  beforeEach(() => {
    apiClient.listServices.mockResolvedValue([service]);
    apiClient.listQuotaPolicies.mockResolvedValue([]);
    apiClient.listTribePlanAssignments.mockResolvedValue([]);
    apiClient.getAuditEvents.mockResolvedValue([]);
    apiClient.listRegistrationRequests.mockResolvedValue([]);
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      serviceId: "logistics",
      ownerTribeId: "logistics",
      topicName: "tribe.logistics.events",
      topicCheckOk: true,
      topicExists: false,
      s3SinkCheckOk: true,
      s3SinkIncludesTopic: false,
      connectorName: "api-center-s3-sink",
      topics: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("blocks live promotion when required evidence is missing", async () => {
    apiClient.listServices.mockResolvedValue([
      {
        ...service,
        healthy: false,
        ownerTeam: "",
        contact: "",
      },
    ]);

    renderWithClient(
      <EnvironmentPromotionPanel initialServiceId="logistics" />,
    );

    expect(await screen.findByText("Blocked from live")).toBeTruthy();
    expect(
      screen.getAllByText("No passing health check evidence.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Owner team or contact is missing.")).toBeTruthy();
    expect(screen.getByText("Required event topic is missing.")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /run check health/i }).getAttribute("href"),
    ).toBe("/tribes/logistics?section=actions");
  });

  it("uses one selected promotion gate detail panel for evidence and action", async () => {
    apiClient.listServices.mockResolvedValue([
      {
        ...service,
        healthy: false,
        ownerTeam: "",
        contact: "",
      },
    ]);

    renderWithClient(
      <EnvironmentPromotionPanel initialServiceId="logistics" />,
    );

    expect(
      await screen.findByLabelText("Selected promotion gate detail"),
    ).toBeTruthy();
    expect(screen.getByText("Selected gate")).toBeTruthy();
    expect(screen.getAllByText("Health check").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("No passing health check evidence.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: "Inspect promotion gate Quota policy",
        pressed: false,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect promotion gate Quota policy",
      }),
    );

    expect(
      screen.getAllByText("No active observe/enforce quota policy.").length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("link", { name: /create an observe-mode quota policy/i })
        .getAttribute("href"),
    ).toBe("/tribes/logistics?section=quotas");
    expect(
      screen.getByRole("button", {
        name: "Inspect promotion gate Quota policy",
        pressed: true,
      }),
    ).toBeTruthy();
  });

  it("selects the first service without requiring an initial service id", async () => {
    renderWithClient(<EnvironmentPromotionPanel />);

    expect(
      (await screen.findAllByText("Logistics API")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByDisplayValue("logistics")).toBeTruthy();
  });

  it("keeps service context links visible from promotion gates", async () => {
    renderWithClient(
      <EnvironmentPromotionPanel initialServiceId="logistics" />,
    );

    const context = await screen.findByLabelText("Promotion service context");

    expect(context.textContent).toContain("logistics");
    expect(context.textContent).toContain("Logistics API");
    expect(
      screen
        .getByRole("link", { name: "Open service detail" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics?section=summary");
    expect(
      screen
        .getByRole("link", { name: "Open audit trail" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics?section=evidence");
    expect(
      screen
        .getByRole("link", { name: "Open portal preview" })
        .getAttribute("href"),
    ).toBe("/developer-portal?tribeId=logistics");
    expect(
      screen
        .getByRole("link", { name: "Open quota workspace" })
        .getAttribute("href"),
    ).toBe("/tribes/logistics?section=quotas");
  });

  it("shows ready when every promotion gate has evidence", async () => {
    apiClient.listServices.mockResolvedValue([
      {
        ...service,
        healthy: true,
        lastHealthCheckAt: "2026-05-25T01:00:00.000Z",
      },
    ]);
    apiClient.listQuotaPolicies.mockResolvedValue([
      {
        id: "quota-1",
        ownerTribeId: "logistics",
        scope: "all",
        targetServiceId: null,
        windowSeconds: 86400,
        maxRequests: 25000,
        mode: "observe",
        status: "active",
        reason: "standard live plan",
        updatedAt: "2026-05-25T01:00:00.000Z",
      } satisfies QuotaPolicy,
    ]);
    apiClient.listTribePlanAssignments.mockResolvedValue([
      {
        id: "plan-1",
        ownerTribeId: "logistics",
        projectId: "logistics-default",
        planKey: "standard",
        environment: "live",
        status: "active",
        effectiveAt: "2026-05-25T01:00:00.000Z",
        reason: "approved live rollout",
        assignedBy: "platform@example.test",
      } satisfies TribePlanAssignment,
    ]);
    apiClient.getAuditEvents.mockResolvedValue([
      auditEvent("smoke.safe.passed", "Safe smoke checks passed"),
    ]);
    apiClient.listRegistrationRequests.mockResolvedValue([
      {
        id: "request-1",
        serviceId: "logistics",
        ownerTribeId: "logistics",
        projectId: "logistics-default",
        status: "approved",
        manifest: service,
        validationReport: { canApply: true, issues: [] },
        createdAt: "2026-05-25T01:00:00.000Z",
        updatedAt: "2026-05-25T01:00:00.000Z",
      } satisfies ServiceRegistrationRequest,
    ]);
    apiClient.getConfluentPipelineStatus.mockResolvedValue({
      serviceId: "logistics",
      ownerTribeId: "logistics",
      topicName: "tribe.logistics.events",
      topicCheckOk: true,
      topicExists: true,
      s3SinkCheckOk: true,
      s3SinkIncludesTopic: true,
      connectorName: "api-center-s3-sink",
      topics: ["tribe.logistics.events"],
    });

    renderWithClient(
      <EnvironmentPromotionPanel initialServiceId="logistics" />,
    );

    expect(await screen.findByText("Ready for live approval")).toBeTruthy();
    expect(screen.getAllByText("pass").length).toBeGreaterThanOrEqual(9);
    expect(screen.getByLabelText("Selected promotion gate detail")).toBeTruthy();
    expect(apiClient.listTribePlanAssignments).toHaveBeenCalledWith({
      projectId: "logistics-default",
      environment: "live",
      status: "active",
    });
  });
});

function auditEvent(type: string, message: string): AuditEvent {
  return {
    id: type,
    type,
    serviceId: "logistics",
    severity: "info",
    message,
    timestamp: "2026-05-25T01:00:00.000Z",
  };
}

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
