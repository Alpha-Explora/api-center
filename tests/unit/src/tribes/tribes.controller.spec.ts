import { TribesController } from "../../../../apps/gateway/src/domains/gateway-proxy/tribes/tribes.controller";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { AuthService } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { GatewayTrafficService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/gateway-traffic.service";

describe("TribesController", () => {
  const mockRegistry = {
    onCacheInvalidation: jest.fn().mockReturnValue(() => undefined),
  } as unknown as RegistryService;

  const mockAuth = {
    mergeCallerScopes: jest.fn().mockReturnValue([]),
  } as unknown as AuthService;
  const mockLogger = {} as LoggerService;
  const mockMetrics = {} as MetricsService;
  const mockAuditEvents = {} as AuditEventsService;
  const mockGatewayTraffic = {} as GatewayTrafficService;
  const mockQuotaEnforcer = { check: jest.fn().mockResolvedValue(undefined) };
  const mockPolicyEngine = { evaluate: jest.fn().mockReturnValue([]) };
  const mockEmergencyControls = { evaluate: jest.fn() };

  let controller: TribesController;
  let handler: {
    listServices: jest.Mock;
    proxyRequest: jest.Mock;
    destroy: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TribesController(
      mockRegistry,
      mockAuth,
      mockLogger,
      mockMetrics,
      mockAuditEvents,
      mockGatewayTraffic,
      mockQuotaEnforcer as any,
      mockPolicyEngine as any,
      mockEmergencyControls as any,
    );

    handler = {
      listServices: jest.fn(),
      proxyRequest: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    };

    (controller as any).handler = handler;
  });

  it("should list tribe services with namespace metadata", () => {
    handler.listServices.mockReturnValue([{ serviceId: "billing-service" }]);

    const result = controller.listServices({
      tribeId: "caller-tribe",
      sourceServiceId: "caller-service",
      correlationId: "corr-tribe-1",
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ serviceId: "billing-service" }]);
    expect(result.meta).toEqual(
      expect.objectContaining({
        total: 1,
        tribeId: "caller-tribe",
        namespace: "tribe",
        correlationId: "corr-tribe-1",
      }),
    );
    expect(handler.listServices).toHaveBeenCalledWith("caller-service", false);
  });

  it("should include non-consumable tribe services for platform admins", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([
      "platform:admin",
    ]);
    handler.listServices.mockReturnValue([{ serviceId: "internal-tribe" }]);

    controller.listServices({
      tribeId: "caller-tribe",
      sourceServiceId: "caller-service",
      user: { scopes: ["platform:admin"] },
      correlationId: "corr-tribe-3",
    } as any);

    expect(handler.listServices).toHaveBeenCalledWith("caller-service", true);
  });

  it("should delegate proxy requests to the shared proxy handler", async () => {
    const req = {
      tribeId: "caller-service",
      correlationId: "corr-tribe-2",
    } as any;
    const res = {} as any;

    await controller.proxy("billing-service", req, res);

    expect(handler.proxyRequest).toHaveBeenCalledWith(
      "billing-service",
      req,
      res,
    );
  });

  it("should destroy handler resources on module shutdown", () => {
    controller.onModuleDestroy();

    expect(handler.destroy).toHaveBeenCalledTimes(1);
  });
});
