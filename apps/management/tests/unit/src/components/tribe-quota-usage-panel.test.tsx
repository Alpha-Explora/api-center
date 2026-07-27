import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribeQuotaUsagePanel } from "@/components/tribe-quota-usage-panel";

const apiClient = vi.hoisted(() => ({
  getQuotaUsage: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("TribeQuotaUsagePanel", () => {
  beforeEach(() => {
    apiClient.getQuotaUsage.mockResolvedValue([
      {
        id: "decision-1",
        ownerTribeId: "campus-one",
        policyId: "quota-c1",
        scope: "shared",
        targetServiceId: "payment",
        routeFamily: "shared:payment",
        windowStart: "2026-05-25T02:00:00.000Z",
        windowEnd: "2026-05-25T02:01:00.000Z",
        requestCount: 120,
        maxRequests: 100,
        mode: "observe",
        outcome: "observed_exceeded",
        correlationId: "corr-1",
        createdAt: "2026-05-25T02:00:45.000Z",
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders quota usage decisions and refreshes by tribe and window", async () => {
    renderWithClient(<TribeQuotaUsagePanel />);

    expect((await screen.findAllByText("campus-one")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("payment")).toBeTruthy();
    expect(screen.getByText("120 / 100")).toBeTruthy();
    expect(screen.getByText("observed exceeded")).toBeTruthy();
    expect(screen.getByText("2026-05-25T02:00:45.000Z")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter by owner tribe ID"), {
      target: { value: "logistics" },
    });
    fireEvent.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() =>
      expect(apiClient.getQuotaUsage).toHaveBeenLastCalledWith({
        ownerTribeId: "logistics",
        window: "7d",
      }),
    );
  });

  it("surfaces severity-first quota action detail above the usage table", async () => {
    apiClient.getQuotaUsage.mockResolvedValueOnce([
      {
        id: "decision-blocked",
        ownerTribeId: "billing",
        policyId: "quota-billing",
        scope: "shared",
        targetServiceId: "payment",
        routeFamily: "shared:payment",
        windowStart: "2026-05-25T02:00:00.000Z",
        windowEnd: "2026-05-25T03:00:00.000Z",
        requestCount: 240,
        maxRequests: 100,
        mode: "enforce",
        outcome: "blocked",
        correlationId: "corr-blocked",
        createdAt: "2026-05-25T02:59:45.000Z",
      },
      {
        id: "decision-observed",
        ownerTribeId: "campus-one",
        policyId: "quota-campus",
        scope: "shared",
        targetServiceId: "payment",
        routeFamily: "shared:payment",
        windowStart: "2026-05-25T02:00:00.000Z",
        windowEnd: "2026-05-25T03:00:00.000Z",
        requestCount: 120,
        maxRequests: 100,
        mode: "observe",
        outcome: "observed_exceeded",
        correlationId: "corr-observed",
        createdAt: "2026-05-25T02:45:45.000Z",
      },
    ]);

    renderWithClient(<TribeQuotaUsagePanel />);

    const detail = await screen.findByLabelText("Selected quota action detail");

    expect(detail.textContent).toContain("Review enforced quota blocks");
    expect(detail.textContent).toContain("billing");
    expect(detail.textContent).toContain("240 of 100 requests");
    expect(
      within(detail)
        .getByRole("link", { name: "Open quota policy" })
        .getAttribute("href"),
    ).toBe("/tribes/payment?section=quotas");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect quota action Observe-mode exceedance",
      }),
    );

    expect(
      screen.getByLabelText("Selected quota action detail").textContent,
    ).toContain("120 of 100 requests");
  });

  it("keeps the quota action review visible when no decisions need review", async () => {
    apiClient.getQuotaUsage.mockResolvedValueOnce([]);

    renderWithClient(<TribeQuotaUsagePanel />);

    expect(await screen.findByText("Quota action review")).toBeTruthy();
    expect(
      screen.getByText("No quota decisions need review in this window."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Selected quota action detail")).toBeNull();
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
