import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProductCatalog } from "@/components/api-product-catalog";

const apiClient = vi.hoisted(() => ({
  listServices: vi.fn(),
  listServiceSpecCatalog: vi.fn(),
  listServiceSpecVersions: vi.fn(),
  getServiceSpecDocument: vi.fn(),
  downloadServiceSpecDocument: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

describe("ApiProductCatalog", () => {
  beforeEach(() => {
    apiClient.listServiceSpecCatalog.mockResolvedValue([
      {
        id: "service-record-1",
        serviceId: "payment-service",
        name: "Payment Service",
        organizationId: "org-1",
        organizationName: "Platform",
        organizationSlug: "platform",
        projectId: "project-1",
        projectName: "Checkout",
        status: "active",
      },
    ]);
    apiClient.listServiceSpecVersions.mockResolvedValue([
      {
        version: "1.0.0",
        format: "openapi",
        sha256: "spec-sha256",
      },
    ]);
    apiClient.getServiceSpecDocument.mockResolvedValue({
      openapi: "3.1.0",
      info: { title: "Payment Service", version: "1.0.0" },
    });
    apiClient.downloadServiceSpecDocument.mockResolvedValue(undefined);
    apiClient.listServices.mockResolvedValue([
      {
        serviceId: "payment-service",
        name: "Payment Service",
        apiProductName: "Payments API",
        apiProductDescription: "Checkout and subscription operations.",
        baseUrl: "https://payment.internal",
        serviceType: "shared",
        ownerTeam: "Platform Payments",
        ownerTribeId: "platform",
        requiredScopes: ["payments:write"],
        exposes: ["/checkout"],
        consumes: [],
        status: "active",
        quotaHints: {
          recommendedWindowSeconds: 60,
          recommendedMaxRequests: 120,
          providerCostSensitive: true,
        },
        slaTier: "gold",
        supportChannel: "#payments-support",
        documentationUrl: "https://docs.example.com/payments",
        registeredAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
      {
        serviceId: "orders",
        name: "Orders",
        baseUrl: "https://orders.internal",
        serviceType: "tribe",
        ownerTribeId: "logistics",
        requiredScopes: ["orders:read"],
        exposes: ["/orders"],
        consumes: ["payment-service"],
        status: "deprecated",
        serviceTier: "critical",
        registeredAt: "2026-05-25T00:00:00.000Z",
        updatedAt: "2026-05-25T00:00:00.000Z",
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders platform products with ownership, quota, SLA, and docs", async () => {
    renderWithClient(<ApiProductCatalog />);

    expect(await screen.findByText("Payments API")).toBeTruthy();
    expect(screen.getByText("Platform Payments")).toBeTruthy();
    expect(screen.getByText("shared")).toBeTruthy();
    expect(screen.getAllByText("active")).toHaveLength(2);
    expect(screen.getByText("payments:write")).toBeTruthy();
    expect(screen.getByText("Plan required")).toBeTruthy();
    expect(screen.getByText("120 / 60s")).toBeTruthy();
    expect(screen.getByText("gold")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open docs for payment-service/i }),
    ).toBeTruthy();
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("logistics")).toBeTruthy();
    expect(screen.getByText("critical")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /open payments api service detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/payment-service?section=summary");
  });

  it("loads the service-spec catalog, versions, and selected document", async () => {
    renderWithClient(<ApiProductCatalog />);

    expect(await screen.findByText("API contracts")).toBeTruthy();
    expect(await screen.findByText("Checkout")).toBeTruthy();
    expect(screen.getByText("platform")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View versions" }));
    expect(await screen.findByText("1.0.0")).toBeTruthy();
    expect(apiClient.listServiceSpecVersions).toHaveBeenCalledWith(
      "service-record-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(await screen.findByText(/"openapi": "3.1.0"/)).toBeTruthy();
    expect(apiClient.getServiceSpecDocument).toHaveBeenCalledWith(
      "service-record-1",
      "1.0.0",
    );
  });
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}
