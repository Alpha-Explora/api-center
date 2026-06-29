import {
  createRegistryEntry,
  normalizeRegistryEntry,
} from "../../../../src/registry/manifest-normalizer";
import type { ServiceManifest, ServiceRegistryEntry } from "../../../../src/types";

function manifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
  return {
    serviceId: "orders",
    name: "Orders",
    baseUrl: "https://orders.test",
    healthCheck: "/health",
    requiredScopes: ["orders:read"],
    exposes: ["/orders"],
    consumes: [],
    ...overrides,
  };
}

describe("createRegistryEntry", () => {
  it("normalizes service type, timestamps, lifecycle status, and environments", () => {
    const entry = createRegistryEntry(manifest(), {
      now: "2026-06-19T00:00:00.000Z",
    });

    expect(entry).toMatchObject({
      serviceId: "orders",
      serviceType: "tribe",
      registeredAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      status: "active",
      environments: [
        {
          environment: "test",
          baseUrl: "https://orders.test",
          healthCheck: "/health",
          status: "active",
        },
      ],
    });
  });

  it("preserves deprecated status and registration time on update", () => {
    const existing: ServiceRegistryEntry = createRegistryEntry(manifest(), {
      now: "2026-06-18T00:00:00.000Z",
    });
    existing.status = "deprecated";

    const entry = createRegistryEntry(manifest({ version: "2.0.0" }), {
      existing,
      now: "2026-06-19T00:00:00.000Z",
      previousVersion: "1.0.0",
    });

    expect(entry.status).toBe("deprecated");
    expect(entry.registeredAt).toBe("2026-06-18T00:00:00.000Z");
    expect(entry.updatedAt).toBe("2026-06-19T00:00:00.000Z");
    expect(entry.previousVersion).toBe("1.0.0");
    expect(entry.environments[0]).toMatchObject({ status: "deprecated" });
  });
});

describe("normalizeRegistryEntry", () => {
  it("normalizes persisted entries that do not yet have environment rows", () => {
    const entry: ServiceRegistryEntry = {
      ...manifest(),
      environments: [],
      registeredAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      status: "active",
      healthy: false,
      lastHealthCheckAt: "2026-06-19T00:10:00.000Z",
    };

    expect(normalizeRegistryEntry(entry).environments).toEqual([
      {
        environment: "test",
        baseUrl: "https://orders.test",
        healthCheck: "/health",
        status: "active",
        healthy: false,
        lastHealthCheckAt: "2026-06-19T00:10:00.000Z",
      },
    ]);
  });
});
