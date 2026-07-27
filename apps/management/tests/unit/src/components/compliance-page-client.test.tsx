import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompliancePageClient } from "@/components/compliance-page-client";

const apiClient = vi.hoisted(() => ({
  getConsumerScorecards: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("CompliancePageClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps the compliance tools visible when scorecards cannot load", async () => {
    apiClient.getConsumerScorecards.mockRejectedValue(new Error("fetch failed"));

    renderWithClient(<CompliancePageClient />);

    expect(await screen.findByText("Scorecards unavailable")).toBeTruthy();
    expect(screen.getByText("Compliance export")).toBeTruthy();
    expect(screen.getByText("Continue with compliance export")).toBeTruthy();
    expect(screen.getByText("Check scorecard endpoint health")).toBeTruthy();
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
