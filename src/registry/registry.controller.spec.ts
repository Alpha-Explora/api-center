import { RegistryController } from "./registry.controller";
import { RegistryService } from "./registry.service";
import { LoggerService } from "../shared/logger.service";
import { AuditEventsService } from "../analytics/audit-events.service";

describe("RegistryController", () => {
  const mockRegistry = {
    count: jest.fn(),
    getAll: jest.fn(),
  } as unknown as RegistryService;

  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;
  const mockAuditEvents = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditEventsService;

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
});
