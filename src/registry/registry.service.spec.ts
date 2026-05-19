// =============================================================================
// Integration tests — RegistryService
// =============================================================================
// Covers: registration, deregistration, lifecycle transitions (deprecate,
// retire, activate), semver version governance, Kafka event emission,
// metrics gauge sync, and access-control helpers.
// =============================================================================

import { RegistryService } from "./registry.service";
import { LoggerService } from "../shared/logger.service";
import { ConfigService } from "../config/config.service";
import { KafkaService } from "../kafka/kafka.service";
import { MetricsService } from "../metrics/metrics.service";
import { TribeSecretResolverService } from "./tribe-secret-resolver.service";
import { PostgresRegistryStoreService } from "./postgres-registry-store.service";
import { ServiceManifest } from "../types";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../shared/errors";
import { TOPICS } from "../kafka/topics";

// ── Mocks ────────────────────────────────────────────────────────────────────

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
    registrySource: "redis",
    dualWrite: false,
  } as any,
};

const mockKafka: Partial<KafkaService> = {
  publish: jest.fn().mockResolvedValue(undefined),
  publishNonBlocking: jest.fn(),
};

const mockMetrics: Partial<MetricsService> = {
  setRegistryServicesCount: jest.fn(),
  setRegistryServicesCountByStatus: jest.fn(),
};

const mockTribeSecretResolver: Partial<TribeSecretResolverService> = {
  validateSecret: jest.fn(),
};

const mockPostgresStore: Partial<PostgresRegistryStoreService> = {
  loadAll: jest.fn(),
  upsert: jest.fn(),
  remove: jest.fn(),
};

// ── Fixtures ─────────────────────────────────────────────────────────────────

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
    ...overrides,
  };
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe("RegistryService", () => {
  let service: RegistryService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockConfig as any).database = {
      enabled: false,
      provider: "",
      url: "",
      registrySource: "redis",
      dualWrite: false,
    };
    (mockPostgresStore.loadAll as jest.Mock).mockResolvedValue({});
    (mockPostgresStore.upsert as jest.Mock).mockResolvedValue(undefined);
    (mockPostgresStore.remove as jest.Mock).mockResolvedValue(undefined);
    // Construct without lifecycle hooks — avoids Redis connection
    service = new RegistryService(
      mockLogger as LoggerService,
      mockConfig as ConfigService,
      mockKafka as KafkaService,
      mockMetrics as MetricsService,
      mockTribeSecretResolver as TribeSecretResolverService,
      mockPostgresStore as PostgresRegistryStoreService,
    );
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

    it("publishes a SERVICE_REGISTERED Kafka event", async () => {
      await service.register(baseManifest());
      expect(mockKafka.publishNonBlocking).toHaveBeenCalledWith(
        TOPICS.SERVICE_REGISTERED,
        expect.objectContaining({ serviceId: "svc-alpha", isUpdate: false }),
        expect.any(Object),
      );
    });

    it("syncs the metrics gauge", async () => {
      await service.register(baseManifest());
      expect(mockMetrics.setRegistryServicesCount).toHaveBeenCalledWith(1);
    });

    it("dual-writes to Postgres when enabled", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
        dualWrite: true,
      };

      const entry = await service.register(baseManifest());

      expect(mockPostgresStore.upsert).toHaveBeenCalledWith(entry);
    });

    it("does not write to Postgres when dual-write is disabled", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
        dualWrite: false,
      };

      await service.register(baseManifest());

      expect(mockPostgresStore.upsert).not.toHaveBeenCalled();
    });

    it("rejects registration and restores memory when Postgres dual-write fails", async () => {
      (mockConfig as any).database = {
        ...mockConfig.database,
        enabled: true,
        dualWrite: true,
      };
      (mockPostgresStore.upsert as jest.Mock).mockRejectedValueOnce(
        new Error("db down"),
      );

      await expect(service.register(baseManifest())).rejects.toThrow(
        "Registry Postgres write failed for 'svc-alpha'",
      );
      expect(service.get("svc-alpha")).toBeNull();
    });

    it("updates an existing service while preserving registeredAt", async () => {
      const first = await service.register(baseManifest());
      const second = await service.register(baseManifest({ version: "1.1.0" }));

      expect(second.registeredAt).toBe(first.registeredAt);
      expect(second.previousVersion).toBe("1.0.0");
    });

    it("rejects re-registration of a retired service", async () => {
      await service.register(baseManifest());
      await service.retire("svc-alpha");

      await expect(
        service.register(baseManifest({ version: "2.0.0" })),
      ).rejects.toThrow(ConflictError);
    });

    it("rejects microservice registration when ownerTribeId is missing from registry", async () => {
      await expect(
        service.register(
          baseManifest({
            serviceId: "logistics-orders",
            ownerTribeId: "logistics",
            name: "Logistics Orders",
          }),
        ),
      ).rejects.toThrow("Owner tribe 'logistics' must be registered");
    });

    it("accepts microservice registration after owner tribe exists", async () => {
      await service.register(
        baseManifest({
          serviceId: "logistics",
          ownerTribeId: "logistics",
          name: "Logistics",
        }),
      );

      const entry = await service.register(
        baseManifest({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
        }),
      );

      expect(entry).toMatchObject({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
      });
    });
  });

  // =========================================================================
  // Deregistration
  // =========================================================================

  describe("deregister()", () => {
    it("removes the service and emits a Kafka event", async () => {
      await service.register(baseManifest());
      await service.deregister("svc-alpha");

      expect(service.get("svc-alpha")).toBeNull();
      expect(mockKafka.publishNonBlocking).toHaveBeenCalledWith(
        TOPICS.SERVICE_DEREGISTERED,
        expect.objectContaining({ serviceId: "svc-alpha" }),
        expect.any(Object),
      );
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

    it("emits a SERVICE_DEPRECATED Kafka event", async () => {
      await service.register(baseManifest());
      await service.deprecate("svc-alpha");

      expect(mockKafka.publishNonBlocking).toHaveBeenCalledWith(
        TOPICS.SERVICE_DEPRECATED,
        expect.objectContaining({ serviceId: "svc-alpha" }),
        expect.any(Object),
      );
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

    it("emits a SERVICE_RETIRED Kafka event", async () => {
      await service.register(baseManifest());
      await service.retire("svc-alpha");

      expect(mockKafka.publishNonBlocking).toHaveBeenCalledWith(
        TOPICS.SERVICE_RETIRED,
        expect.objectContaining({ serviceId: "svc-alpha" }),
        expect.any(Object),
      );
    });

    it("throws NotFoundError for unknown service", async () => {
      await expect(service.retire("unknown")).rejects.toThrow(NotFoundError);
    });
  });

  describe("activate()", () => {
    it("transitions deprecated → active and clears sunset fields", async () => {
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

    it("emits SERVICE_VERSION_CHANGED on version update", async () => {
      await service.register(baseManifest({ version: "1.0.0" }));
      await service.register(baseManifest({ version: "1.1.0" }));

      expect(mockKafka.publishNonBlocking).toHaveBeenCalledWith(
        TOPICS.SERVICE_VERSION_CHANGED,
        expect.objectContaining({
          serviceId: "svc-alpha",
          previousVersion: "1.0.0",
          newVersion: "1.1.0",
        }),
        expect.any(Object),
      );
    });

    it("does not emit VERSION_CHANGED when version is unchanged", async () => {
      await service.register(baseManifest({ version: "1.0.0" }));
      (mockKafka.publish as jest.Mock).mockClear();
      await service.register(baseManifest({ version: "1.0.0" }));

      const versionCalls = (mockKafka.publish as jest.Mock).mock.calls.filter(
        ([topic]: [string]) => topic === TOPICS.SERVICE_VERSION_CHANGED,
      );
      expect(versionCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // Routability
  // =========================================================================

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

  describe("canConsume()", () => {
    it("returns true when source consumes target", async () => {
      await service.register(
        baseManifest({ serviceId: "svc-a", consumes: ["svc-b"] }),
      );
      await service.register(
        baseManifest({ serviceId: "svc-b", consumes: [] }),
      );
      expect(service.canConsume("svc-a", "svc-b")).toBe(true);
    });

    it("returns false when source does not consume target", async () => {
      await service.register(
        baseManifest({ serviceId: "svc-a", consumes: [] }),
      );
      expect(service.canConsume("svc-a", "svc-b")).toBe(false);
    });

    it("uses ownerTribeId as the boundary for owned microservices", async () => {
      await service.register(
        baseManifest({
          serviceId: "logistics",
          ownerTribeId: "logistics",
          name: "Logistics Tribe",
          requiredScopes: ["logistics:read"],
          consumes: ["payment"],
        }),
      );
      await service.register(
        baseManifest({
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
          requiredScopes: ["orders:read"],
          consumes: [],
        }),
      );
      await service.register(
        baseManifest({
          serviceId: "payment",
          name: "Payment",
          serviceType: "shared",
          requiredScopes: ["payment:write"],
        }),
      );

      expect(service.getEffectiveOwnerTribeId("logistics-orders")).toBe(
        "logistics",
      );
      expect(service.getOwnedServices("logistics").map((svc) => svc.serviceId))
        .toEqual(expect.arrayContaining(["logistics", "logistics-orders"]));
      expect(service.canAccess("logistics", "logistics-orders")).toBe(true);
      expect(service.canConsume("logistics", "payment")).toBe(true);
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

  // =========================================================================
  // Full lifecycle flow
  // =========================================================================

  describe("full lifecycle: register → deprecate → retire", () => {
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
