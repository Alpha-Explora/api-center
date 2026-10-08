import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribeQuotaPolicyPanel } from "@/components/tribe-quota-policy-panel";

const apiClient = vi.hoisted(() => ({
  disableQuotaPolicy: vi.fn(),
  listQuotaPolicies: vi.fn(),
  saveQuotaPolicy: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("TribeQuotaPolicyPanel", () => {
  beforeEach(() => {
    apiClient.listQuotaPolicies.mockResolvedValue([
      {
        id: "quota-c1",
        ownerTribeId: "campus-one",
        scope: "shared",
        targetServiceId: "payment",
        windowSeconds: 60,
        maxRequests: 100,
        burstRequests: 150,
        mode: "observe",
        status: "active",
        reason: "Initial shared-service observation",
        updatedAt: "2026-05-25T02:00:00.000Z",
      },
    ]);
    apiClient.saveQuotaPolicy.mockResolvedValue({
      id: "quota-c2",
      ownerTribeId: "logistics",
      scope: "kafka_publish",
      targetServiceId: null,
      windowSeconds: 300,
      maxRequests: 500,
      burstRequests: null,
      mode: "observe",
      status: "active",
      reason: "Observe publish load before enforcement",
      updatedAt: "2026-05-25T03:00:00.000Z",
    });
    apiClient.disableQuotaPolicy.mockResolvedValue({
      id: "quota-c1",
      ownerTribeId: "campus-one",
      scope: "shared",
      targetServiceId: "payment",
      windowSeconds: 60,
      maxRequests: 100,
      burstRequests: 150,
      mode: "observe",
      status: "disabled",
      reason: "Initial shared-service observation",
      updatedAt: "2026-05-25T02:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("submits a quota policy in observe mode by default", async () => {
    renderWithClient(<TribeQuotaPolicyPanel />);

    expect(await screen.findByText("campus-one")).toBeTruthy();
    expect(screen.queryByText("Operator reason")).toBeNull();
    fireEvent.change(screen.getByLabelText("Owner tribe ID"), {
      target: { value: "logistics" },
    });
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "kafka_publish" },
    });
    fireEvent.change(screen.getByLabelText("Window seconds"), {
      target: { value: "300" },
    });
    fireEvent.change(screen.getByLabelText("Max requests"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Change reason"), {
      target: { value: "Observe publish load before enforcement" },
    });
    const saveButton = screen.getByRole("button", {
      name: /save quota policy/i,
    }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/reviewed this quota change/i));
    await waitFor(() => expect(saveButton.disabled).toBe(false));
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(apiClient.saveQuotaPolicy).toHaveBeenCalledWith({
        ownerTribeId: "logistics",
        // No project selected: this is a tribe-wide ceiling.
        projectId: "",
        scope: "kafka_publish",
        targetServiceId: "",
        windowSeconds: 300,
        maxRequests: 500,
        burstRequests: null,
        mode: "observe",
        reason: "Observe publish load before enforcement",
      }),
    );
  });

  it("disables an active quota policy", async () => {
    renderWithClient(<TribeQuotaPolicyPanel ownerTribeId="campus-one" />);

    expect(await screen.findByText("payment")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /disable quota-c1/i }));

    await waitFor(() =>
      expect(apiClient.disableQuotaPolicy).toHaveBeenCalledWith("quota-c1"),
    );
  });

  it("associates the quota review checkbox with an explicit label", async () => {
    const { container } = renderWithClient(<TribeQuotaPolicyPanel />);

    await screen.findByText("campus-one");
    const checkbox = screen.getByLabelText(
      /reviewed this quota change/i,
    ) as HTMLInputElement;

    expect(checkbox.id).toBe("quota-change-reviewed");
    expect(
      container.querySelector('label[for="quota-change-reviewed"]'),
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
