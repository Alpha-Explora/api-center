import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribePlanTierPanel } from "@/components/tribe-plan-tier-panel";

const apiClient = vi.hoisted(() => ({
  assignTribePlan: vi.fn(),
  listTribePlanAssignments: vi.fn(),
  listTribePlanDefinitions: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("TribePlanTierPanel", () => {
  beforeEach(() => {
    apiClient.listTribePlanDefinitions.mockResolvedValue([
      {
        planKey: "starter",
        displayName: "Starter",
        gatewayCallsPerDay: 1000,
        kafkaPublishesPerDay: 100,
        retentionTier: "standard",
        sharedServiceAccess: "test-only-provider-impacting-smoke",
        supportTier: "standard",
      },
      {
        planKey: "standard",
        displayName: "Standard",
        gatewayCallsPerDay: 25000,
        kafkaPublishesPerDay: 5000,
        retentionTier: "standard",
        sharedServiceAccess: "live-after-approval",
        supportTier: "standard",
      },
    ]);
    apiClient.listTribePlanAssignments.mockResolvedValue([
      {
        id: "assignment-1",
        ownerTribeId: "campus-one",
        planKey: "standard",
        environment: "prod",
        status: "active",
        effectiveAt: "2026-05-25T00:00:00.000Z",
        reason: "Production rollout",
      },
    ]);
    apiClient.assignTribePlan.mockResolvedValue({
      assignment: {
        id: "assignment-2",
        ownerTribeId: "logistics",
        planKey: "starter",
        environment: "test",
        status: "active",
        effectiveAt: "2026-05-25T01:00:00.000Z",
        reason: "Initial test rollout",
      },
      quotaProposals: [
        {
          ownerTribeId: "logistics",
          scope: "all",
          targetServiceId: null,
          windowSeconds: 86400,
          maxRequests: 1000,
          mode: "observe",
          reason: "Plan starter default gateway quota for test",
        },
        {
          ownerTribeId: "logistics",
          scope: "kafka_publish",
          targetServiceId: null,
          windowSeconds: 86400,
          maxRequests: 100,
          mode: "observe",
          reason: "Plan starter default Kafka publish quota for test",
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders plan defaults and assigned tribes", async () => {
    renderWithClient(<TribePlanTierPanel />);

    expect(await screen.findByText("Starter")).toBeTruthy();
    expect(screen.getByText(/1,000 gateway calls\/day/)).toBeTruthy();
    expect(screen.getByText("live after approval")).toBeTruthy();
    expect(screen.getByText("campus-one")).toBeTruthy();
    expect(screen.getByText("standard / live")).toBeTruthy();
  });

  it("assigns a plan and links generated quota proposals", async () => {
    renderWithClient(<TribePlanTierPanel />);

    await screen.findByText("Starter");
    fireEvent.change(screen.getByLabelText("Owner tribe ID"), {
      target: { value: "logistics" },
    });
    fireEvent.change(screen.getByLabelText("Plan"), {
      target: { value: "starter" },
    });
    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "test" },
    });
    fireEvent.change(screen.getByLabelText("Assignment reason"), {
      target: { value: "Initial test rollout" },
    });
    const assignButton = screen.getByRole("button", {
      name: /assign plan/i,
    }) as HTMLButtonElement;
    expect(assignButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/reviewed this plan assignment/i));
    await waitFor(() => expect(assignButton.disabled).toBe(false));
    fireEvent.click(assignButton);

    await waitFor(() =>
      expect(apiClient.assignTribePlan).toHaveBeenCalledWith({
        ownerTribeId: "logistics",
        planKey: "starter",
        environment: "test",
        reason: "Initial test rollout",
      }),
    );
    const links = await screen.findAllByRole("link", {
      name: /open quota proposal/i,
    });
    expect(links[0].getAttribute("href")).toContain(
      "/quotas?ownerTribeId=logistics",
    );
    expect(links[0].getAttribute("href")).toContain("maxRequests=1000");
  });

  it("associates the plan assignment review checkbox with an explicit label", async () => {
    const { container } = renderWithClient(<TribePlanTierPanel />);

    await screen.findByText("Starter");
    const checkbox = screen.getByLabelText(
      /reviewed this plan assignment/i,
    ) as HTMLInputElement;

    expect(checkbox.id).toBe("plan-assignment-reviewed");
    expect(
      container.querySelector('label[for="plan-assignment-reviewed"]'),
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
