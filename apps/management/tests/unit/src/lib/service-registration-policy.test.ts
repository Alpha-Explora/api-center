import { describe, expect, it } from "vitest";
import { buildServiceRegistrationPlan } from "@/lib/service-registration-policy";
import type {
  ServiceManifest,
  ServiceRegistryEntry,
  TenancyProject,
} from "@/lib/schemas";

function project(
  projectId: string,
  overrides: Partial<TenancyProject> = {},
): TenancyProject {
  return {
    projectId,
    tribeId: "logistics",
    name: projectId,
    status: "active",
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

const projects = [
  project("logistics-core"),
  project("logistics-billing"),
  project("logistics-legacy", { status: "archived" }),
];

function manifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
  return {
    serviceId: "logistics",
    projectId: "logistics-core",
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
    ownerTribeId: "logistics",
    registeredAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    status: "active",
    ...overrides,
  };
}

function plan(
  manifests: ServiceManifest[],
  existingServices: ServiceRegistryEntry[] = [],
  mode: "local-direct" | "production-request" = "production-request",
) {
  return buildServiceRegistrationPlan({ mode, existingServices, projects, manifests });
}

describe("buildServiceRegistrationPlan", () => {
  it("derives the owner tribe from the project and keeps service attribution", () => {
    const result = plan(
      [
        manifest({
          serviceId: "logistics-orders",
          name: "Logistics Orders",
          baseUrl: "https://orders.example.test",
          requiredScopes: ["orders:read"],
          exposes: ["/orders", "/health"],
        }),
      ],
      [registry({ serviceId: "logistics" })],
    );

    expect(result.canApply).toBe(true);
    expect(result.items[0]).toMatchObject({
      serviceId: "logistics-orders",
      projectId: "logistics-core",
      ownerTribeId: "logistics",
      sourceServiceId: "logistics-orders",
      eventTopic: "tribe.logistics.events",
      action: "create",
    });
  });

  it("blocks registration into a project that does not exist", () => {
    const result = plan([manifest({ projectId: "unknown-project" })]);

    expect(result.canApply).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "project-missing", severity: "blocking" }),
    );
    expect(result.items[0]?.ownerTribeId).toBeNull();
  });

  it("blocks registration into an inactive project", () => {
    const result = plan([manifest({ projectId: "logistics-legacy" })]);

    expect(result.canApply).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "project-inactive" }),
    );
  });

  it("blocks moving an existing service to another project", () => {
    const result = plan(
      [manifest({ projectId: "logistics-billing" })],
      [registry({ projectId: "logistics-core" })],
    );

    expect(result.canApply).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "project-change", serviceId: "logistics" }),
    );
  });

  it("registers shared services without a project or tribe", () => {
    const result = plan([
      manifest({ serviceId: "payment", serviceType: "shared", projectId: undefined }),
    ]);

    expect(result.canApply).toBe(true);
    expect(result.items[0]).toMatchObject({ projectId: null, ownerTribeId: null });
  });

  it("blocks duplicate service IDs in one batch", () => {
    const result = plan([manifest(), manifest()]);

    expect(result.canApply).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "duplicate-service-id" }),
    );
  });

  it("warns for unknown consumes in local mode and blocks them in production mode", () => {
    const localPlan = plan([manifest({ consumes: ["payment"] })], [], "local-direct");
    const productionPlan = plan([manifest({ consumes: ["payment"] })]);

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
    const result = plan([manifest({ consumes: ["kafka"] })]);

    expect(result.canApply).toBe(true);
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: "unknown-consumed-service" }),
    );
  });
});
