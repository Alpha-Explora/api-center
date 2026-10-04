import { RegistryController } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.controller";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/audit-events.service";

describe("RegistryController", () => {
  const mockRegistry = {
    count: jest.fn(),
    getAll: jest.fn(),
    getConsumers: jest.fn(),
    register: jest.fn(),
    retire: jest.fn(),
  } as unknown as RegistryService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;
  const mockAuditEvents = {
    recordRequired: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditEventsService;
  const mockApprovals = {
    assertApprovedForAction: jest.fn(),
  };

  let controller: RegistryController;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockRegistry.count as jest.Mock).mockReturnValue(1);
    controller = new RegistryController(
      mockRegistry,
      mockLogger,
      mockAuditEvents,
      mockApprovals as any,
    );
  });

  describe("listServices", () => {
    it("returns ownerTribeId in service list responses", () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({
        "logistics-orders": {
          serviceId: "logistics-orders",
          ownerTribeId: "logistics",
          name: "Logistics Orders",
          baseUrl: "https://orders.example.test",
          status: "active",
          serviceType: "tribe",
          exposes: ["/orders"],
          requiredScopes: ["orders:read"],
          consumes: [],
          version: "1.0.0",
          registeredAt: "2026-05-20T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
      });

      const result = controller.listServices();

      expect(result.data[0]).toMatchObject({
        serviceId: "logistics-orders",
        ownerTribeId: "logistics",
      });
    });

    it("returns environment records in service list responses", () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({
        trinithrive: {
          serviceId: "trinithrive",
          ownerTribeId: "trinithrive",
          name: "TriniThrive",
          baseUrl: "https://trinithrive-test.example.com",
          status: "active",
          serviceType: "tribe",
          exposes: ["/health"],
          requiredScopes: ["service:read"],
          consumes: [],
          environments: [
            {
              environment: "test",
              baseUrl: "https://trinithrive-test.example.com",
              status: "active",
            },
          ],
          registeredAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
      });

      const result = controller.listServices();

      expect(result.data[0]).toMatchObject({
        serviceId: "trinithrive",
        environments: [
          {
            environment: "test",
            baseUrl: "https://trinithrive-test.example.com",
            status: "active",
          },
        ],
      });
    });

    it("returns top-level health fields in service list responses", () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({
        sms: {
          serviceId: "sms",
          name: "SMS Service",
          baseUrl: "http://sms-service:4011",
          healthCheck: "/health",
          healthy: false,
          lastHealthCheckAt: "2026-06-25T23:00:00.000Z",
          status: "active",
          serviceType: "shared",
          exposes: ["/send"],
          requiredScopes: ["sms:send"],
          consumes: [],
          registeredAt: "2026-06-18T00:00:00.000Z",
          updatedAt: "2026-06-18T00:00:00.000Z",
        },
      });

      const result = controller.listServices();

      expect(result.data[0]).toMatchObject({
        serviceId: "sms",
        healthCheck: "/health",
        healthy: false,
        lastHealthCheckAt: "2026-06-25T23:00:00.000Z",
      });
    });
  });

  describe("getScopes", () => {
    it("returns deduplicated platform, external, and dynamic service scopes", () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({
        "billing-service": {
          requiredScopes: ["billing:read", "billing:write"],
        },
        "ledger-service": {
          requiredScopes: ["billing:read", "ledger:read"],
        },
      });

      const response = controller.getScopes();

      expect(response.success).toBe(true);
      expect(response.data.platformScopes).toEqual(["platform:admin"]);
      expect(response.data.externalScopes).toEqual([]);
      expect(response.data.dynamicServiceScopes).toEqual([
        "billing:read",
        "billing:write",
        "ledger:read",
      ]);
      expect(response.data.allScopes).toEqual(
        expect.arrayContaining(["platform:admin", "billing:write"]),
      );
      expect(response.meta.total).toBe(response.data.allScopes.length);
    });

    it("handles empty service registry gracefully", () => {
      (mockRegistry.getAll as jest.Mock).mockReturnValue({});

      const response = controller.getScopes();

      expect(response.data.dynamicServiceScopes).toEqual([]);
      expect(response.data.allScopes).toEqual(["platform:admin"]);
    });
  });

  describe("approval gates", () => {
    it("registers one service identity with normalized environment URLs", async () => {
      (mockRegistry.register as jest.Mock).mockResolvedValue({
        serviceId: "trinithrive",
        name: "TriniThrive",
        baseUrl: "https://trinithrive-test.example.com",
        requiredScopes: ["service:read"],
        exposes: ["/health"],
        consumes: [],
        ownerTribeId: "trinithrive",
        serviceType: "tribe",
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
        registeredAt: "2026-06-18T00:00:00.000Z",
        updatedAt: "2026-06-18T00:00:00.000Z",
        status: "active",
      });

      await controller.register(
        {
          serviceId: "trinithrive",
          name: "TriniThrive",
          baseUrl: "https://trinithrive-test.example.com",
          requiredScopes: ["service:read"],
          exposes: ["/health"],
          ownerTribeId: "trinithrive",
          serviceType: "tribe",
          healthCheck: "/health",
          environments: [
            {
              environment: "test",
              baseUrl: "https://trinithrive-test.example.com",
            },
            {
              environment: "staging",
              baseUrl: "https://trinithrive-staging.example.com",
            },
          ],
        } as any,
        { correlationId: "corr-env" } as any,
      );

      expect(mockRegistry.register).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: "trinithrive",
          ownerTribeId: "trinithrive",
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
    });

    it("requires approval before live service registration", async () => {
      const guardedController = new RegistryController(
        mockRegistry,
        mockLogger,
        mockAuditEvents,
        mockApprovals as any,
      );
      (mockRegistry.register as jest.Mock).mockResolvedValue({
        serviceId: "orders",
        name: "Orders",
        baseUrl: "https://orders.example.test",
        requiredScopes: ["orders:read"],
        exposes: ["/orders"],
        consumes: [],
        serviceType: "tribe",
        status: "active",
      });

      await guardedController.register(
        {
          serviceId: "orders",
          name: "Orders",
          baseUrl: "https://orders.example.test",
          requiredScopes: ["orders:read"],
          exposes: ["/orders"],
          consumes: [],
          serviceType: "tribe",
          targetEnvironment: "live",
          approvalRequestId: "approval-1",
        } as any,
        { correlationId: "corr-register" } as any,
      );

      expect(mockApprovals.assertApprovedForAction).toHaveBeenCalledWith({
        approvalRequestId: "approval-1",
        actionType: "service.register_live",
        targetEnvironment: "live",
        targetId: "orders",
      });
      expect(mockRegistry.register).toHaveBeenCalledWith(
        expect.not.objectContaining({
          approvalRequestId: expect.anything(),
          targetEnvironment: expect.anything(),
        }),
      );
    });

    it("requires approval before service retirement", async () => {
      const guardedController = new RegistryController(
        mockRegistry,
        mockLogger,
        mockAuditEvents,
        mockApprovals as any,
      );
      (mockRegistry.getConsumers as jest.Mock).mockReturnValue([]);
      (mockRegistry.retire as jest.Mock).mockResolvedValue({
        serviceId: "orders",
        status: "retired",
      });

      await guardedController.retire(
        "orders",
        { approvalRequestId: "approval-2" },
        { correlationId: "corr-retire" } as any,
      );

      expect(mockApprovals.assertApprovedForAction).toHaveBeenCalledWith({
        approvalRequestId: "approval-2",
        actionType: "service.retire",
        targetEnvironment: "live",
        targetId: "orders",
      });
      expect(mockAuditEvents.recordRequired).toHaveBeenCalledWith({
        type: "registry.service.archive_requested",
        actionFamily: "lifecycle",
        actor: "platform-admin",
        serviceId: "orders",
        resourceType: "service",
        resourceId: "orders",
        environment: "live",
        correlationId: "corr-retire",
        severity: "info",
        message: "registry.service.archive_requested for orders",
        payload: {
          environment: "live",
          consumers: [],
          approvalRequestId: "approval-2",
        },
      });
    });

    it("fails closed when registry lifecycle audit evidence cannot be written", async () => {
      (mockRegistry.getConsumers as jest.Mock).mockReturnValue([]);
      (mockRegistry.retire as jest.Mock).mockResolvedValue({
        serviceId: "orders",
        status: "retired",
      });
      (mockAuditEvents.recordRequired as jest.Mock).mockRejectedValueOnce(
        new Error("audit unavailable"),
      );

      await expect(
        controller.retire("orders", { approvalRequestId: "approval-2" }, {
          correlationId: "corr-retire",
        } as any),
      ).rejects.toThrow("audit unavailable");
    });

    it("fails closed when live registration has no approval service", async () => {
      const unguardedController = new RegistryController(
        mockRegistry,
        mockLogger,
        mockAuditEvents,
        undefined as never,
      );

      await expect(
        unguardedController.register(
          {
            serviceId: "orders",
            name: "Orders",
            baseUrl: "https://orders.example.test",
            requiredScopes: ["orders:read"],
            exposes: ["/orders"],
            consumes: [],
            serviceType: "tribe",
            targetEnvironment: "live",
            approvalRequestId: "approval-1",
          } as any,
          { correlationId: "corr-register" } as any,
        ),
      ).rejects.toThrow("ApprovalRequestService is required");

      expect(mockRegistry.register).not.toHaveBeenCalled();
    });
  });
});
