// =============================================================================
// Integration tests â€” RegistryService
// =============================================================================
// Covers: registration, deregistration, lifecycle transitions (deprecate,
// retire, activate), semver version governance, Kafka event emission,
// metrics gauge sync, and access-control helpers.
// =============================================================================

import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { ServiceSecretResolverService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/service-secret-resolver.service";
import { TenancyService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.service";
import { PostgresRegistryStoreService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/postgres-registry-store.service";
import { ApiSubscriptionsService } from "../../../../apps/gateway/src/domains/governance/api-subscriptions/api-subscriptions.service";
import { ServiceManifest } from "../../../../apps/gateway/src/types";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../../../../apps/gateway/src/shared/errors";

// â”€â”€ Mocks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const mockLogger: Partial<LoggerService> = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const mockConfig: Partial<ConfigService> = {
  redis: { cacheUrl: "", rateLimitUrl: "" } as any,
  database: {
    enabled: false,
    provider: "",
    url: "",
  } as any,
};

const mockMetrics: Partial<MetricsService> = {
  setRegistryServicesCount: jest.fn(),
  setRegistryServicesCountByStatus: jest.fn(),
};

const mockServiceSecretResolver: Partial<ServiceSecretResolverService> = {
  validateEnvironmentSecret: jest.fn(),
};

const mockPostgresStore: Partial<PostgresRegistryStoreService> = {
  loadAll: jest.fn(),
  upsert: jest.fn(),
  remove: jest.fn(),
  updateHealthStatus: jest.fn(),
};

// â”€â”€ Fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function baseManifest(
  overrides: Partial<ServiceManifest> = {},
): ServiceManifest {
  return {
    serviceId: "svc-alpha",
    name: "Alpha Service",
    baseUrl: "http://alpha:3000",
    requiredScopes: ["read"],
    exposes: ["/health"],
    consumes: [],
    version: "1.0.0",
    projectId: "alpha-core",
    ...overrides,
  };
}

async function seededTenancy(): Promise<TenancyService> {
  const tenancy = new TenancyService(
    mockLogger as LoggerService,
    mockConfig as ConfigService,
  );
  await tenancy.seed({
    tribes: [
      { tribeId: "alpha", name: "Alpha" },
      { tribeId: "commerce", name: "Commerce" },
      { tribeId: "fulfillment", name: "Fulfillment" },
      { tribeId: "logistics", name: "Logistics" },
    ],
    projects: [
      { projectId: "alpha-core", tribeId: "alpha", name: "Alpha core" },
      { projectId: "commerce-web", tribeId: "commerce", name: "Web" },
      { projectId: "commerce-billing", tribeId: "commerce", name: "Billing" },
      { projectId: "fulfillment-ops", tribeId: "fulfillment", name: "Ops" },
      { projectId: "logistics-orders", tribeId: "logistics", name: "Orders" },
    ],
  });
  return tenancy;
}

function registryEntry(overrides: Partial<ReturnType<typeof baseManifest>> = {}) {
  return {
    ...baseManifest(overrides),
    status: "active" as const,
    registeredAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    healthy: true,
  };
}

// â”€â”€ Test Suite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe("RegistryService", () => {
  let service: RegistryService;
  let tenancy: TenancyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (mockConfig as any).database = {
      enabled: false,
      provider: "",
      url: "",
    };
    (mockPostgresStore.loadAll as jest.Mock).mockResolvedValue({});
    (mockPostgresStore.upsert as jest.Mock).mockResolvedValue(undefined);
    (mockPostgresStore.remove as jest.Mock).mockResolvedValue(undefined);
    (mockPostgresStore.updateHealthStatus as jest.Mock).mockResolvedValue(undefined);
    tenancy = await seededTenancy();
    // Construct without lifecycle hooks — avoids background refresh timers.
    service = new RegistryService(
      mockLogger as LoggerService,
      mockConfig as ConfigService,
      mockMetrics as MetricsService,
      mockServiceSecretResolver as ServiceSecretResolverService,
      tenancy,
      mockPostgresStore as PostgresRegistryStoreService,
    );
  });

  describe("Postgres refresh", () => {
    it("replaces the local snapshot with changes written by another gateway instance", async () => {
      (mockConfig as any).database.enabled = true;
      let persisted: Record<string, any> = {};
      (mockPostgresStore.loadAll as jest.Mock).mockImplementation(async () => ({ ...persisted }));
      (mockPostgresStore.upsert as jest.Mock).mockImplementation(async (entry) => {
        persisted[entry.serviceId] = { ...entry };
      });
      (mockPostgresStore.remove as jest.Mock).mockImplementation(async (serviceId) => {
        persisted[serviceId] = {
          ...persisted[serviceId],
          status: "retired",
          updatedAt: new Date().toISOString(),
        };
      });

      const peer = new RegistryService(
        mockLogger as LoggerService,
        mockConfig as ConfigService,
        mockMetrics as MetricsService,
        mockServiceSecretResolver as ServiceSecretResolverService,
        tenancy,
        mockPostgresStore as PostgresRegistryStoreService,
      );
      await service.onModuleInit();
      await peer.onModuleInit();

      const invalidated: string[] = [];
      peer.onCacheInvalidation((serviceId) => invalidated.push(serviceId));
      await service.register(baseManifest());
      await peer.refreshFromPostgres();
      expect(peer.get("svc-alpha")?.status).toBe("active");

      await service.deprecate("svc-alpha");
      await peer.refreshFromPostgres();
      expect(peer.get("svc-alpha")?.status).toBe("deprecated");

      await service.deregister("svc-alpha");
      await peer.refreshFromPostgres();
      expect(peer.get("svc-alpha")?.status).toBe("retired");
      expect(invalidated).toEqual(["svc-alpha", "svc-alpha", "svc-alpha"]);
    });

    it("keeps the current snapshot when a refresh fails", async () => {
      (mockConfig as any).database.enabled = true;
      await service.register(baseManifest());
      (mockPostgresStore.loadAll as jest.Mock).mockRejectedValueOnce(new Error("db down"));

      await expect(service.refreshFromPostgres()).resolves.toBeUndefined();
      expect(service.get("svc-alpha")?.status).toBe("active");
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe("onModuleInit()", () => {
    it("loads the registry from Postgres when configured", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
      };
      (mockPostgresStore.loadAll as jest.Mock).mockResolvedValueOnce({
        "svc-alpha": registryEntry(),
      });
      await service.onModuleInit();

      expect(mockPostgresStore.loadAll).toHaveBeenCalledTimes(1);
      expect(service.count()).toBe(1);
      expect(service.get("svc-alpha")).toMatchObject({
        serviceId: "svc-alpha",
        status: "active",
      });
    });

    it("fails startup when Postgres registry source cannot load", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
      };
      (mockPostgresStore.loadAll as jest.Mock).mockRejectedValueOnce(
        new Error("db down"),
      );
      await expect(service.onModuleInit()).rejects.toThrow("db down");
      expect(service.count()).toBe(0);
    });
  });

  // =========================================================================
  // Registration
  // =========================================================================

  describe("register()", () => {
    it("registers a new service and returns an active entry", async () => {
      const entry = await service.register(baseManifest());
      expect(entry.serviceId).toBe("svc-alpha");
      expect(entry.status).toBe("active");
      expect(entry.registeredAt).toBeDefined();
      expect(entry.updatedAt).toBeDefined();
    });


    it("syncs the metrics gauge", async () => {
      await service.register(baseManifest());
      expect(mockMetrics.setRegistryServicesCount).toHaveBeenCalledWith(1);
    });

    it("persists to Postgres before making a service visible", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
      };
      const visibleDuringWrite: boolean[] = [];
      (mockPostgresStore.upsert as jest.Mock).mockImplementation(async () => {
        visibleDuringWrite.push(service.get("svc-alpha") !== null);
      });

      const entry = await service.register(baseManifest());

      expect(mockPostgresStore.upsert).toHaveBeenCalledWith(entry);
      expect(visibleDuringWrite).toEqual([false]);
    });

    it("uses memory when no database is configured", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: false,
      };

      await service.register(baseManifest());

      expect(mockPostgresStore.upsert).not.toHaveBeenCalled();
    });

    it("does not expose a registration when its Postgres write fails", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
      };
      (mockPostgresStore.upsert as jest.Mock).mockRejectedValueOnce(
        new Error("db down"),
      );

      await expect(service.register(baseManifest())).rejects.toThrow(
        "db down",
      );
      expect(service.get("svc-alpha")).toBeNull();
    });

    it("updates an existing service while preserving registeredAt", async () => {
      const first = await service.register(baseManifest());
      const second = await service.register(baseManifest({ version: "1.1.0" }));

      expect(second.registeredAt).toBe(first.registeredAt);
      expect(second.previousVersion).toBe("1.0.0");
    });

    it("keeps tribe, project, and consumer lookups current after registration updates", async () => {
      await service.register(
        baseManifest({ serviceId: "orders", projectId: "commerce-web", consumes: ["payment"] }),
      );
      await service.register(
        baseManifest({ serviceId: "checkout", projectId: "commerce-web", consumes: ["payment"] }),
      );
      await service.register(
        baseManifest({ serviceId: "invoices", projectId: "commerce-billing" }),
      );
      await service.register(
        baseManifest({ serviceId: "orders", projectId: "commerce-web", consumes: ["email"], version: "1.1.0" }),
      );

      expect(service.getOwnedServices("commerce").map((entry) => entry.serviceId)).toEqual([
        "checkout",
        "invoices",
        "orders",
      ]);
      expect(service.getProjectServices("commerce-web").map((entry) => entry.serviceId)).toEqual([
        "checkout",
        "orders",
      ]);
      expect(service.getConsumers("payment")).toEqual(["checkout"]);
      expect(service.getConsumers("email")).toEqual(["orders"]);
    });

    it("rejects re-registration of a retired service", async () => {
      await service.register(baseManifest());
      await service.retire("svc-alpha");

      await expect(
        service.register(baseManifest({ version: "2.0.0" })),
      ).rejects.toThrow(ConflictError);
    });

    it("derives the owning tribe from the project", async () => {
      const entry = await service.register(
        baseManifest({ serviceId: "logistics-api", projectId: "logistics-orders" }),
      );

      expect(entry).toMatchObject({ projectId: "logistics-orders", ownerTribeId: "logistics" });
      expect(service.getEffectiveOwnerTribeId("logistics-api")).toBe("logistics");
    });

    it("rejects tribe services without a project, with an unknown project, or in a suspended project", async () => {
      await expect(
        service.register(baseManifest({ projectId: undefined })),
      ).rejects.toThrow("projectId is required for tribe services");
      await expect(
        service.register(baseManifest({ projectId: "missing-project" })),
      ).rejects.toThrow("Project 'missing-project' is not registered");

      await tenancy.updateProject("alpha-core", { status: "suspended" });
      await expect(service.register(baseManifest())).rejects.toThrow(
        "Project 'alpha-core' is suspended",
      );
    });

    it("rejects registration while the owning tribe is suspended", async () => {
      await tenancy.updateTribe("alpha", { status: "suspended" });

      await expect(service.register(baseManifest())).rejects.toThrow("Tribe 'alpha' is suspended");
    });

    it("rejects shared services with placement and gives valid shared services no tribe", async () => {
      await expect(
        service.register(baseManifest({ serviceId: "email", serviceType: "shared" })),
      ).rejects.toThrow("Shared service 'email' cannot have tribe or project placement");

      const sharedWithOwner = Object.assign(
        baseManifest({ serviceId: "email", serviceType: "shared", projectId: undefined }),
        { ownerTribeId: "commerce" },
      );
      await expect(service.register(sharedWithOwner)).rejects.toThrow(
        "Shared service 'email' cannot have tribe or project placement",
      );

      const shared = await service.register(
        baseManifest({ serviceId: "email", serviceType: "shared", projectId: undefined }),
      );
      expect(shared.projectId).toBeUndefined();
      expect(shared.ownerTribeId).toBeUndefined();
    });

    it("does not let a service move to another project", async () => {
      await service.register(baseManifest({ serviceId: "orders", projectId: "commerce-web" }));

      await expect(
        service.register(
          baseManifest({ serviceId: "orders", projectId: "fulfillment-ops", version: "1.1.0" }),
        ),
      ).rejects.toThrow(
        "Service 'orders' belongs to project 'commerce-web' and cannot move to 'fulfillment-ops'",
      );
      expect(service.get("orders")?.ownerTribeId).toBe("commerce");
    });
  });

  // =========================================================================
  // Deregistration
  // =========================================================================

  describe("deregister()", () => {
    it("marks the service retired in Postgres and local reads", async () => {
      (mockConfig as any).database.enabled = true;
      await service.register(baseManifest());
      await service.deregister("svc-alpha");

      expect(mockPostgresStore.remove).toHaveBeenCalledWith("svc-alpha");
      expect(service.get("svc-alpha")?.status).toBe("retired");
    });

    it("throws NotFoundError for unknown service", async () => {
      await expect(service.deregister("unknown")).rejects.toThrow(
        NotFoundError,
      );
    });

    it("sets metrics gauge to 0 after last service removed", async () => {
      await service.register(baseManifest());
      await service.deregister("svc-alpha");
      expect(mockMetrics.setRegistryServicesCount).toHaveBeenLastCalledWith(0);
    });
  });

  // =========================================================================
  // Lifecycle Transitions
  // =========================================================================

  describe("deprecate()", () => {
    it("marks a service as deprecated with optional sunset info", async () => {
      await service.register(baseManifest());
      const entry = await service.deprecate(
        "svc-alpha",
        "2025-12-31",
        "svc-beta",
      );

      expect(entry.status).toBe("deprecated");
      expect(entry.sunsetDate).toBe("2025-12-31");
      expect(entry.replacementService).toBe("svc-beta");
    });

    it("throws NotFoundError for unknown service", async () => {
      await expect(service.deprecate("unknown")).rejects.toThrow(NotFoundError);
    });

    it("throws ConflictError when depreciating an already retired service", async () => {
      await service.register(baseManifest());
      await service.retire("svc-alpha");
      await expect(service.deprecate("svc-alpha")).rejects.toThrow(
        ConflictError,
      );
    });
  });

  describe("retire()", () => {
    it("marks a service as retired", async () => {
      await service.register(baseManifest());
      const entry = await service.retire("svc-alpha");
      expect(entry.status).toBe("retired");
    });

    it("throws NotFoundError for unknown service", async () => {
      await expect(service.retire("unknown")).rejects.toThrow(NotFoundError);
    });
  });

  describe("activate()", () => {
    it("transitions deprecated â†’ active and clears sunset fields", async () => {
      await service.register(baseManifest());
      await service.deprecate("svc-alpha", "2025-12-31", "svc-beta");
      const entry = await service.activate("svc-alpha");

      expect(entry.status).toBe("active");
      expect(entry.sunsetDate).toBeUndefined();
      expect(entry.replacementService).toBeUndefined();
    });

    it("throws ConflictError for already-active services", async () => {
      await service.register(baseManifest());
      await expect(service.activate("svc-alpha")).rejects.toThrow(
        ConflictError,
      );
    });

    it("throws NotFoundError for unknown service", async () => {
      await expect(service.activate("unknown")).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // Version Governance (semver)
  // =========================================================================

  describe("version governance", () => {
    it("allows minor and patch upgrades", async () => {
      await service.register(baseManifest({ version: "1.0.0" }));

      await expect(
        service.register(baseManifest({ version: "1.1.0" })),
      ).resolves.not.toThrow();

      await expect(
        service.register(baseManifest({ version: "1.1.1" })),
      ).resolves.not.toThrow();
    });

    it("allows major upgrades", async () => {
      await service.register(baseManifest({ version: "1.5.3" }));

      await expect(
        service.register(baseManifest({ version: "2.0.0" })),
      ).resolves.not.toThrow();
    });

    it("rejects major version downgrades", async () => {
      await service.register(baseManifest({ version: "2.0.0" }));

      await expect(
        service.register(baseManifest({ version: "1.9.9" })),
      ).rejects.toThrow(ValidationError);
    });

  });

  // =========================================================================
  // Routability
  // =========================================================================

  describe("health status", () => {
    it("keeps health probe observations local when Postgres persistence fails and recovers", async () => {
      (mockConfig as any).database.enabled = true;
      await service.register(baseManifest());

      const invalidated = jest.fn();
      service.onCacheInvalidation(invalidated);
      (mockPostgresStore.updateHealthStatus as jest.Mock).mockImplementationOnce(
        async () => {
          expect(service.get("svc-alpha")?.healthy).toBe(false);
          expect(service.isRoutable("svc-alpha")).toBe(false);
          expect(invalidated).toHaveBeenCalledWith("svc-alpha");
          throw new Error("database unavailable");
        },
      );

      await expect(service.setHealthStatus("svc-alpha", false)).resolves.toBe(
        true,
      );
      expect(service.get("svc-alpha")?.healthy).toBe(false);
      expect(service.isRoutable("svc-alpha")).toBe(false);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("database unavailable"),
        "RegistryService",
      );

      await expect(service.setHealthStatus("svc-alpha", true)).resolves.toBe(
        true,
      );
      expect(service.get("svc-alpha")?.healthy).toBe(true);
      expect(service.isRoutable("svc-alpha")).toBe(true);
      expect(invalidated).toHaveBeenCalledTimes(2);
    });
  });

  describe("isRoutable()", () => {
    it("returns true for active services", async () => {
      await service.register(baseManifest());
      expect(service.isRoutable("svc-alpha")).toBe(true);
    });

    it("returns true for deprecated services", async () => {
      await service.register(baseManifest());
      await service.deprecate("svc-alpha");
      expect(service.isRoutable("svc-alpha")).toBe(true);
    });

    it("returns false for retired services", async () => {
      await service.register(baseManifest());
      await service.retire("svc-alpha");
      expect(service.isRoutable("svc-alpha")).toBe(false);
    });

    it("returns false for unknown services", () => {
      expect(service.isRoutable("unknown")).toBe(false);
    });
  });

  // =========================================================================
  // Access Control & Consumers
  // =========================================================================

  describe("canAccess()", () => {
    beforeEach(async () => {
      await service.register(
        baseManifest({ serviceId: "web-api", projectId: "commerce-web", requiredScopes: ["web:read"] }),
      );
      await service.register(
        baseManifest({ serviceId: "web-worker", projectId: "commerce-web", requiredScopes: ["worker:run"] }),
      );
      await service.register(
        baseManifest({
          serviceId: "billing-api",
          projectId: "commerce-billing",
          requiredScopes: ["billing:read"],
          consumes: ["payment", "shipments"],
        }),
      );
      await service.register(
        baseManifest({ serviceId: "shipments", projectId: "fulfillment-ops", requiredScopes: ["shipments:read"] }),
      );
      await service.register(
        baseManifest({
          serviceId: "payment",
          serviceType: "shared",
          projectId: undefined,
          requiredScopes: ["payment:write"],
        }),
      );
    });

    it("allows calls between services of the same project", () => {
      expect(service.canAccess("web-api", "web-worker")).toBe(true);
      expect(service.canAccess("web-worker", "web-api")).toBe(true);
    });

    it("denies calls into a sibling project of the same tribe without a consumes grant", () => {
      expect(service.canAccess("web-api", "billing-api")).toBe(false);
      expect(service.canAccess("billing-api", "web-api")).toBe(false);
    });

    it("grants project API access only after approval and denies it after revocation", () => {
      service.replaceSubscriptions([]);
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(false);
      service.setSubscriptionStatus(
        "commerce-web",
        "commerce-billing",
        "billing-api",
        "test",
        "approved",
      );
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(true);
      expect(service.canAccess("web-api", "billing-api", "live")).toBe(false);
      service.setSubscriptionStatus(
        "commerce-web",
        "commerce-billing",
        "billing-api",
        "test",
        "revoked",
      );
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(false);
      service.setSubscriptionStatus(
        "commerce-billing",
        "fulfillment-ops",
        "shipments",
        "test",
        "approved",
      );
      expect(service.canAccess("billing-api", "shipments", "test")).toBe(true);
      service.setSubscriptionStatus(
        "commerce-billing",
        "fulfillment-ops",
        "shipments",
        "test",
        "revoked",
      );
      expect(service.canAccess("billing-api", "shipments", "test")).toBe(false);
    });

    it("requires an approved subscription for static cross-project consumes grants", () => {
      service.replaceSubscriptions([]);
      expect(service.canAccess("billing-api", "shipments", "test")).toBe(false);
      service.setSubscriptionStatus(
        "commerce-billing",
        "fulfillment-ops",
        "shipments",
        "test",
        "approved",
      );
      expect(service.canAccess("billing-api", "shipments", "test")).toBe(true);
      expect(service.canAccess("billing-api", "shipments", "live")).toBe(false);
      service.setSubscriptionStatus(
        "commerce-billing",
        "fulfillment-ops",
        "shipments",
        "test",
        "revoked",
      );
      expect(service.canAccess("billing-api", "shipments", "test")).toBe(false);
    });

    it("requires a fresh DB snapshot, fails closed after refresh failure, and recovers", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-10T00:00:00Z"));
      process.env.DATABASE_ENABLED = "true";
      process.env.API_SUBSCRIPTION_REFRESH_MS = "45001";
      process.env.API_SUBSCRIPTION_MAX_STALENESS_MS = "45000";
      const grant = {
        consumerProjectId: "commerce-web",
        apiProjectId: "commerce-billing",
        apiServiceId: "billing-api",
        environment: "test",
        status: "approved",
      };
      const prisma = {
        apiSubscription: { findMany: jest.fn().mockResolvedValueOnce([grant]) },
      };
      const subscriptionService = new ApiSubscriptionsService(
        prisma as never,
        service,
        {} as never,
        mockLogger as LoggerService,
      );
      try {
        await subscriptionService.onApplicationBootstrap();
        expect(service.canAccess("web-api", "billing-api", "test")).toBe(true);
        prisma.apiSubscription.findMany.mockRejectedValue(
          new Error("database unavailable"),
        );
        await jest.advanceTimersByTimeAsync(45_001);
        expect(service.canAccess("web-api", "billing-api", "test")).toBe(false);
        prisma.apiSubscription.findMany.mockResolvedValue([grant]);
        await (subscriptionService as any).refreshSubscriptionStatuses();
        expect(service.canAccess("web-api", "billing-api", "test")).toBe(true);
      } finally {
        subscriptionService.onModuleDestroy();
        jest.useRealTimers();
        delete process.env.DATABASE_ENABLED;
        delete process.env.API_SUBSCRIPTION_REFRESH_MS;
        delete process.env.API_SUBSCRIPTION_MAX_STALENESS_MS;
      }
    });

    it("does not create a fresh snapshot when database bootstrap is disabled", async () => {
      process.env.DATABASE_ENABLED = "false";
      const prisma = { apiSubscription: { findMany: jest.fn() } };
      const subscriptionService = new ApiSubscriptionsService(
        prisma as never,
        service,
        {} as never,
        mockLogger as LoggerService,
      );
      await subscriptionService.onApplicationBootstrap();
      expect(prisma.apiSubscription.findMany).not.toHaveBeenCalled();
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(false);
      delete process.env.DATABASE_ENABLED;
    });

    it("does not let local status updates create or extend a fresh snapshot", () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-10T00:00:00Z"));
      service.setSubscriptionStatus(
        "commerce-web",
        "commerce-billing",
        "billing-api",
        "test",
        "approved",
      );
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(false);
      service.replaceSubscriptions([], 45_000);
      jest.advanceTimersByTime(45_001);
      service.setSubscriptionStatus(
        "commerce-web",
        "commerce-billing",
        "billing-api",
        "test",
        "approved",
      );
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(false);
      jest.useRealTimers();
    });

    it("does not transfer an approved grant when a retired service slug is registered by another project", async () => {
      service.replaceSubscriptions([
        {
          consumerProjectId: "commerce-web",
          apiProjectId: "commerce-billing",
          apiServiceId: "billing-api",
          environment: "test",
          status: "approved",
        },
      ]);
      await service.deregister("billing-api");
      await expect(
        service.register(
          baseManifest({ serviceId: "billing-api", projectId: "logistics-orders" }),
        ),
      ).rejects.toThrow(
        "Service 'billing-api' belongs to project 'commerce-billing' and cannot move to 'logistics-orders'",
      );
      await service.register(
        baseManifest({ serviceId: "logistics-worker", projectId: "logistics-orders" }),
      );
      expect(service.canAccess("web-api", "billing-api", "test")).toBe(true);
      expect(service.canAccess("logistics-worker", "billing-api", "test")).toBe(false);
    });

    it("denies static consumes to a project API when the caller has no project identity", async () => {
      await service.register(
        baseManifest({
          serviceId: "unplaced-worker",
          serviceType: "shared",
          projectId: undefined,
          consumes: ["shipments"],
        }),
      );
      expect(service.canAccess("unplaced-worker", "shipments", "test")).toBe(false);
    });

    it("allows manifest consumes for shared services", () => {
      expect(service.canAccess("billing-api", "payment")).toBe(true);
    });

    it("does not let one service borrow a sibling's grants", () => {
      expect(service.canAccess("web-api", "payment")).toBe(false);
      expect(service.canAccess("web-api", "shipments")).toBe(false);
    });

    it("lists only the callable services of the caller", () => {
      expect(service.getCallableServiceIds("billing-api").sort()).toEqual([
        "billing-api",
        "payment",
        "shipments",
      ]);
      expect(service.getCallableServiceIds("web-api").sort()).toEqual(["web-api", "web-worker"]);
    });

    it("rejects unknown callers and targets", () => {
      expect(service.canAccess("unknown", "web-api")).toBe(false);
      expect(service.canAccess("web-api", "unknown")).toBe(false);
    });
  });

  describe("getConsumers()", () => {
    it("returns list of services that consume the given serviceId", async () => {
      await service.register(
        baseManifest({ serviceId: "svc-a", consumes: ["svc-c"] }),
      );
      await service.register(
        baseManifest({ serviceId: "svc-b", consumes: ["svc-c"] }),
      );
      await service.register(
        baseManifest({ serviceId: "svc-c", consumes: [] }),
      );

      const consumers = service.getConsumers("svc-c");
      expect(consumers).toEqual(expect.arrayContaining(["svc-a", "svc-b"]));
      expect(consumers).toHaveLength(2);
    });
  });


  describe("secret validation", () => {
    it("delegates environment-scoped validation to the resolver", async () => {
      (mockServiceSecretResolver.validateEnvironmentSecret as jest.Mock).mockResolvedValue(true);

      await expect(
        service.validateEnvironmentSecret("svc-alpha", "secret", "test"),
      ).resolves.toBe(true);

      expect(mockServiceSecretResolver.validateEnvironmentSecret).toHaveBeenCalledWith(
        "svc-alpha",
        "secret",
        "test",
      );
    });

  });
  // =========================================================================
  // Full lifecycle flow
  // =========================================================================

  describe("full lifecycle: register â†’ deprecate â†’ retire", () => {
    it("walks through the entire lifecycle", async () => {
      // 1. Register
      const v1 = await service.register(baseManifest());
      expect(v1.status).toBe("active");

      // 2. Version bump
      const v2 = await service.register(baseManifest({ version: "1.1.0" }));
      expect(v2.previousVersion).toBe("1.0.0");

      // 3. Deprecate
      const dep = await service.deprecate(
        "svc-alpha",
        "2025-12-31",
        "svc-beta",
      );
      expect(dep.status).toBe("deprecated");
      expect(service.isRoutable("svc-alpha")).toBe(true);

      // 4. Re-registering while deprecated keeps deprecated status
      const v3 = await service.register(baseManifest({ version: "1.2.0" }));
      expect(v3.status).toBe("deprecated");

      // 5. Retire
      const ret = await service.retire("svc-alpha");
      expect(ret.status).toBe("retired");
      expect(service.isRoutable("svc-alpha")).toBe(false);

      // 6. Cannot re-register once retired
      await expect(
        service.register(baseManifest({ version: "2.0.0" })),
      ).rejects.toThrow(ConflictError);
    });
  });
});
