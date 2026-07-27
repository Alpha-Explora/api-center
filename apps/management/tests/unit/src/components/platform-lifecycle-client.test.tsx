import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformLifecycleClient } from "@/components/platform-lifecycle-client";
import type {
  PlatformLifecycle,
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "@/lib/schemas";

const apiClient = vi.hoisted(() => ({
  getPlatformLifecycleEvidence: vi.fn(),
  getQuotaUsage: vi.fn(),
  listQuotaPolicies: vi.fn(),
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

const lifecycle: PlatformLifecycle = {
  generatedAt: "2026-06-14T02:00:00.000Z",
  summary: {
    total: 1,
    blocked: 0,
    attention: 0,
    ready: 1,
  },
  entries: [
    {
      service: {
        serviceId: "student-api",
        name: "Student API",
        baseUrl: "https://students.example.test",
        requiredScopes: ["students:read"],
        exposes: ["/students"],
        consumes: [],
        ownerTribeId: "campus-one",
        serviceType: "tribe",
        healthCheck: "/health",
        version: "1.0.0",
        tags: [],
        ownerTeam: "Campus",
        contact: "campus@example.test",
        serviceTier: "standard",
        registeredAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-14T00:00:00.000Z",
        status: "active",
      },
      ownerTribeId: "campus-one",
      status: "ready",
      stages: [
        {
          id: "pipeline",
          label: "Pipeline",
          status: "complete",
          evidence: "1 prod pipeline-health row is available.",
          source: "pipeline-health",
          action: "Review pipeline evidence.",
          href: "/tribes/student-api?section=pipeline",
        },
      ],
      blockedCount: 0,
      attentionCount: 0,
      nextAction: {
        stageId: "registry",
        label: "Open the service detail record.",
        href: "/tribes/student-api",
      },
    },
  ],
};

const services: ServiceRegistryEntry[] = [
  {
    serviceId: "fallback-api",
    name: "Fallback API",
    baseUrl: "https://fallback.example.test",
    requiredScopes: ["fallback:read"],
    exposes: ["/fallback"],
    consumes: [],
    ownerTribeId: "fallback",
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    tags: [],
    ownerTeam: "Fallback",
    contact: "fallback@example.test",
    serviceTier: "standard",
    registeredAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-14T00:00:00.000Z",
    status: "active",
    healthy: true,
    lastHealthCheckAt: "2026-06-14T00:00:00.000Z",
  },
];
const quotaPolicies: QuotaPolicy[] = [];
const quotaUsage: QuotaUsageDecision[] = [];

describe("PlatformLifecycleClient", () => {
  beforeEach(() => {
    apiClient.getPlatformLifecycleEvidence.mockResolvedValue(lifecycle);
    apiClient.listServices.mockResolvedValue(services);
    apiClient.listQuotaPolicies.mockResolvedValue(quotaPolicies);
    apiClient.getQuotaUsage.mockResolvedValue(quotaUsage);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders source-backed lifecycle evidence without loading derived inputs", async () => {
    renderWithClient(<PlatformLifecycleClient />);

    expect((await screen.findAllByText("Student API")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("1 ready")).toBeTruthy();
    expect(screen.getByTitle(/pipeline-health: 1 prod pipeline-health row/i)).toBeTruthy();
    expect(apiClient.listServices).not.toHaveBeenCalled();
    expect(apiClient.listQuotaPolicies).not.toHaveBeenCalled();
    expect(apiClient.getQuotaUsage).not.toHaveBeenCalled();
  });

  it("falls back to derived lifecycle when source evidence is unavailable", async () => {
    apiClient.getPlatformLifecycleEvidence.mockRejectedValue(
      new Error("Lifecycle endpoint unavailable"),
    );

    renderWithClient(<PlatformLifecycleClient />);

    expect((await screen.findAllByText("Fallback API")).length).toBeGreaterThan(
      0,
    );
    await waitFor(() => expect(apiClient.listServices).toHaveBeenCalled());
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
