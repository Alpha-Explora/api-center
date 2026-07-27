import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribeReliabilityPanel } from "@/components/tribe-reliability-panel";

const apiClient = vi.hoisted(() => ({
  getAuditEvents: vi.fn(),
  getQuotaUsage: vi.fn(),
  getSharedServiceRuntimeUsage: vi.fn(),
  listServices: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("TribeReliabilityPanel", () => {
  beforeEach(() => {
    apiClient.listServices.mockResolvedValue([
      service("campus-one", { consumes: ["payment-service"] }),
      service("payment-service", { serviceType: "shared" }),
    ]);
    apiClient.getSharedServiceRuntimeUsage.mockResolvedValue([
      {
        tribeServiceId: "campus-one",
        sharedServiceId: "payment-service",
        window: "24h",
        totalRequests: 100,
        successRequests: 95,
        failedRequests: 5,
        errorRate: 0.05,
        avgLatencyMs: 120,
        p95LatencyMs: 480,
      },
    ]);
    apiClient.getQuotaUsage.mockResolvedValue([
      quota("allowed"),
      quota("observed_exceeded"),
      quota("blocked"),
    ]);
    apiClient.getAuditEvents.mockResolvedValue([
      {
        id: "audit-1",
        timestamp: "2026-05-25T00:00:00.000Z",
        type: "service.deployed",
        severity: "info",
        serviceId: "campus-one",
        message: "campus-one deployed",
      },
      {
        id: "audit-2",
        timestamp: "2026-05-25T00:01:00.000Z",
        type: "kafka.publish.failed",
        severity: "error",
        serviceId: "campus-one",
        message: "Kafka publish failed",
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders per-tribe reliability metrics", async () => {
    renderWithClient(<TribeReliabilityPanel initialTribeId="campus-one" />);

    expect(await screen.findByText("campus-one")).toBeTruthy();
    expect(screen.getByText("95%")).toBeTruthy();
    expect(screen.getByText("480 ms")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("1 observed / 1 blocked")).toBeTruthy();
    expect(screen.getByText("1 Kafka failure")).toBeTruthy();
    expect(screen.getAllByText("payment-service").length).toBeGreaterThan(0);
    expect(screen.getAllByText("campus-one deployed").length).toBeGreaterThan(
      0,
    );
  });

  it("prioritizes reliability signals with one selected evidence detail", async () => {
    renderWithClient(<TribeReliabilityPanel initialTribeId="campus-one" />);

    const detail = await screen.findByLabelText(
      "Selected reliability signal detail",
    );
    expect(detail.textContent).toContain("Quota blocked");
    expect(detail.textContent).toContain("1 quota decision blocked.");
    expect(
      screen
        .getByRole("link", { name: /review quota decisions/i })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=quotas");

    const sharedFailuresButton = screen.getByRole("button", {
      name: /inspect reliability signal shared-service failures/i,
    });
    expect(sharedFailuresButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(sharedFailuresButton);

    expect(detail.textContent).toContain(
      "5 shared-service calls failed in the last 24h.",
    );
    expect(
      screen
        .getByRole("link", { name: /review shared-service usage/i })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=dependencies");
    expect(sharedFailuresButton.getAttribute("aria-pressed")).toBe("true");
  });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function service(serviceId: string, overrides: Record<string, unknown> = {}) {
  return {
    serviceId,
    name: serviceId,
    baseUrl: `https://${serviceId}.internal`,
    requiredScopes: [`${serviceId}:read`],
    exposes: ["/health"],
    consumes: [],
    serviceType: "tribe",
    status: "active",
    registeredAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides,
  };
}

function quota(outcome: "allowed" | "observed_exceeded" | "blocked") {
  return {
    id: `quota-${outcome}`,
    ownerTribeId: "campus-one",
    scope: "all",
    routeFamily: "shared:payment-service",
    windowStart: "2026-05-25T00:00:00.000Z",
    windowEnd: "2026-05-25T01:00:00.000Z",
    requestCount: 1,
    maxRequests: 100,
    mode: "observe",
    outcome,
    createdAt: "2026-05-25T00:00:00.000Z",
  };
}
