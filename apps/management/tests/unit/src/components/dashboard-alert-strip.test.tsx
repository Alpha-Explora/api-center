import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardAlertStrip } from "@/components/dashboard-alert-strip";

const apiClient = vi.hoisted(() => ({
  getOperationalAlerts: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("DashboardAlertStrip", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("routes the first service alert into service health context", async () => {
    apiClient.getOperationalAlerts.mockResolvedValue([
      {
        id: "alert-1",
        severity: "error",
        type: "error-rate",
        serviceId: "payment",
        message: "Payment error rate is above threshold.",
        recommendation: "Review runtime health and recent evidence.",
      },
    ]);

    renderWithClient(<DashboardAlertStrip />);

    expect(await screen.findByText("1 active alert")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "open first issue" }).getAttribute("href"),
    ).toBe("/tribes/payment?section=health");
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
