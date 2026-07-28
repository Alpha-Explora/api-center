import { PostgresRegistryStoreService } from "../../../../apps/gateway/src/registry/postgres-registry-store.service";
import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { ServiceRegistryEntry } from "../../../../apps/gateway/src/types";

function entry(
  overrides: Partial<ServiceRegistryEntry> = {},
): ServiceRegistryEntry {
  return {
    serviceId: "servease",
    name: "Servease",
    baseUrl: "http://servease.local",
    requiredScopes: ["servease:read"],
    exposes: ["/health", "/orders"],
    consumes: ["payment", "missing-service"],
    serviceType: "tribe",
    ownerTribeId: "servease",
    healthCheck: "/health",
    version: "1.0.0",
    description: "Test tribe",
    tags: ["orders"],
    ownerTeam: "servease-team",
    contact: "servease@example.com",
    serviceTier: "standard",
    costCenter: "capstone",
    registeredAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T01:00:00.000Z",
    status: "active",
    healthy: true,
    environments: [
      {
        environment: "test",
        baseUrl: "http://servease.local",
        healthCheck: "/health",
        status: "active",
        healthy: true,
      },
    ],
    ...overrides,
  };
}

describe("PostgresRegistryStoreService", () => {
  let tx: any;
  let prisma: any;
  let service: PostgresRegistryStoreService;

  beforeEach(() => {
    tx = {
      organization: {
        upsert: jest.fn().mockResolvedValue({ id: "org-1" }),
      },
      service: {
        upsert: jest.fn().mockResolvedValue({ id: "service-1" }),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ id: "payment-id" })
          .mockResolvedValueOnce(null),
        updateMany: jest.fn(),
      },
      serviceRoute: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      serviceScope: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      serviceDependency: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      serviceEnvironment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      serviceLifecycleEvent: {
        create: jest.fn().mockResolvedValue({ id: "event-1" }),
      },
    };

    prisma = {
      service: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    service = new PostgresRegistryStoreService(prisma as PrismaService);
  });

  it("upserts service metadata, routes, scopes, dependencies, and lifecycle event in one transaction", async () => {
    await service.upsert(entry());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.organization.upsert).toHaveBeenCalledWith({
      where: { slug: "default" },
      update: {},
      create: { slug: "default", name: "Default Organization" },
    });
    expect(tx.service.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organization_service_id: {
            organizationId: "org-1",
            serviceId: "servease",
          },
        },
      }),
    );
    expect(tx.service.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ownerTribeId: "servease" }),
        update: expect.objectContaining({ ownerTribeId: "servease" }),
      }),
    );
    expect(tx.serviceRoute.createMany).toHaveBeenCalledWith({
      data: [
        { serviceId: "service-1", path: "/health" },
        { serviceId: "service-1", path: "/orders" },
      ],
    });
    expect(tx.serviceScope.createMany).toHaveBeenCalledWith({
      data: [{ serviceId: "service-1", scope: "servease:read" }],
    });
    expect(tx.serviceDependency.createMany).toHaveBeenCalledWith({
      data: [
        {
          serviceId: "service-1",
          dependencyType: "consumes",
          required: true,
          dependsOnServiceId: "payment-id",
        },
        {
          serviceId: "service-1",
          dependencyType: "consumes",
          required: true,
          dependsOnExternalId: "missing-service",
        },
      ],
    });
    expect(tx.serviceLifecycleEvent.create).toHaveBeenCalledWith({
      data: {
        serviceId: "service-1",
        eventType: "updated",
        nextStatus: "active",
        nextVersion: "1.0.0",
        metadata: {},
      },
    });
  });

  it("persists environment rows separately from service identity", async () => {
    await service.upsert(
      entry({
        serviceId: "trinithrive",
        ownerTribeId: "trinithrive",
        baseUrl: "https://trinithrive-test.example.com",
        environments: [
          {
            environment: "test",
            baseUrl: "https://trinithrive-test.example.com",
            healthCheck: "/health",
            status: "active",
          },
          {
            environment: "staging",
            baseUrl: "https://trinithrive-staging.example.com",
            healthCheck: "/health",
            status: "active",
          },
        ],
      }),
    );

    expect(tx.serviceEnvironment.deleteMany).toHaveBeenCalledWith({
      where: { serviceId: "service-1" },
    });
    expect(tx.serviceEnvironment.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          serviceId: "service-1",
          environment: "test",
          baseUrl: "https://trinithrive-test.example.com",
        }),
        expect.objectContaining({
          serviceId: "service-1",
          environment: "staging",
          baseUrl: "https://trinithrive-staging.example.com",
        }),
      ],
    });
  });

  it("loads registry rows into service entries", async () => {
    prisma.service.findMany.mockResolvedValue([
      {
        serviceId: "payment",
        ownerTribeId: null,
        name: "Payment Shared Service",
        serviceType: "shared",
        baseUrl: "http://payment-service:4010",
        healthCheckPath: "/health",
        status: "active",
        version: "1.0.0",
        previousVersion: null,
        description: null,
        tags: ["payments"],
        ownerTeam: "platform",
        contact: "platform@example.com",
        serviceTier: "critical",
        costCenter: null,
        sunsetDate: null,
        replacementServiceId: null,
        healthy: true,
        lastHealthCheckAt: new Date("2026-05-15T01:00:00.000Z"),
        registeredAt: new Date("2026-05-15T00:00:00.000Z"),
        updatedAt: new Date("2026-05-15T01:00:00.000Z"),
        environments: [
          {
            environment: "test",
            baseUrl: "http://payment-service:4010",
            healthCheckPath: "/health",
            status: "active",
            healthy: true,
            lastHealthCheckAt: new Date("2026-05-15T01:00:00.000Z"),
          },
        ],
        routes: [{ path: "/checkout" }],
        scopes: [{ scope: "payment:write" }],
        dependencies: [
          {
            dependsOnExternalId: "external-bank",
            dependsOnService: null,
          },
        ],
      },
    ]);

    const result = await service.loadAll();

    expect(result.payment).toEqual(
      expect.objectContaining({
        serviceId: "payment",
        serviceType: "shared",
        ownerTribeId: undefined,
        exposes: ["/checkout"],
        requiredScopes: ["payment:write"],
        consumes: ["external-bank"],
        tags: ["payments"],
        environments: [
          expect.objectContaining({
            environment: "test",
            baseUrl: "http://payment-service:4010",
          }),
        ],
      }),
    );
  });

  it("defaults tribe owner to serviceId when storing legacy tribe entries", async () => {
    await service.upsert(
      entry({ serviceId: "legacy-tribe", ownerTribeId: undefined }),
    );

    expect(tx.service.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ ownerTribeId: "legacy-tribe" }),
        update: expect.objectContaining({ ownerTribeId: "legacy-tribe" }),
      }),
    );
  });

  it("marks removed services as retired", async () => {
    await service.remove("servease");

    expect(prisma.service.updateMany).toHaveBeenCalledWith({
      where: { serviceId: "servease" },
      data: {
        status: "retired",
        updatedAt: expect.any(Date),
      },
    });
  });
});
