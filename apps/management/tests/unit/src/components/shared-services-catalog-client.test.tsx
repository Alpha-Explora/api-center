import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedServicesCatalogClient } from "@/components/shared-services-catalog-client";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  listServices: vi.fn(),
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

describe("SharedServicesCatalogClient", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("opens registered shared services in the service summary context", async () => {
    apiClient.listServices.mockResolvedValue([
      service({ serviceId: "payment", name: "Payment Service" }),
    ]);

    renderWithClient(<SharedServicesCatalogClient />);

    expect(await screen.findByText("active")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open detail" })
        .getAttribute("href"),
    ).toBe("/tribes/payment?section=summary");
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

function service(
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId: "payment",
    name: "Payment Service",
    baseUrl: "https://payment.example.test",
    requiredScopes: ["payment:read"],
    exposes: ["/payment"],
    consumes: [],
    serviceType: "shared",
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Payments",
    contact: "payments@example.test",
    serviceTier: "critical",
    costCenter: "PAY",
    registeredAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}
