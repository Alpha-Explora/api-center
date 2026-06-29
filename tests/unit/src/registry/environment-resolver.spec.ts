import { normalizeServiceEnvironments } from "../../../../src/registry/environment-resolver";
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

describe("normalizeServiceEnvironments", () => {
  it("creates the legacy test environment fallback from baseUrl and healthCheck", () => {
    const environments = normalizeServiceEnvironments(manifest(), {
      status: "active",
    });

    expect(environments).toEqual([
      {
        environment: "test",
        baseUrl: "https://orders.test",
        healthCheck: "/health",
        status: "active",
        healthy: undefined,
        lastHealthCheckAt: undefined,
      },
    ]);
  });

  it("preserves runtime health when normalizing persisted registry entries", () => {
    const entry: ServiceRegistryEntry = {
      ...manifest(),
      environments: [],
      registeredAt: "2026-06-19T00:00:00.000Z",
      updatedAt: "2026-06-19T00:00:00.000Z",
      status: "deprecated",
      healthy: false,
      lastHealthCheckAt: "2026-06-19T00:01:00.000Z",
    };

    expect(
      normalizeServiceEnvironments(entry, { status: entry.status }),
    ).toEqual([
      {
        environment: "test",
        baseUrl: "https://orders.test",
        healthCheck: "/health",
        status: "deprecated",
        healthy: false,
        lastHealthCheckAt: "2026-06-19T00:01:00.000Z",
      },
    ]);
  });

  it("normalizes explicit environments with inherited health checks and default status", () => {
    const environments = normalizeServiceEnvironments(
      manifest({
        environments: [
          {
            environment: "test",
            baseUrl: "https://orders.test",
          },
          {
            environment: "live",
            baseUrl: "https://orders.live",
            healthCheck: "/ready",
            status: "deprecated",
            healthy: true,
            lastHealthCheckAt: "2026-06-19T00:02:00.000Z",
          },
        ],
      }),
      { status: "active" },
    );

    expect(environments).toEqual([
      {
        environment: "test",
        baseUrl: "https://orders.test",
        healthCheck: "/health",
        status: "active",
        healthy: undefined,
        lastHealthCheckAt: undefined,
      },
      {
        environment: "live",
        baseUrl: "https://orders.live",
        healthCheck: "/ready",
        status: "deprecated",
        healthy: true,
        lastHealthCheckAt: "2026-06-19T00:02:00.000Z",
      },
    ]);
  });
});
