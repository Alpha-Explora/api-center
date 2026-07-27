import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarketplacePageClient } from "@/components/marketplace-page-client";

const apiClient = vi.hoisted(() => ({
  listMarketplaceProducts: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("MarketplacePageClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a recoverable in-app error when marketplace data cannot load", async () => {
    apiClient.listMarketplaceProducts.mockRejectedValue(new Error("fetch failed"));

    renderWithClient(<MarketplacePageClient />);

    expect(await screen.findByText("Marketplace unavailable")).toBeTruthy();
    expect(screen.getByText("Check management API base URL")).toBeTruthy();
    expect(screen.getByText("Reload the marketplace")).toBeTruthy();
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
