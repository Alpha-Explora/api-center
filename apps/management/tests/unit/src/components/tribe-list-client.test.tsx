import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TribeListClient } from "@/components/tribe-list-client";
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

describe("TribeListClient", () => {
  beforeEach(() => {
    apiClient.listServices.mockResolvedValue(makeServices(10));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("paginates the service registry table", async () => {
    renderWithClient(<TribeListClient />);

    expect(await screen.findByText("Tribe 01")).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: "Open" })[0]
        .getAttribute("href"),
    ).toBe("/tribes/tribe-01?section=summary");
    expect(screen.getByText("Tribe 08")).toBeTruthy();
    expect(screen.queryByText("Tribe 09")).toBeNull();
    expect(screen.getByText("Showing 1-8 of 10 services")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(screen.getByText("Tribe 09")).toBeTruthy();
    });
    expect(screen.queryByText("Tribe 01")).toBeNull();
    expect(screen.getByText("Showing 9-10 of 10 services")).toBeTruthy();
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

function makeServices(tribeCount: number): ServiceRegistryEntry[] {
  return Array.from({ length: tribeCount }, (_, index) =>
    makeService(`tribe-${String(index + 1).padStart(2, "0")}`, {
      name: `Tribe ${String(index + 1).padStart(2, "0")}`,
      consumes: index % 2 === 0 ? ["gauth", "payment"] : ["email"],
    }),
  );
}

function makeService(
  serviceId: string,
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId,
    ownerTribeId: serviceId,
    name: serviceId,
    baseUrl: `https://${serviceId}.example.test`,
    requiredScopes: [`${serviceId}:read`],
    exposes: ["/health"],
    consumes: [],
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Platform",
    contact: "platform@example.test",
    serviceTier: "standard",
    costCenter: "ENG",
    registeredAt: "2026-05-22T00:00:00.000Z",
    updatedAt: "2026-05-22T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}
