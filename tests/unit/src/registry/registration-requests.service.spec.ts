import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { ServiceManifest } from "../../../../apps/gateway/src/types";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { RegistrationRequestsService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registration-requests.service";

function manifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
  return {
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
    name: "Logistics Orders",
    baseUrl: "https://orders.example.test",
    requiredScopes: ["orders:read"],
    exposes: ["/orders", "/health"],
    consumes: [],
    serviceType: "tribe",
    version: "1.0.0",
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    serviceId: "logistics-orders",
    ownerTribeId: "logistics",
    status: "pending",
    manifest: manifest(),
    validationReport: { canApply: true, issues: [] },
    requestedBy: "github:logistics/orders",
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    appliedServiceId: null,
    createdAt: new Date("2026-05-20T00:00:00.000Z"),
    updatedAt: new Date("2026-05-20T00:00:00.000Z"),
    decidedAt: null,
    appliedAt: null,
    ...overrides,
  };
}

describe("RegistrationRequestsService", () => {
  let prisma: {
    registryChangeRequest: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let registry: {
    getAll: jest.Mock;
    register: jest.Mock;
  };
  let service: RegistrationRequestsService;

  beforeEach(() => {
    prisma = {
      registryChangeRequest: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    registry = {
      getAll: jest.fn().mockReturnValue({
        logistics: {
          serviceId: "logistics",
          serviceType: "tribe",
          consumes: [],
        },
      }),
      register: jest.fn().mockResolvedValue({
        ...manifest(),
        status: "active",
        registeredAt: "2026-05-20T00:00:00.000Z",
        updatedAt: "2026-05-20T00:00:00.000Z",
      }),
    };
    service = new RegistrationRequestsService(
      prisma as unknown as PrismaService,
      registry as unknown as RegistryService,
    );
  });

  it("creates a pending request with owner tribe metadata and validation report", async () => {
    prisma.registryChangeRequest.create.mockResolvedValueOnce(row());

    const result = await service.createRequest({
      manifest: manifest(),
      requestedBy: "github:logistics/orders",
    });

    expect(prisma.registryChangeRequest.create).toHaveBeenCalledWith({
      data: {
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
        status: "pending",
        manifest: expect.objectContaining({ serviceId: "logistics-orders" }),
        validationReport: { canApply: true, issues: [] },
        requestedBy: "github:logistics/orders",
      },
    });
    expect(result).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      status: "pending",
    });
  });

  it("approves a pending request by registering the manifest and marking it applied", async () => {
    prisma.registryChangeRequest.findUnique.mockResolvedValueOnce(row());
    prisma.registryChangeRequest.update.mockResolvedValueOnce(
      row({
        status: "applied",
        approvedBy: "platform-admin",
        appliedServiceId: "logistics-orders",
        decidedAt: new Date("2026-05-20T00:05:00.000Z"),
        appliedAt: new Date("2026-05-20T00:05:00.000Z"),
      }),
    );

    const result = await service.approveRequest(
      "00000000-0000-0000-0000-000000000001",
      "platform-admin",
    );

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "logistics-orders" }),
    );
    expect(prisma.registryChangeRequest.update).toHaveBeenCalledWith({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      data: expect.objectContaining({
        status: "applied",
        approvedBy: "platform-admin",
        appliedServiceId: "logistics-orders",
        validationReport: { canApply: true, issues: [] },
      }),
    });
    expect(result.status).toBe("applied");
  });

  it("recomputes validation at approval time and blocks stale requests", async () => {
    registry.getAll.mockReturnValue({});
    prisma.registryChangeRequest.findUnique.mockResolvedValueOnce(row());
    prisma.registryChangeRequest.update.mockResolvedValueOnce(
      row({
        validationReport: {
          canApply: false,
          issues: [
            {
              severity: "blocking",
              code: "owner-tribe-missing",
              serviceId: "logistics-orders",
              message: "Owner tribe is missing.",
            },
          ],
        },
      }),
    );

    await expect(
      service.approveRequest(
        "00000000-0000-0000-0000-000000000001",
        "platform-admin",
      ),
    ).rejects.toThrow(
      "Owner tribe 'logistics' must exist before 'logistics-orders' can be registered.",
    );

    expect(registry.register).not.toHaveBeenCalled();
    expect(prisma.registryChangeRequest.update).toHaveBeenCalledWith({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      data: {
        validationReport: expect.objectContaining({ canApply: false }),
      },
    });
  });

  it("treats kafka consumes as a platform capability instead of an unknown service", async () => {
    prisma.registryChangeRequest.create.mockResolvedValueOnce(row());

    await service.createRequest({
      manifest: manifest({ consumes: ["kafka"] }),
      requestedBy: "github:logistics/orders",
    });

    expect(prisma.registryChangeRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        validationReport: { canApply: true, issues: [] },
      }),
    });
  });

  it("rejects a pending request without registering the manifest", async () => {
    prisma.registryChangeRequest.updateMany.mockResolvedValueOnce({
      count: 1,
    });
    prisma.registryChangeRequest.findUnique.mockResolvedValueOnce(
      row({
        status: "rejected",
        rejectedBy: "platform-admin",
        rejectionReason: "Consumes list not approved.",
      }),
    );

    const result = await service.rejectRequest(
      "00000000-0000-0000-0000-000000000001",
      "platform-admin",
      "Consumes list not approved.",
    );

    expect(registry.register).not.toHaveBeenCalled();
    expect(prisma.registryChangeRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: "00000000-0000-0000-0000-000000000001",
        status: "pending",
      },
      data: expect.objectContaining({
        status: "rejected",
        rejectedBy: "platform-admin",
        rejectionReason: "Consumes list not approved.",
      }),
    });
    expect(result).toMatchObject({
      status: "rejected",
      rejectedBy: "platform-admin",
      rejectionReason: "Consumes list not approved.",
    });
  });

  it("does not approve a non-pending request", async () => {
    prisma.registryChangeRequest.findUnique.mockResolvedValueOnce(
      row({ status: "rejected" }),
    );

    await expect(
      service.approveRequest(
        "00000000-0000-0000-0000-000000000001",
        "platform-admin",
      ),
    ).rejects.toThrow("Only pending registration requests can be approved");
  });
});
