import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedServiceUsageMatrix } from "@/components/shared-service-usage-matrix";
import type {
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
} from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  getSharedServiceRuntimeUsage: vi.fn(),
  listServices: vi.fn(),
}));

vi.mock("@/lib/api-center-client", () => apiClient);

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    [key: string]: unknown;
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/access-review-panel", () => ({
  AccessReviewPanel: () => <section>Access review</section>,
}));

describe("SharedServiceUsageMatrix", () => {
  beforeEach(() => {
    apiClient.getSharedServiceRuntimeUsage.mockResolvedValue([]);
    apiClient.listServices.mockResolvedValue(makeServices(10));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("paginates tribe rows in the usage matrix", async () => {
    renderWithClient(<SharedServiceUsageMatrix />);

    const matrix = await screen.findByRole("table", {
      name: "Declared shared-service usage matrix",
    });
    expect(within(matrix).getByText("Tribe 01")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open quotas for tribe-01" })
        .getAttribute("href"),
    ).toBe("/tribes/tribe-01?section=quotas");
    expect(within(matrix).getByText("Tribe 08")).toBeTruthy();
    expect(within(matrix).queryByText("Tribe 09")).toBeNull();
    expect(screen.getByText("Showing 1-8 of 10 tribes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(within(matrix).getByText("Tribe 09")).toBeTruthy();
    });
    expect(within(matrix).queryByText("Tribe 01")).toBeNull();
    expect(screen.getByText("Showing 9-10 of 10 tribes")).toBeTruthy();
  });

  it("uses one severity-first shared-service usage detail surface", async () => {
    apiClient.listServices.mockResolvedValue([
      makeService("gauth", "shared"),
      makeService("payment", "shared"),
      makeService("orders", "tribe", {
        name: "Orders API",
        consumes: ["gauth"],
      }),
      makeService("support", "tribe", {
        name: "Support API",
        consumes: ["payment"],
      }),
    ]);
    apiClient.getSharedServiceRuntimeUsage.mockResolvedValue([
      runtimeUsage({
        tribeServiceId: "orders",
        sharedServiceId: "payment",
        totalRequests: 20,
        failedRequests: 4,
        errorRate: 0.2,
        avgLatencyMs: 430,
      }),
      runtimeUsage({
        tribeServiceId: "support",
        sharedServiceId: "payment",
        totalRequests: 100,
        failedRequests: 8,
        errorRate: 0.08,
        avgLatencyMs: 280,
      }),
      runtimeUsage({
        tribeServiceId: "orders",
        sharedServiceId: "gauth",
        totalRequests: 40,
        failedRequests: 0,
        errorRate: 0,
        avgLatencyMs: 80,
      }),
    ]);

    renderWithClient(<SharedServiceUsageMatrix />);

    expect(
      await screen.findByLabelText("Selected shared-service usage detail"),
    ).toBeTruthy();
    expect(screen.getByText("Selected usage signal")).toBeTruthy();
    expect(screen.getAllByText("orders to payment").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Runtime calls exist, but this shared service is not declared in the tribe manifest.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("link", { name: /update the tribe manifest/i })
        .getAttribute("href"),
    ).toBe("/tribes/orders/edit");
    expect(
      screen
        .getAllByRole("link", { name: "Orders API" })
        .every(
          (link) =>
            link.getAttribute("href") ===
            "/tribes/orders?section=dependencies",
        ),
    ).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Inspect shared-service usage support to payment",
        pressed: false,
      }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect shared-service usage support to payment",
      }),
    );

    expect(
      screen.getAllByText("8.0% error rate across 100 runtime calls.").length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("link", { name: "Support API" })
        .every(
          (link) =>
            link.getAttribute("href") ===
            "/tribes/support?section=dependencies",
        ),
    ).toBe(true);
    expect(
      screen
        .getAllByRole("link", { name: "payment" })
        .some(
          (link) =>
            link.getAttribute("href") ===
            "/tribes/payment?section=dependencies",
        ),
    ).toBe(true);
    expect(
      screen
        .getByRole("link", { name: /review quotas for this tribe/i })
        .getAttribute("href"),
    ).toBe("/tribes/support?section=quotas");
    expect(
      screen.getByRole("button", {
        name: "Inspect shared-service usage support to payment",
        pressed: true,
      }),
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

function makeServices(tribeCount: number): ServiceRegistryEntry[] {
  const sharedServices = ["gauth", "geo", "payment", "email", "sms", "otp"].map(
    (serviceId) => makeService(serviceId, "shared"),
  );
  const tribes = Array.from({ length: tribeCount }, (_, index) =>
    makeService(`tribe-${String(index + 1).padStart(2, "0")}`, "tribe", {
      name: `Tribe ${String(index + 1).padStart(2, "0")}`,
      consumes: index % 2 === 0 ? ["gauth", "payment"] : ["email"],
    }),
  );

  return [...sharedServices, ...tribes];
}

function makeService(
  serviceId: string,
  serviceType: "tribe" | "shared",
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId,
    name: serviceId,
    baseUrl: `https://${serviceId}.example.test`,
    requiredScopes: [`${serviceId}:read`],
    exposes: ["/health"],
    consumes: [],
    serviceType,
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Platform",
    contact: "platform@example.test",
    serviceTier: "standard",
    costCenter: "ENG",
    registeredAt: "2026-05-21T00:00:00.000Z",
    updatedAt: "2026-05-21T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

function runtimeUsage(
  overrides: Partial<SharedServiceRuntimeUsage>,
): SharedServiceRuntimeUsage {
  return {
    tribeServiceId: "orders",
    sharedServiceId: "gauth",
    window: "24h",
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    errorRate: 0,
    avgLatencyMs: 0,
    ...overrides,
  };
}
