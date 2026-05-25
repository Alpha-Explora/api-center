import { RegistryController } from "./registry.controller";
import { RegistryService } from "./registry.service";
import { LoggerService } from "../shared/logger.service";
import { AuditEventsService } from "../analytics/audit-events.service";

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
    record: jest.fn().mockResolvedValue(undefined),
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
    });
  });
});
