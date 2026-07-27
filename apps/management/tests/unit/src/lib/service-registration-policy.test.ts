import { describe, expect, it } from "vitest";
import { buildServiceRegistrationPlan } from "@/lib/service-registration-policy";
import type { ServiceManifest, ServiceRegistryEntry } from "@/lib/schemas";

function manifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
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
    ...overrides,
  };
}

function registry(
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  const { environments: _manifestEnvironments, ...baseManifest } = manifest();

  return {
    ...baseManifest,
    registeredAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

describe("buildServiceRegistrationPlan", () => {
  it("maps microservices to owner tribe topics and service attribution", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [registry({ serviceId: "logistics" })],
      manifests: [
        manifest({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
          baseUrl: "https://orders.example.test",
          requiredScopes: ["orders:read"],
          exposes: ["/orders", "/health"],
          consumes: [],
        }),
      ],
    });

    expect(plan.canApply).toBe(true);
    expect(plan.items[0]).toMatchObject({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      sourceServiceId: "logistics-orders",
      eventTopic: "tribe.logistics.events",
      action: "create",
    });
  });

  it("blocks production registration when owner tribe is missing", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [
        manifest({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
        }),
      ],
    });

    expect(plan.canApply).toBe(false);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        code: "owner-tribe-missing",
        severity: "blocking",
        serviceId: "logistics-orders",
      }),
    );
  });

  it("blocks duplicate service IDs in one batch", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [manifest(), manifest()],
    });

    expect(plan.canApply).toBe(false);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: "duplicate-service-id" }),
    );
  });

  it("warns for unknown consumes in local mode and blocks them in production mode", () => {
    const localPlan = buildServiceRegistrationPlan({
      mode: "local-direct",
      existingServices: [],
      manifests: [manifest({ consumes: ["payment"] })],
    });
    const productionPlan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [manifest({ consumes: ["payment"] })],
    });

    expect(localPlan.canApply).toBe(true);
    expect(localPlan.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-consumed-service",
        severity: "warning",
      }),
    );
    expect(productionPlan.canApply).toBe(false);
    expect(productionPlan.issues).toContainEqual(
      expect.objectContaining({
        code: "unknown-consumed-service",
        severity: "blocking",
      }),
    );
  });

  it("accepts kafka consumes as a platform capability in production mode", () => {
    const plan = buildServiceRegistrationPlan({
      mode: "production-request",
      existingServices: [],
      manifests: [manifest({ consumes: ["kafka"] })],
    });

    expect(plan.canApply).toBe(true);
    expect(plan.issues).not.toContainEqual(
      expect.objectContaining({ code: "unknown-consumed-service" }),
    );
  });
});
