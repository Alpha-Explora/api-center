import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLogClient } from "../../../../src/components/audit-log-client";

const apiClient = vi.hoisted(() => ({
  getAuditEvents: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("AuditLogClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("filters by action family and actor and exposes a CSV link", async () => {
    apiClient.getAuditEvents.mockResolvedValue([
      {
        id: "event-1",
        timestamp: "2026-05-25T00:00:00.000Z",
        type: "quota.policy.updated",
        actionFamily: "quota",
        actor: "platform@example.test",
        severity: "info",
        message: "Quota policy updated",
      },
    ]);

    renderWithClient(<AuditLogClient />);
    await screen.findByText("quota.policy.updated");

    fireEvent.change(screen.getByLabelText("Filter by action family"), {
      target: { value: "quota" },
    });
    fireEvent.change(screen.getByPlaceholderText("Filter by actor"), {
      target: { value: "platform@example.test" },
    });

    await waitFor(() =>
      expect(apiClient.getAuditEvents).toHaveBeenLastCalledWith(
        expect.objectContaining({
          actionFamily: "quota",
          actor: "platform@example.test",
        }),
      ),
    );
    expect(
      screen.getByRole("link", { name: "Export CSV" }).getAttribute("href"),
    ).toBe(
      "/api/local/audit/events?format=csv&actionFamily=quota&actor=platform%40example.test",
    );
  });

  it("labels every audit filter control", async () => {
    apiClient.getAuditEvents.mockResolvedValue([]);

    renderWithClient(<AuditLogClient />);

    expect(await screen.findByLabelText("Filter by service ID")).toBeTruthy();
    expect(screen.getByLabelText("Filter by event type")).toBeTruthy();
    expect(screen.getByLabelText("Filter by action family")).toBeTruthy();
    expect(screen.getByLabelText("Filter by actor")).toBeTruthy();
  });

  it("uses route-provided service and action family filters", async () => {
    apiClient.getAuditEvents.mockResolvedValue([]);

    renderWithClient(
      <AuditLogClient
        defaultServiceId="logistics-orders"
        defaultActionFamily="approval"
      />,
    );

    await waitFor(() =>
      expect(apiClient.getAuditEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: "logistics-orders",
          actionFamily: "approval",
        }),
      ),
    );
    expect(
      screen.getByRole("link", { name: "Export CSV" }).getAttribute("href"),
    ).toBe(
      "/api/local/audit/events?format=csv&serviceId=logistics-orders&actionFamily=approval",
    );
  });

  it("routes audit event service links to service evidence", async () => {
    apiClient.getAuditEvents.mockResolvedValue([
      {
        id: "event-1",
        timestamp: "2026-05-25T00:00:00.000Z",
        type: "registry.updated",
        actionFamily: "registry",
        severity: "info",
        serviceId: "logistics-orders",
        message: "Registry updated",
      },
    ]);

    renderWithClient(<AuditLogClient />);

    expect(
      (await screen.findByRole("link", { name: "logistics-orders" }))
        .getAttribute("href"),
    ).toBe("/tribes/logistics-orders?section=evidence");
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
