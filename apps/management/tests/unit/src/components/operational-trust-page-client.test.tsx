import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperationalTrustPageClient } from "@/components/operational-trust-page-client";

const apiClient = vi.hoisted(() => ({
  applyEmergencyControl: vi.fn(),
  getOperationalTrustData: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("OperationalTrustPageClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a recoverable in-app error when trust data cannot load", async () => {
    apiClient.getOperationalTrustData.mockRejectedValue(
      new Error("fetch failed"),
    );

    renderWithClient(<OperationalTrustPageClient />);

    expect(await screen.findByText("Operational trust unavailable")).toBeTruthy();
    expect(screen.getByText("Check analytics endpoints")).toBeTruthy();
    expect(screen.getByText("Open readiness checks")).toBeTruthy();
    expect(screen.getByText("Emergency controls")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Before applying" })).toBeTruthy();
    expect(screen.queryByText("This page couldn’t load")).toBeNull();
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
