import { SharedServicesController } from "./shared-services.controller";
import { RegistryService } from "../registry/registry.service";
import { AuthService } from "../auth/auth.service";
import { LoggerService } from "../shared/logger.service";
import { MetricsService } from "../metrics/metrics.service";

describe("SharedServicesController", () => {
  const mockRegistry = {
    onCacheInvalidation: jest.fn().mockReturnValue(() => undefined),
  } as unknown as RegistryService;

  const mockAuth = {
    mergeCallerScopes: jest.fn().mockReturnValue([]),
  } as unknown as AuthService;
  const mockLogger = {} as LoggerService;
  const mockMetrics = {} as MetricsService;

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
      tribeId: "caller-service",
      correlationId: "corr-shared-1",
    } as any);

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ serviceId: "payment-service" }]);
    expect(result.meta).toEqual(
      expect.objectContaining({
        total: 1,
        tribeId: "caller-service",
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

  it("should include non-consumable services for platform admins", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([
      "platform:admin",
    ]);
    handler.listServices.mockReturnValue([{ serviceId: "internal-shared" }]);

    controller.listSharedServices({
      tribeId: "caller-service",
      user: { scopes: ["platform:admin"] },
      correlationId: "corr-shared-3",
    } as any);

    expect(handler.listServices).toHaveBeenCalledWith("caller-service", true);
  });

  it("should release handler resources during module destroy", () => {
    controller.onModuleDestroy();

    expect(handler.destroy).toHaveBeenCalledTimes(1);
  });
});
