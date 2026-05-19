import { RegistrationRequestsService } from "./registration-requests.service";
import { PrismaService } from "../database/prisma.service";
import { RegistryService } from "./registry.service";
import { ServiceManifest } from "../types";

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
    service_id: "logistics-orders",
    owner_tribe_id: "logistics",
    status: "pending",
    manifest: manifest(),
    validation_report: { canApply: true, issues: [] },
    requested_by: "github:logistics/orders",
    approved_by: null,
    rejected_by: null,
    rejection_reason: null,
    applied_service_id: null,
    created_at: new Date("2026-05-20T00:00:00.000Z"),
    updated_at: new Date("2026-05-20T00:00:00.000Z"),
    decided_at: null,
    applied_at: null,
    ...overrides,
  };
}

describe("RegistrationRequestsService", () => {
  let prisma: {
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };
  let registry: {
    getAll: jest.Mock;
    register: jest.Mock;
  };
  let service: RegistrationRequestsService;

  beforeEach(() => {
    prisma = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
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
    prisma.$queryRawUnsafe.mockResolvedValueOnce([row()]);

    const result = await service.createRequest({
      manifest: manifest(),
      requestedBy: "github:logistics/orders",
    });

    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("insert into api_center_ops.service_registration_requests"),
      "logistics-orders",
      "logistics",
      "pending",
      expect.stringContaining('"serviceId":"logistics-orders"'),
      expect.stringContaining('"canApply":true'),
      "github:logistics/orders",
    );
    expect(result).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      status: "pending",
    });
  });

  it("approves a pending request by registering the manifest and marking it applied", async () => {
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([
        row({
          status: "applied",
          approved_by: "platform-admin",
          applied_service_id: "logistics-orders",
          decided_at: new Date("2026-05-20T00:05:00.000Z"),
          applied_at: new Date("2026-05-20T00:05:00.000Z"),
        }),
      ]);

    const result = await service.approveRequest(
      "00000000-0000-0000-0000-000000000001",
      "platform-admin",
    );

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "logistics-orders" }),
    );
    expect(prisma.$queryRawUnsafe).toHaveBeenLastCalledWith(
      expect.stringContaining("status = 'applied'"),
      "platform-admin",
      "logistics-orders",
      "00000000-0000-0000-0000-000000000001",
    );
    expect(result.status).toBe("applied");
  });

  it("rejects a pending request without registering the manifest", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([
      row({
        status: "rejected",
        rejected_by: "platform-admin",
        rejection_reason: "Consumes list not approved.",
      }),
    ]);

    const result = await service.rejectRequest(
      "00000000-0000-0000-0000-000000000001",
      "platform-admin",
      "Consumes list not approved.",
    );

    expect(registry.register).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "rejected",
      rejectedBy: "platform-admin",
      rejectionReason: "Consumes list not approved.",
    });
  });

  it("does not approve a non-pending request", async () => {
    prisma.$queryRawUnsafe.mockResolvedValueOnce([row({ status: "rejected" })]);

    await expect(
      service.approveRequest(
        "00000000-0000-0000-0000-000000000001",
        "platform-admin",
      ),
    ).rejects.toThrow("Only pending registration requests can be approved");
  });
});
