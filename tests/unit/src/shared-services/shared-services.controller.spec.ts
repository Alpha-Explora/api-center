import { SharedServicesController } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.controller";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { AuthService } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { GatewayTrafficService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/gateway-traffic.service";
import { SharedServiceUsageService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/shared-service-usage.service";
import { SharedServiceEventPublisher } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-service-event-publisher";
import { SharedServiceRoutingService } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-service-routing.service";
import { SharedCallerGuard } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-caller.guard";

describe("SharedServicesController", () => {
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
  const mockSharedServiceUsage = {} as SharedServiceUsageService;
  const mockSharedServiceEvents = {} as SharedServiceEventPublisher;
  const mockSharedServiceRouting = {
    resolve: jest.fn(),
  } as unknown as SharedServiceRoutingService;
  const mockQuotaEnforcer = { check: jest.fn().mockResolvedValue(undefined) };
  const mockPolicyEngine = { evaluate: jest.fn().mockReturnValue([]) };
  const mockEmergencyControls = { evaluate: jest.fn() };
  const mockApplicationProxy = { forward: jest.fn().mockResolvedValue(undefined) };

  let controller: SharedServicesController;
  let handler: {
    listServices: jest.Mock;
    proxyRequest: jest.Mock;
    destroy: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SharedServicesController(
      mockRegistry,
      mockAuth,
      mockLogger,
      mockMetrics,
      mockAuditEvents,
      mockGatewayTraffic,
      mockSharedServiceUsage,
      mockSharedServiceEvents,
      mockSharedServiceRouting,
      mockQuotaEnforcer as any,
      mockPolicyEngine as any,
      mockEmergencyControls as any,
      mockApplicationProxy as any,
    );

    handler = {
      listServices: jest.fn(),
      proxyRequest: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn(),
    };

    (controller as any).handler = handler;
  });

  it("should list shared services with shared namespace metadata", () => {
    handler.listServices.mockReturnValue([{ serviceId: "payment-service" }]);

    const result = controller.listSharedServices({
      tribeId: "caller-tribe",
      sourceServiceId: "caller-service",
      correlationId: "corr-shared-1",
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ serviceId: "payment-service" }]);
    expect(result.meta).toEqual(
      expect.objectContaining({
        total: 1,
        tribeId: "caller-tribe",
        namespace: "shared",
        correlationId: "corr-shared-1",
      }),
    );
  });

  it("should delegate shared proxy requests to the proxy handler", async () => {
    const req = {
      tribeId: "caller-service",
      correlationId: "corr-shared-2",
    } as any;
    const res = {} as any;

    await controller.proxy("payment-service", req, res);

    expect(handler.proxyRequest).toHaveBeenCalledWith(
      "payment-service",
      req,
      res,
    );
  });

  it("routes an application credential to the control-plane proxy, not the legacy handler", async () => {
    const bearer = "ak_test_aaaaaaaaaaaaaaaa_" + "b".repeat(43);
    const req = { headers: { authorization: `Bearer ${bearer}` } } as any;
    const res = {} as any;

    await controller.proxy("Email", req, res);

    expect(mockApplicationProxy.forward).toHaveBeenCalledWith("email", bearer, req, res);
    expect(handler.proxyRequest).not.toHaveBeenCalled();
  });

  it("keeps legacy service JWTs on the legacy handler", async () => {
    const req = { headers: { authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig" } } as any;

    await controller.proxy("email", req, {} as any);

    expect(handler.proxyRequest).toHaveBeenCalled();
    expect(mockApplicationProxy.forward).not.toHaveBeenCalled();
  });

  it("should include non-consumable services for platform admins", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([
      "platform:admin",
    ]);
    handler.listServices.mockReturnValue([{ serviceId: "internal-shared" }]);

    controller.listSharedServices({
      tribeId: "caller-tribe",
      sourceServiceId: "caller-service",
      user: { scopes: ["platform:admin"] },
      correlationId: "corr-shared-3",
    } as any);

    expect(handler.listServices).toHaveBeenCalledWith("caller-service", true, "test");
  });

  it("should release handler resources during module destroy", () => {
    controller.onModuleDestroy();

    expect(handler.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("SharedCallerGuard", () => {
  function contextFor(authorization?: string) {
    const request = { headers: authorization ? { authorization } : {} };
    return { switchToHttp: () => ({ getRequest: () => request }) } as any;
  }

  it("lets application credentials through to the fail-closed application proxy", async () => {
    const jwt = { canActivate: jest.fn() };
    const guard = new SharedCallerGuard(jwt as any);
    await expect(guard.canActivate(contextFor("Bearer ak_test_x"))).toBe(true);
    expect(jwt.canActivate).not.toHaveBeenCalled();
  });

  it("sends every other bearer, and a missing one, through the legacy JWT guard", async () => {
    const jwt = { canActivate: jest.fn().mockRejectedValue(new Error("Invalid or expired token")) };
    const guard = new SharedCallerGuard(jwt as any);
    await expect(guard.canActivate(contextFor("Bearer apic_legacy"))).rejects.toThrow("Invalid or expired token");
    await expect(guard.canActivate(contextFor())).rejects.toThrow("Invalid or expired token");
    expect(jwt.canActivate).toHaveBeenCalledTimes(2);
  });
});
