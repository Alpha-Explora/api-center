import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DependencyMapClient } from "@/components/dependency-map-client";
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

const orders = service({
  serviceId: "orders",
  name: "Orders API",
  consumes: ["payments", "missing-ledger"],
});

const payments = service({
  serviceId: "payments",
  name: "Payments API",
  serviceType: "shared",
});

describe("DependencyMapClient", () => {
  beforeEach(() => {
    apiClient.listServices.mockResolvedValue([orders, payments]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses one severity-first dependency detail surface", async () => {
    renderWithClient(<DependencyMapClient />);

    expect(
      await screen.findByLabelText("Selected dependency detail"),
    ).toBeTruthy();
    expect(screen.getByText("Selected dependency")).toBeTruthy();
    expect(screen.getAllByText("missing-ledger").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("missing-ledger is not registered in APICenter.")
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("link", { name: /update the source service manifest/i })
        .getAttribute("href"),
    ).toBe("/tribes/orders/edit");
    expect(
      screen
        .getAllByRole("link", { name: "orders" })
        .every(
          (link) =>
            link.getAttribute("href") ===
            "/tribes/orders?section=dependencies",
        ),
    ).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Inspect dependency orders to payments",
        pressed: false,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect dependency orders to payments",
      }),
    );

    expect(
      screen.getAllByText("payments is registered as a shared service.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "payments" }).getAttribute("href"),
    ).toBe("/tribes/payments?section=dependencies");
    expect(
      screen
        .getByRole("link", { name: /open the target service record/i })
        .getAttribute("href"),
    ).toBe("/tribes/payments?section=dependencies");
    expect(
      screen.getByRole("button", {
        name: "Inspect dependency orders to payments",
        pressed: true,
      }),
    ).toBeTruthy();
  });

  it("keeps the empty dependency state", async () => {
    apiClient.listServices.mockResolvedValue([
      service({ serviceId: "catalog", name: "Catalog API", consumes: [] }),
    ]);

    renderWithClient(<DependencyMapClient />);

    expect(await screen.findByText("No dependencies declared")).toBeTruthy();
    expect(
      screen.getByText("Add consumed service IDs to manifests to populate this map."),
    ).toBeTruthy();
  });
});

function service(
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId: "service",
    name: "Service API",
    baseUrl: "https://service.example.test",
    requiredScopes: ["service:read"],
    exposes: ["/service"],
    consumes: [],
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Platform",
    contact: "platform@example.test",
    serviceTier: "standard",
    registeredAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

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
