import { readFile } from "node:fs/promises";

import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { ServiceManifest } from "../../../../apps/gateway/src/types";
import { RegistryBootstrapService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry-bootstrap.service";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { TenancyService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.service";

jest.mock("node:fs/promises", () => ({
  readFile: jest.fn(),
}));

const readFileMock = readFile as jest.MockedFunction<typeof readFile>;

function createManifest(
  overrides: Partial<ServiceManifest> = {},
): ServiceManifest {
  return {
    serviceId: "orders-service",
    name: "Orders Service",
    baseUrl: "http://orders.internal:4000",
    requiredScopes: ["orders:read"],
    exposes: ["/orders"],
    consumes: [],
    serviceType: "tribe",
    healthCheck: "/health",
    version: "1.0.0",
    ...overrides,
  };
}

describe("RegistryBootstrapService", () => {
  let service: RegistryBootstrapService;
  let mockRegistry: { register: jest.Mock };
  let mockLogger: { info: jest.Mock; warn: jest.Mock };
  let mockMetrics: { recordRegistryBootstrapSeed: jest.Mock };
  let mockTenancy: { seed: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();

    mockRegistry = {
      register: jest.fn(async (manifest: ServiceManifest) => ({
        ...manifest,
        status: "active",
        registeredAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
      })),
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
    };

    mockMetrics = {
      recordRegistryBootstrapSeed: jest.fn(),
    };
    mockTenancy = { seed: jest.fn().mockResolvedValue({ tribes: 0, projects: 0 }) };

    const config = {
      registryBootstrap: {
        enabled: true,
        manifestPaths: ["examples/one.json", "examples/two.json"],
      },
    } as unknown as ConfigService;

    service = new RegistryBootstrapService(
      config,
      mockLogger as unknown as LoggerService,
      mockMetrics as unknown as MetricsService,
      mockRegistry as unknown as RegistryService,
      mockTenancy as unknown as TenancyService,
    );
  });

  it("does not register any service when bootstrap mode is disabled", async () => {
    const disabledConfig = {
      registryBootstrap: {
        enabled: false,
        manifestPaths: ["examples/one.json"],
      },
    } as unknown as ConfigService;

    service = new RegistryBootstrapService(
      disabledConfig,
      mockLogger as unknown as LoggerService,
      mockMetrics as unknown as MetricsService,
      mockRegistry as unknown as RegistryService,
      mockTenancy as unknown as TenancyService,
    );

    await service.onApplicationBootstrap();

    expect(mockRegistry.register).not.toHaveBeenCalled();
  });

  it("seeds tribes and projects before registering manifests and keeps projectId", async () => {
    const seededConfig = {
      registryBootstrap: {
        enabled: true,
        manifestPaths: ["examples/one.json"],
        tenancySeedPath: "examples/tenancy-seed.json",
      },
    } as unknown as ConfigService;
    service = new RegistryBootstrapService(
      seededConfig,
      mockLogger as unknown as LoggerService,
      mockMetrics as unknown as MetricsService,
      mockRegistry as unknown as RegistryService,
      mockTenancy as unknown as TenancyService,
    );
    const order: string[] = [];
    mockTenancy.seed.mockImplementation(async () => {
      order.push("tenancy");
      return { tribes: 1, projects: 1 };
    });
    mockRegistry.register.mockImplementation(async (manifest: ServiceManifest) => {
      order.push(manifest.serviceId);
      return { ...manifest, status: "active", registeredAt: "", updatedAt: "" };
    });
    readFileMock
      .mockResolvedValueOnce(
        JSON.stringify({
          tribes: [{ tribeId: "orders", name: "Orders" }],
          projects: [{ projectId: "orders-core", tribeId: "orders", name: "Core" }],
        }),
      )
      .mockResolvedValueOnce(JSON.stringify(createManifest({ projectId: "orders-core" })));

    await service.onApplicationBootstrap();

    expect(order).toEqual(["tenancy", "orders-service"]);
    expect(mockTenancy.seed).toHaveBeenCalledWith({
      tribes: [{ tribeId: "orders", name: "Orders" }],
      projects: [{ projectId: "orders-core", tribeId: "orders", name: "Core" }],
    });
    expect(mockRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "orders-service", projectId: "orders-core" }),
    );
  });

  it("registers all valid manifests", async () => {
    const firstManifest = JSON.stringify(
      createManifest({ serviceId: "orders-service" }),
    );
    const secondManifest = JSON.stringify(
      createManifest({
        serviceId: "inventory-service",
        baseUrl: "https://inventory.internal",
      }),
    );

    readFileMock
      .mockResolvedValueOnce(firstManifest)
      .mockResolvedValueOnce(secondManifest);

    await service.onApplicationBootstrap();

    expect(mockRegistry.register).toHaveBeenCalledTimes(2);
  });

  it("skips invalid manifests and continues with remaining files", async () => {
    const invalidManifest = JSON.stringify({
      serviceId: "broken-service",
      name: "Broken Service",
      baseUrl: "not-a-url",
      requiredScopes: ["broken:read"],
      exposes: ["/broken"],
    });

    readFileMock
      .mockResolvedValueOnce(invalidManifest)
      .mockResolvedValueOnce(
        JSON.stringify(createManifest({ serviceId: "inventory-service" })),
      );

    await service.onApplicationBootstrap();

    expect(mockRegistry.register).toHaveBeenCalledTimes(1);
  });

  it("logs a warning when a manifest file cannot be read", async () => {
    readFileMock
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce(
        JSON.stringify(createManifest({ serviceId: "inventory-service" })),
      );

    await service.onApplicationBootstrap();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Registry bootstrap failed"),
      "RegistryBootstrapService",
    );
  });

  it("skips duplicate service ids deterministically", async () => {
    readFileMock
      .mockResolvedValueOnce(
        JSON.stringify(createManifest({ serviceId: "orders-service" })),
      )
      .mockResolvedValueOnce(
        JSON.stringify(
          createManifest({
            serviceId: "orders-service",
            baseUrl: "https://orders-backup.internal",
          }),
        ),
      );

    await service.onApplicationBootstrap();

    expect(mockRegistry.register).toHaveBeenCalledTimes(1);
  });
});
