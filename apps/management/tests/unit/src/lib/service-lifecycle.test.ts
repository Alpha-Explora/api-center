import { describe, expect, it } from "vitest";
import { buildPlatformLifecycle, buildServiceLifecycle } from "../../../../src/lib/service-lifecycle";
import type {
  QuotaPolicy,
  QuotaUsageDecision,
  ServiceRegistryEntry,
} from "../../../../src/lib/schemas";

const baseService: ServiceRegistryEntry = {
  serviceId: "campus-one",
  name: "Campus One",
  baseUrl: "https://campus-one.example.test",
  requiredScopes: ["campus:read", "external:kafka:write"],
  exposes: ["/students"],
  consumes: ["payment-service"],
  projectId: "campus-one-default",
  ownerTribeId: "campus-one",
  serviceType: "tribe",
  healthCheck: "/health",
  version: "1.0.0",
  tags: ["campus"],
  ownerTeam: "Campus One",
  contact: "campus@example.test",
  serviceTier: "critical",
  costCenter: "CAMPUS",
  registeredAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  status: "active",
  healthy: true,
  lastHealthCheckAt: "2026-06-14T00:00:00.000Z",
};

const sharedService: ServiceRegistryEntry = {
  serviceId: "payment-service",
  name: "Payment Service",
  baseUrl: "https://payments.example.test",
  requiredScopes: ["payments:write"],
  exposes: ["/checkout"],
  consumes: [],
  serviceType: "shared",
  healthCheck: "/health",
  version: "1.0.0",
  tags: ["payments"],
  ownerTeam: "Payments",
  contact: "payments@example.test",
  serviceTier: "critical",
  costCenter: "PAY",
  registeredAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  status: "active",
  healthy: true,
  lastHealthCheckAt: "2026-06-14T00:00:00.000Z",
};

const quotaPolicy: QuotaPolicy = {
  id: "campus-one-observe",
  ownerTribeId: "campus-one",
  scope: "all",
  targetServiceId: null,
  windowSeconds: 86400,
  maxRequests: 25000,
  burstRequests: null,
  mode: "observe",
  status: "active",
  reason: "Launch baseline",
  updatedAt: "2026-06-14T00:00:00.000Z",
};

const quotaUsage: QuotaUsageDecision = {
  id: "usage-campus-one",
  policyId: "campus-one-observe",
  ownerTribeId: "campus-one",
  scope: "all",
  targetServiceId: null,
  routeFamily: "all",
  windowStart: "2026-06-14T00:00:00.000Z",
  windowEnd: "2026-06-15T00:00:00.000Z",
  requestCount: 12000,
  maxRequests: 25000,
  mode: "observe",
  outcome: "allowed",
  createdAt: "2026-06-14T00:00:00.000Z",
};

describe("service lifecycle spine", () => {
  it("marks an event-exporting service for attention until pipeline evidence is checked", () => {
    const lifecycle = buildServiceLifecycle({
      service: baseService,
      services: [baseService, sharedService],
      quotaPolicies: [quotaPolicy],
      quotaUsage: [quotaUsage],
    });

    expect(lifecycle.status).toBe("attention");
    expect(lifecycle.nextAction.href).toBe(
      `/tribes/${baseService.serviceId}?section=pipeline`,
    );
    expect(lifecycle.stages.map((stage) => stage.status)).not.toContain(
      "blocked",
    );
    expect(lifecycle.stages.find((stage) => stage.id === "pipeline")?.status).toBe(
      "attention",
    );
  });

  it("surfaces blocked dependencies and quota enforcement ahead of lower-priority lifecycle work", () => {
    const blockedUsage: QuotaUsageDecision = {
      ...quotaUsage,
      outcome: "blocked",
      requestCount: 26000,
    };
    const lifecycle = buildServiceLifecycle({
      service: { ...baseService, consumes: ["missing-service"] },
      services: [baseService],
      quotaPolicies: [quotaPolicy],
      quotaUsage: [blockedUsage],
    });

    expect(lifecycle.status).toBe("blocked");
    expect(lifecycle.nextAction.stageId).toBe("dependencies");
    expect(lifecycle.nextAction.href).toBe(
      `/tribes/${baseService.serviceId}?section=dependencies`,
    );
    expect(lifecycle.stages.find((stage) => stage.id === "quotas")?.href).toBe(
      `/tribes/${baseService.serviceId}?section=quotas`,
    );
    expect(lifecycle.blockedCount).toBe(2);
  });

  it("keeps quota and promotion lifecycle actions in the service detail record", () => {
    const lifecycle = buildServiceLifecycle({
      service: {
        ...baseService,
        healthy: undefined,
        lastHealthCheckAt: undefined,
        requiredScopes: ["campus:read"],
      },
      services: [baseService, sharedService],
      quotaPolicies: [],
      quotaUsage: [],
    });

    expect(lifecycle.stages.find((stage) => stage.id === "quotas")?.href).toBe(
      `/tribes/${baseService.serviceId}?section=quotas`,
    );
    expect(lifecycle.stages.find((stage) => stage.id === "promotion")?.href).toBe(
      `/tribes/${baseService.serviceId}?section=governance`,
    );
    expect(lifecycle.nextAction.href).toBe(
      `/tribes/${baseService.serviceId}?section=health`,
    );
  });

  it("sorts the platform lifecycle by blocked services before attention and ready services", () => {
    const platform = buildPlatformLifecycle({
      services: [
        sharedService,
        baseService,
        {
          ...baseService,
          serviceId: "unowned-api",
          name: "Unowned API",
          ownerTeam: "",
          contact: "",
          consumes: [],
          requiredScopes: ["unowned:read"],
        },
      ],
      quotaPolicies: [quotaPolicy],
      quotaUsage: [quotaUsage],
    });

    expect(platform.entries[0]?.service.serviceId).toBe("unowned-api");
    expect(platform.summary.blocked).toBe(1);
    expect(platform.summary.ready).toBeGreaterThan(0);
  });
});
