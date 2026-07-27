import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccessReviewPanel } from "../../../../src/components/access-review-panel";
import type { ServiceRegistryEntry, SharedServiceRuntimeUsage } from "@/lib/schemas";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const services: ServiceRegistryEntry[] = [
  {
    serviceId: "flow-ci",
    name: "Flow CI",
    version: "1.0.0",
    baseUrl: "https://flow-ci.example.com",
    healthCheck: "/health",
    serviceType: "tribe",
    ownerTeam: "Flow",
    contact: "ops@example.com",
    tags: [],
    serviceTier: "standard",
    consumes: ["payment"],
    exposes: ["/health"],
    requiredScopes: ["shared:payment:invoke"],
    status: "active",
    registeredAt: "2026-05-17T00:00:00.000Z",
    updatedAt: "2026-05-17T01:00:00.000Z",
  },
];

const runtimeUsage: SharedServiceRuntimeUsage[] = [
  {
    tribeServiceId: "flow-ci",
    sharedServiceId: "payment",
    window: "24h",
    totalRequests: 10,
    successRequests: 9,
    failedRequests: 1,
    errorRate: 0.1,
    avgLatencyMs: 100,
    lastUsedAt: "2026-05-18T00:00:00.000Z",
  },
];

describe("AccessReviewPanel", () => {
  it("renders access review evidence and copy control", () => {
    render(
      <AccessReviewPanel
        services={services}
        runtimeUsage={runtimeUsage}
        window="24h"
      />,
    );

    expect(screen.getByText("Access review evidence")).toBeTruthy();
    expect(screen.getByText("Flow CI")).toBeTruthy();
    expect(screen.getByText("payment")).toBeTruthy();
    expect(screen.getByText("shared:payment:invoke")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy evidence" })).toBeTruthy();
  });
});
