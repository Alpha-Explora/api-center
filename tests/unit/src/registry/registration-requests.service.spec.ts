import { ServiceManifest } from "../../../../apps/gateway/src/types";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { RegistrationRequestsService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registration-requests.service";
import { TenancyService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.service";
import { RegistryChangeRequestStore } from "../../../../apps/gateway/src/domains/governance/change-requests/registry-change-request.types";

const activePlacement = {
  tribe: { tribeId: "logistics", name: "Logistics", status: "active" },
  project: { projectId: "logistics-fulfilment", tribeId: "logistics", name: "Fulfilment", status: "active" },
};

function manifest(overrides: Partial<ServiceManifest> = {}): ServiceManifest {
  return {
    serviceId: "logistics-orders",
    projectId: "logistics-fulfilment",
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
    projectId: "logistics-fulfilment",
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
  let requests: {
    create: jest.Mock;
    list: jest.Mock;
    find: jest.Mock;
    saveValidationReport: jest.Mock;
    markApplied: jest.Mock;
    rejectIfPending: jest.Mock;
  };
  let registry: {
    getAll: jest.Mock;
    register: jest.Mock;
  };
  let tenancy: { resolveProject: jest.Mock; refreshIfMissing: jest.Mock };
  let service: RegistrationRequestsService;

  beforeEach(() => {
    tenancy = {
      resolveProject: jest.fn().mockReturnValue(activePlacement),
      refreshIfMissing: jest.fn().mockResolvedValue(undefined),
    };
    requests = {
      create: jest.fn(),
      list: jest.fn(),
      find: jest.fn(),
      saveValidationReport: jest.fn().mockResolvedValue(undefined),
      markApplied: jest.fn(),
      rejectIfPending: jest.fn(),
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
      requests as unknown as RegistryChangeRequestStore,
      registry as unknown as RegistryService,
      tenancy as unknown as TenancyService,
    );
  });

  it("creates a pending request with the project and its derived tribe", async () => {
    requests.create.mockResolvedValueOnce(row());

    const result = await service.createRequest({
      manifest: manifest(),
      requestedBy: "github:logistics/orders",
    });

    expect(requests.create).toHaveBeenCalledWith({
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      projectId: "logistics-fulfilment",
      manifest: expect.objectContaining({ serviceId: "logistics-orders" }),
      validationReport: { canApply: true, issues: [] },
      requestedBy: "github:logistics/orders",
    });
    expect(result).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      serviceId: "logistics-orders",
      ownerTribeId: "logistics",
      status: "pending",
    });
  });

  it("approves a pending request by registering the manifest and marking it applied", async () => {
    requests.find.mockResolvedValueOnce(row());
    requests.markApplied.mockResolvedValueOnce(
      row({
        status: "applied",
        approvedBy: "platform-admin",
        appliedServiceId: "logistics-orders",
        decidedAt: new Date("2026-05-20T00:05:00.000Z"),
        appliedAt: new Date("2026-05-20T00:05:00.000Z"),
      }),
    );

    const result = await service.approveRequest("00000000-0000-0000-0000-000000000001", "platform-admin");

    expect(registry.register).toHaveBeenCalledWith(
      expect.objectContaining({ serviceId: "logistics-orders" }),
    );
    expect(requests.markApplied).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      approvedBy: "platform-admin",
      appliedServiceId: "logistics-orders",
      validationReport: { canApply: true, issues: [] },
    });
    expect(result.status).toBe("applied");
  });

  it("looks for a project created on another gateway instance before rejecting the request", async () => {
    requests.create.mockResolvedValueOnce(row());

    await service.createRequest({ manifest: manifest() });

    expect(tenancy.refreshIfMissing).toHaveBeenCalledWith("logistics-fulfilment");
  });

  it("drops a tribe left on a shared-service request by the pre-hierarchy format", async () => {
    const stored = { ...manifest(), serviceType: "shared", projectId: undefined, ownerTribeId: "logistics" };
    requests.find.mockResolvedValueOnce(
      row({ manifest: stored, ownerTribeId: null, projectId: null }),
    );
    requests.markApplied.mockResolvedValueOnce(row({ status: "applied" }));

    await service.approveRequest("00000000-0000-0000-0000-000000000001", "platform-admin");

    expect(registry.register).toHaveBeenCalledWith(
      expect.not.objectContaining({ ownerTribeId: expect.anything() }),
    );
  });

  it("recomputes validation at approval time and blocks stale requests", async () => {
    tenancy.resolveProject.mockReturnValue(null);
    requests.find.mockResolvedValueOnce(row());

    await expect(
      service.approveRequest("00000000-0000-0000-0000-000000000001", "platform-admin"),
    ).rejects.toThrow(
      "Project 'logistics-fulfilment' must exist before 'logistics-orders' can be registered.",
    );

    expect(registry.register).not.toHaveBeenCalled();
    expect(requests.markApplied).not.toHaveBeenCalled();
    expect(requests.saveValidationReport).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      expect.objectContaining({ canApply: false }),
    );
  });

  it("treats kafka consumes as a platform capability instead of an unknown service", async () => {
    requests.create.mockResolvedValueOnce(row());

    await service.createRequest({
      manifest: manifest({ consumes: ["kafka"] }),
      requestedBy: "github:logistics/orders",
    });

    expect(requests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        validationReport: { canApply: true, issues: [] },
      }),
    );
  });

  it("rejects a pending request without registering the manifest", async () => {
    requests.rejectIfPending.mockResolvedValueOnce(true);
    requests.find.mockResolvedValueOnce(
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
    expect(requests.rejectIfPending).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001", {
      rejectedBy: "platform-admin",
      reason: "Consumes list not approved.",
    });
    expect(result).toMatchObject({
      status: "rejected",
      rejectedBy: "platform-admin",
      rejectionReason: "Consumes list not approved.",
    });
  });

  it("does not reject a request that is no longer pending", async () => {
    requests.rejectIfPending.mockResolvedValueOnce(false);

    await expect(
      service.rejectRequest("00000000-0000-0000-0000-000000000001", "platform-admin", "Too late."),
    ).rejects.toThrow("Only pending registration requests can be rejected");
  });

  it("refuses to create a request for an unknown project", async () => {
    tenancy.resolveProject.mockReturnValue(null);

    await expect(
      service.createRequest({ manifest: manifest(), requestedBy: "github:logistics/orders" }),
    ).rejects.toThrow("Project 'logistics-fulfilment' is not registered");
    expect(requests.create).not.toHaveBeenCalled();
  });

  it("stores no tribe or project for shared-service requests", async () => {
    requests.create.mockResolvedValueOnce(
      row({ serviceId: "email", ownerTribeId: null, projectId: null }),
    );

    await service.createRequest({
      manifest: manifest({ serviceId: "email", serviceType: "shared", projectId: undefined }),
    });

    expect(requests.create).toHaveBeenCalledWith(
      expect.objectContaining({ ownerTribeId: null, projectId: null }),
    );
  });

  it("blocks approval when the service already belongs to another project", async () => {
    registry.getAll.mockReturnValue({
      "logistics-orders": { serviceId: "logistics-orders", projectId: "logistics-returns", consumes: [] },
    });
    requests.find.mockResolvedValueOnce(row());

    await expect(
      service.approveRequest("00000000-0000-0000-0000-000000000001", "platform-admin"),
    ).rejects.toThrow("services cannot move between projects");
    expect(registry.register).not.toHaveBeenCalled();
  });

  it("does not approve a non-pending request", async () => {
    requests.find.mockResolvedValueOnce(row({ status: "rejected" }));

    await expect(
      service.approveRequest("00000000-0000-0000-0000-000000000001", "platform-admin"),
    ).rejects.toThrow("Only pending registration requests can be approved");
  });
});
