import { describe, expect, it } from "vitest";
import { buildOwnerTribeMigrationPlan } from "@/lib/owner-tribe-migration";
import type { ServiceRegistryEntry } from "@/lib/schemas";

function registry(
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId: "logistics",
    name: "Logistics",
    baseUrl: "https://logistics.example.test",
    requiredScopes: ["logistics:read"],
    exposes: ["/health"],
    consumes: [],
    serviceType: "tribe",
    version: "1.0.0",
    tags: [],
    serviceTier: "standard",
    registeredAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("buildOwnerTribeMigrationPlan", () => {
  it("adds ownerTribeId to legacy microservices when a root tribe exists", () => {
    const plan = buildOwnerTribeMigrationPlan({
      services: [
        registry(),
        registry({
          serviceId: "logistics-orders",
          name: "Logistics Orders",
          requiredScopes: ["orders:read"],
          exposes: ["/orders", "/health"],
        }),
      ],
    });

    expect(plan.canApply).toBe(true);
    expect(plan.updateManifests).toHaveLength(2);
    expect(plan.items).toContainEqual(
      expect.objectContaining({
        serviceId: "logistics-orders",
        action: "set-owner",
        nextOwnerTribeId: "logistics",
        eventTopic: "tribe.logistics.events",
      }),
    );
    expect(plan.updateManifests).toContainEqual(
      expect.objectContaining({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
      }),
    );
  });

  it("uses explicit owner overrides for services that cannot be inferred", () => {
    const plan = buildOwnerTribeMigrationPlan({
      services: [
        registry({ serviceId: "billing" }),
        registry({ serviceId: "checkout-api", name: "Checkout API" }),
      ],
      ownerOverrides: {
        "checkout-api": "billing",
      },
    });

    expect(plan.canApply).toBe(true);
    expect(plan.items).toContainEqual(
      expect.objectContaining({
        serviceId: "checkout-api",
        action: "set-owner",
        nextOwnerTribeId: "billing",
      }),
    );
  });

  it("requires manual review when a hyphenated service has no owner signal", () => {
    const plan = buildOwnerTribeMigrationPlan({
      services: [registry({ serviceId: "checkout-api", name: "Checkout API" })],
    });

    expect(plan.canApply).toBe(false);
    expect(plan.items).toContainEqual(
      expect.objectContaining({
        serviceId: "checkout-api",
        action: "manual-review",
      }),
    );
  });
});
