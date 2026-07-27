import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TribeDeprovisioningCard } from "@/components/tribe-deprovisioning-card";

vi.mock("@/lib/api-center-client", () => ({
  deleteTribeSecret: vi.fn(),
  deregisterService: vi.fn(),
  getTribeSecretStatus: vi.fn().mockResolvedValue({
    exists: true,
    state: "ENABLED",
  }),
  previewConfluentS3SinkRemoveTopic: vi.fn(),
  previewTribeSecretDelete: vi.fn(),
  removeConfluentTopicFromS3Sink: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("TribeDeprovisioningCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows cleanup resources for each service environment", async () => {
    renderWithClient(
      <TribeDeprovisioningCard
        serviceId="trinithrive"
        ownerTribeId="trinithrive"
        environments={[
          {
            environment: "test",
            baseUrl: "https://trinithrive-test.example.com",
            status: "active",
          },
          {
            environment: "live",
            baseUrl: "https://trinithrive-live.example.com",
            status: "active",
          },
        ]}
        onDeregistered={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("test.tribe.trinithrive.events"),
    ).toBeTruthy();
    expect(screen.getByText("live.tribe.trinithrive.events")).toBeTruthy();
    expect(
      screen.getByText("api-center-tribe-secret-trinithrive-test"),
    ).toBeTruthy();
    expect(
      screen.getByText("api-center-tribe-secret-trinithrive-live"),
    ).toBeTruthy();
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
