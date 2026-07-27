import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertsClient } from "@/components/alerts-client";
import type { OperationalAlert } from "@/lib/schemas";
import { renderWithQueryClient } from "@tests/support/render-with-query-client";

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

describe("AlertsClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("routes service alerts into service health and evidence context", async () => {
    apiClient.getOperationalAlerts.mockResolvedValue([
      alert({
        serviceId: "payment",
        type: "error-rate",
      }),
    ]);

    renderWithQueryClient(<AlertsClient />);

    expect(await screen.findByText("payment")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "payment" }).getAttribute("href"),
    ).toBe("/tribes/payment?section=health");
    expect(
      screen.getByRole("link", { name: "Service" }).getAttribute("href"),
    ).toBe("/tribes/payment?section=health");
    expect(
      screen.getByRole("link", { name: "Audit" }).getAttribute("href"),
    ).toBe("/tribes/payment?section=evidence");
    expect(
      screen.getByRole("link", { name: "Usage" }).getAttribute("href"),
    ).toBe("/tribes/payment?section=dependencies");
    expect(
      screen
        .getByRole("link", { name: "Payment usage" })
        .getAttribute("href"),
    ).toBe("/tribes/payment?section=dependencies");
  });

  it("shows a recovery path when no alerts are firing", async () => {
    apiClient.getOperationalAlerts.mockResolvedValue([]);

    renderWithQueryClient(<AlertsClient />);

    expect(await screen.findByText("No active alerts")).toBeTruthy();
    expect(screen.getByText("Recovery path")).toBeTruthy();
    expect(screen.getByText("Verify analytics ingestion")).toBeTruthy();
    expect(screen.getByText("Open runtime evidence")).toBeTruthy();
    expect(screen.getByText("Refresh the selected window")).toBeTruthy();
  });
});

function alert(overrides: Partial<OperationalAlert> = {}): OperationalAlert {
  return {
    id: "alert-1",
    severity: "error",
    type: "error-rate",
    serviceId: "payment",
    message: "Payment error rate is above threshold.",
    recommendation: "Review runtime health and recent evidence.",
    ...overrides,
  };
}
