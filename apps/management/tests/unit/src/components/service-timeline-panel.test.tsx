import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceTimelinePanel } from "../../../../src/components/service-timeline-panel";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  getAuditEvents: vi.fn(),
  getSharedServiceRuntimeUsage: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

const service: ServiceRegistryEntry = {
  serviceId: "flow-ci",
  name: "Flow CI",
  version: "1.0.0",
  baseUrl: "https://flow-ci.example.com",
  healthCheck: "/health",
  serviceType: "tribe",
  ownerTeam: "Flow",
  contact: "ops@example.com",
  tags: [],
  serviceTier: "standard",
  consumes: ["payment"],
  exposes: ["/health"],
  requiredScopes: ["shared:payment:invoke"],
  status: "active",
  registeredAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T01:00:00.000Z",
};

describe("ServiceTimelinePanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads audit and usage signals into the service timeline", async () => {
    apiClient.getAuditEvents.mockResolvedValue([
      {
        id: "audit-1",
        type: "confluent.topic.provision",
        serviceId: "flow-ci",
        severity: "info",
        message: "Topic provisioned",
        payload: { operatorEmail: "admin@example.com", environment: "test" },
        timestamp: "2026-05-17T03:00:00.000Z",
      },
    ]);
    apiClient.getSharedServiceRuntimeUsage.mockResolvedValue([
      {
        tribeServiceId: "flow-ci",
        sharedServiceId: "payment",
        window: "24h",
        totalRequests: 2,
        successRequests: 2,
        failedRequests: 0,
        errorRate: 0,
        avgLatencyMs: 120,
        lastUsedAt: "2026-05-17T04:00:00.000Z",
      },
    ]);

    renderWithClient(<ServiceTimelinePanel service={service} />);

    await waitFor(() =>
      expect(apiClient.getAuditEvents).toHaveBeenCalledWith({
        serviceId: "flow-ci",
        limit: 50,
      }),
    );
    expect(await screen.findByText("Topic provisioned")).toBeTruthy();
    expect(screen.getByText("flow-ci called payment")).toBeTruthy();
    expect(screen.getByText("Current readiness")).toBeTruthy();
    expect(screen.getByText("Action type")).toBeTruthy();
    expect(screen.getByText("Actor")).toBeTruthy();
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
