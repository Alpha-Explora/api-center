import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncidentSupportPanel } from "@/components/incident-support-panel";

const apiClient = vi.hoisted(() => ({
  getAuditEvents: vi.fn(),
  getProviderUsage: vi.fn(),
  getSharedServiceRuntimeUsage: vi.fn(),
  listQuotaPolicies: vi.fn(),
  listServices: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("IncidentSupportPanel", () => {
  beforeEach(() => {
    apiClient.listServices.mockResolvedValue([
      {
        serviceId: "payment-service",
        name: "Payments",
        baseUrl: "https://payment.internal",
        serviceType: "shared",
        status: "active",
        requiredScopes: ["payments:write"],
        exposes: ["/checkout"],
        consumes: [],
        registeredAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ]);
    apiClient.getSharedServiceRuntimeUsage.mockResolvedValue([
      {
        tribeServiceId: "campus-one",
        sharedServiceId: "payment-service",
        window: "24h",
        totalRequests: 20,
        successRequests: 12,
        failedRequests: 8,
        errorRate: 0.4,
        avgLatencyMs: 220,
        p95LatencyMs: 900,
      },
    ]);
    apiClient.getAuditEvents.mockResolvedValue([
      {
        id: "audit-1",
        timestamp: "2026-05-25T00:00:00.000Z",
        type: "quota.policy.updated",
        severity: "warning",
        serviceId: "payment-service",
        message: "Quota policy changed",
      },
    ]);
    apiClient.listQuotaPolicies.mockResolvedValue([
      {
        id: "quota-1",
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "payment-service",
        windowSeconds: 60,
        maxRequests: 100,
        mode: "enforce",
        status: "active",
        reason: "Protect provider",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ]);
    apiClient.getProviderUsage.mockResolvedValue([
      {
        provider: "payment-service",
        window: "24h",
        totalRequests: 20,
        failedRequests: 8,
        errorRate: 0.4,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders incident evidence and runbook links", async () => {
    renderWithClient(<IncidentSupportPanel initialTarget="payment-service" />);

    expect(
      (await screen.findAllByText("payment-service")).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("8 failed calls")).toBeTruthy();
    expect(screen.getAllByText("Quota policy changed").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("enforce shared")).toBeTruthy();
    expect(screen.getByText("40% provider error rate")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open incident runbook/i }),
    ).toBeTruthy();
  });

  it("prioritizes incident actions with one selected action detail", async () => {
    renderWithClient(<IncidentSupportPanel initialTarget="payment-service" />);

    const detail = await screen.findByLabelText("Selected incident action detail");
    expect(detail.textContent).toContain("Provider recovery");
    expect(detail.textContent).toContain(
      "40% provider error rate across 8 failed calls.",
    );
    expect(
      screen
        .getByRole("link", { name: /open service health/i })
        .getAttribute("href"),
    ).toBe("/tribes/payment-service?section=health");

    const quotaButton = screen.getByRole("button", {
      name: /inspect incident action active enforce quota/i,
    });
    expect(quotaButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(quotaButton);

    expect(detail.textContent).toContain("Active enforce quota");
    expect(detail.textContent).toContain(
      "enforce quota is active for shared payment-service traffic.",
    );
    expect(
      screen
        .getByRole("link", { name: /open quota posture/i })
        .getAttribute("href"),
    ).toBe("/tribes/campus-one?section=quotas");
    expect(quotaButton.getAttribute("aria-pressed")).toBe("true");
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
