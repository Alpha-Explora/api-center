// =============================================================================
// Unit tests â€” ProxyHandler
// =============================================================================
// Covers proxy creation/caching, cache invalidation, circuit-breaker gating,
// lifecycle enforcement (deprecated headers, retired rejection), and scope
// checking.
// =============================================================================

import {
  ProxyHandler,
  ProxyHandlerDeps,
  ProxyOptions,
  GoneError,
  setCreateProxyMiddlewareForTesting,
} from "../../../../apps/gateway/src/shared/proxy-handler";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { AuthService } from "../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import {
  NotFoundError,
  ForbiddenError,
  ServiceUnavailableError,
} from "../../../../apps/gateway/src/shared/errors";
import { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

// ---- Mock http-proxy-middleware ----
const mockProxyMiddleware = jest.fn((_req: any, _res: any, _next: any) => {});
const mockCreateProxyMiddleware = jest.fn(() => mockProxyMiddleware);

// ---- Mock factory helpers ----

function createMockDeps(): ProxyHandlerDeps {
  return {
    registry: {
      resolveUpstream: jest.fn(),
      resolveEnvironment: jest.fn().mockReturnValue({
        environment: "test",
        baseUrl: "http://localhost:3001",
        status: "active",
      }),
      get: jest.fn(),
      getByType: jest.fn().mockReturnValue([]),
      canConsume: jest.fn().mockReturnValue(true),
      canAccess: jest.fn().mockReturnValue(true),
      getRequiredScopes: jest.fn().mockReturnValue([]),
      validateSecret: jest.fn(),
      onCacheInvalidation: jest.fn().mockReturnValue(() => {}),
    } as unknown as RegistryService,
    // Use AuthService mock (provider-agnostic, replaces DescopeService)
    auth: {
      checkScopes: jest.fn().mockReturnValue([]),
    } as unknown as AuthService,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    } as unknown as LoggerService,
    metrics: {
      recordProxyRequest: jest.fn(),
      recordServiceDiscoverySnapshot: jest.fn(),
    } as unknown as MetricsService,
    auditEvents: {
      record: jest.fn().mockResolvedValue(undefined),
    } as any,
    gatewayTraffic: {
      recordProxyRequest: jest.fn().mockResolvedValue(undefined),
    } as any,
    sharedServiceUsage: {
      record: jest.fn().mockResolvedValue(undefined),
    } as any,
    sharedServiceEvents: {
      publishSharedServiceCall: jest.fn(),
    } as any,
    quotaEnforcer: {
      check: jest.fn().mockResolvedValue(undefined),
    } as any,
    policyEngine: {
      evaluate: jest.fn().mockReturnValue([]),
    } as any,
    emergencyControls: {
      evaluate: jest.fn().mockReturnValue({ allowed: true }),
    } as any,
  };
}

const defaultOpts: ProxyOptions = {
  namespace: "tribe",
  pathPrefix: "/api/v1/tribes",
};

function fakeReq(
  overrides: Partial<AuthenticatedRequest> = {},
): AuthenticatedRequest {
  const tribeId = overrides.tribeId ?? "svc-alpha";
  const sourceServiceId = overrides.sourceServiceId ?? tribeId;
  const user = {
    sub: tribeId,
    tribeId,
    sourceServiceId,
    environment: "test" as const,
    permissions: [],
    scopes: [],
    ...(overrides.user ?? {}),
  };

  return {
    tribeId,
    sourceServiceId,
    correlationId: "corr-1",
    method: "GET",
    user,
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function fakeRes() {
  return {
    statusCode: 200,
    setHeader: jest.fn(),
    on: jest.fn(),
  } as any;
}

function fakeResWithFinish(statusCode = 200) {
  const finishHandlers: Array<() => void> = [];

  return {
    statusCode,
    setHeader: jest.fn(),
    on: jest.fn((event: string, handler: () => void) => {
      if (event === "finish") finishHandlers.push(handler);
    }),
    write: jest.fn(),
    end: jest.fn(),
    finishHandlers,
  } as any;
}

// =============================================================================
// Tests
// =============================================================================

describe("ProxyHandler", () => {
  let deps: ProxyHandlerDeps;
  let handler: ProxyHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    setCreateProxyMiddlewareForTesting(mockCreateProxyMiddleware as any);
    deps = createMockDeps();
    handler = new ProxyHandler(deps, defaultOpts);
  });

  afterEach(() => {
    handler.destroy();
    setCreateProxyMiddlewareForTesting(undefined);
  });

  // =========================================================================
  // Proxy creation & caching
  // =========================================================================
  describe("proxy creation and caching", () => {
    beforeEach(() => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "user-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });
    });

    it("creates a proxy middleware on first request to a service", async () => {
      const req = fakeReq();
      const res = fakeRes();

      await handler.proxyRequest("user-svc", req, res);

      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);
      expect(mockProxyMiddleware).toHaveBeenCalledWith(
        req,
        res,
        expect.any(Function),
      );
    });

    it("routes to the token environment URL", async () => {
      (deps.registry.resolveEnvironment as jest.Mock).mockReturnValue({
        environment: "live",
        baseUrl: "https://trinithrive.example.com",
        status: "active",
      });
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "trinithrive",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });

      await handler.proxyRequest(
        "trinithrive",
        fakeReq({
          user: { environment: "live" } as any,
        }),
        fakeRes(),
      );

      expect(mockCreateProxyMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "https://trinithrive.example.com",
        }),
      );
    });


    it("rejects caller-controlled environment override headers", async () => {
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "user-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
        environments: [
          { environment: "test", baseUrl: "http://localhost:3001", status: "active" },
          { environment: "live", baseUrl: "http://localhost:3002", status: "active" },
        ],
      });

      await expect(
        handler.proxyRequest(
          "user-svc",
          fakeReq({
            headers: { "x-apicenter-target-environment": "live" } as any,
          }),
          fakeRes(),
        ),
      ).rejects.toThrow("Environment override headers are not allowed");
    });

    it("rejects proxy requests when the token is missing environment", async () => {
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "user-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
        environments: [
          { environment: "test", baseUrl: "http://localhost:3001", status: "active" },
        ],
      });

      await expect(
        handler.proxyRequest(
          "user-svc",
          fakeReq({ user: { sub: "svc-alpha", tribeId: "svc-alpha" } as any }),
          fakeRes(),
        ),
      ).rejects.toThrow("APICenter token is missing environment");
    });
    it("checks tribe quota before acquiring proxy resources", async () => {
      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());

      expect(deps.quotaEnforcer.check).toHaveBeenCalledWith({
        ownerTribeId: "svc-alpha",
        scope: "tribe",
        targetServiceId: "user-svc",
        routeFamily: "tribe:user-svc",
        correlationId: "corr-1",
        environment: "test",
      });
      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);
    });

    it("reuses the cached proxy on subsequent requests", async () => {
      const req = fakeReq();
      const res = fakeRes();

      await handler.proxyRequest("user-svc", req, res);
      await handler.proxyRequest("user-svc", req, fakeRes());

      // createProxyMiddleware should only be called once (cached)
      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);
      // but the actual proxy function is invoked twice
      expect(mockProxyMiddleware).toHaveBeenCalledTimes(2);
    });

    it("creates separate proxy instances per service", async () => {
      (deps.registry.resolveUpstream as jest.Mock)
        .mockReturnValueOnce("http://localhost:3001")
        .mockReturnValueOnce("http://localhost:3002");
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "other-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });

      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());
      await handler.proxyRequest("other-svc", fakeReq(), fakeRes());

      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // Cache invalidation
  // =========================================================================
  describe("invalidateProxyCache()", () => {
    beforeEach(() => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "user-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });
    });

    it("drops cached instance so a new one is created on next request", async () => {
      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());
      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);

      handler.invalidateProxyCache("user-svc");

      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());
      // Should have created a *new* proxy after invalidation
      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(2);
    });

    it("logs when an existing proxy is invalidated", () => {
      // Manually populate cache
      (handler as any).proxyCache.set("user-svc", jest.fn());

      handler.invalidateProxyCache("user-svc");

      expect(deps.logger.info).toHaveBeenCalledWith(
        expect.stringContaining("invalidated"),
        expect.objectContaining({ serviceId: "user-svc" }),
      );
    });

    it("does nothing for an uncached service", () => {
      handler.invalidateProxyCache("nonexistent-svc");

      // No log about invalidation (only logs when existed=true)
      expect(deps.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("invalidated"),
        expect.anything(),
      );
    });

    it("removes matching circuit breaker when invalidating a service", async () => {
      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());

      expect((handler as any).circuitBreakers.has("user-svc:test")).toBe(true);

      handler.invalidateProxyCache("user-svc");

      expect((handler as any).circuitBreakers.has("user-svc:test")).toBe(false);
    });
  });

  // =========================================================================
  // Registry subscription for auto-invalidation
  // =========================================================================
  describe("auto-invalidation via registry events", () => {
    it("subscribes to registry onCacheInvalidation on construction", () => {
      expect(deps.registry.onCacheInvalidation).toHaveBeenCalledTimes(1);
      expect(deps.registry.onCacheInvalidation).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it("calls invalidateProxyCache when registry fires re-registration", () => {
      // Capture the callback passed to onCacheInvalidation
      const callback = (deps.registry.onCacheInvalidation as jest.Mock).mock
        .calls[0][0];
      (handler as any).proxyCache.set("payment-svc", jest.fn());

      callback("payment-svc");

      expect((handler as any).proxyCache.has("payment-svc")).toBe(false);
    });
  });

  // =========================================================================
  // Circuit breaker gating
  // =========================================================================
  describe("circuit breaker", () => {
    beforeEach(() => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "user-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });
    });

    it("rejects with ServiceUnavailableError when circuit breaker is OPEN", async () => {
      // First, make a successful request so the breaker is created
      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());

      // Force the circuit breaker into OPEN state
      const breaker = (handler as any).circuitBreakers.get("user-svc:test");
      // Trip the breaker by recording enough failures
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure();
      }

      await expect(
        handler.proxyRequest("user-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow(ServiceUnavailableError);
    });

    it("allows requests through when circuit breaker is CLOSED", async () => {
      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());

      expect(mockProxyMiddleware).toHaveBeenCalledTimes(1);
    });

    it("creates a circuit breaker per service", async () => {
      (deps.registry.get as jest.Mock).mockImplementation((id: string) => ({
        serviceId: id,
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      }));
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );

      await handler.proxyRequest("svc-a", fakeReq(), fakeRes());
      await handler.proxyRequest("svc-b", fakeReq(), fakeRes());

      const breakers = (handler as any).circuitBreakers;
      expect(breakers.has("svc-a:test")).toBe(true);
      expect(breakers.has("svc-b:test")).toBe(true);
    });
  });

  // =========================================================================
  // Lifecycle gate â€” retired and deprecated services
  // =========================================================================
  describe("lifecycle gate", () => {
    it("throws GoneError (410) for retired service", async () => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "old-svc",
        serviceType: "tribe",
        status: "retired",
        replacementService: "new-svc",
      });

      await expect(
        handler.proxyRequest("old-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow(GoneError);
    });

    it("sets Deprecation and Sunset headers for deprecated service", async () => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "dep-svc",
        serviceType: "tribe",
        status: "deprecated",
        sunsetDate: "2025-12-31",
        replacementService: "new-svc",
        requiredScopes: [],
        consumes: [],
      });

      const res = fakeRes();
      await handler.proxyRequest("dep-svc", fakeReq(), res);

      expect(res.setHeader).toHaveBeenCalledWith("Deprecation", "true");
      expect(res.setHeader).toHaveBeenCalledWith(
        "Sunset",
        new Date("2025-12-31").toUTCString(),
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        "Link",
        expect.stringContaining("new-svc"),
      );
    });
  });

  // =========================================================================
  // Scope / access checks
  // =========================================================================
  describe("scope and access checks", () => {
    beforeEach(() => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "locked-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: ["admin"],
        consumes: [],
      });
    });

    it("throws NotFoundError when service is not in the registry", async () => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(null);
      (deps.registry.get as jest.Mock).mockReturnValue(null);

      await expect(
        handler.proxyRequest("ghost-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when tribe cannot consume target service", async () => {
      (deps.registry.canAccess as jest.Mock).mockReturnValue(false);

      await expect(
        handler.proxyRequest("locked-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws ForbiddenError when an emergency control blocks the target", async () => {
      (deps.emergencyControls.evaluate as jest.Mock).mockReturnValue({
        allowed: false,
        reason: "Incident containment",
        mode: "pause",
      });

      await expect(
        handler.proxyRequest("locked-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow("Emergency control active: Incident containment");
      expect(deps.registry.canAccess).not.toHaveBeenCalled();
    });

    it("allows owned microservice access through the tribe boundary", async () => {
      (deps.registry.canAccess as jest.Mock).mockImplementation(
        (sourceTribeId: string, targetServiceId: string) =>
          sourceTribeId === "logistics" &&
          targetServiceId === "logistics-orders",
      );

      await handler.proxyRequest(
        "logistics-orders",
        fakeReq({ tribeId: "logistics" }),
        fakeRes(),
      );

      expect(deps.registry.canAccess).toHaveBeenCalledWith(
        "logistics",
        "logistics-orders",
      );
      expect(mockProxyMiddleware).toHaveBeenCalled();
    });

    it("throws ForbiddenError when caller lacks required scopes", async () => {
      (deps.registry.getRequiredScopes as jest.Mock).mockReturnValue(["admin"]);
      (deps.auth.checkScopes as jest.Mock).mockReturnValue(["admin"]);

      await expect(
        handler.proxyRequest("locked-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("allows request when caller has all required scopes", async () => {
      (deps.registry.getRequiredScopes as jest.Mock).mockReturnValue(["read"]);
      (deps.auth.checkScopes as jest.Mock).mockReturnValue([]); // no missing scopes

      await handler.proxyRequest("locked-svc", fakeReq(), fakeRes());

      expect(mockProxyMiddleware).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Namespace validation
  // =========================================================================
  describe("namespace validation", () => {
    it("throws NotFoundError when service type does not match handler namespace", async () => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "email-svc",
        serviceType: "shared", // handler uses 'tribe' namespace
        status: "active",
        requiredScopes: [],
      });

      await expect(
        handler.proxyRequest("email-svc", fakeReq(), fakeRes()),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // =========================================================================
  // listServices()
  // =========================================================================
  describe("listServices()", () => {
    it("filters out retired services", () => {
      (deps.registry.getByType as jest.Mock).mockReturnValue([
        {
          serviceId: "active-svc",
          name: "Active",
          status: "active",
          version: "1.0",
          exposes: [],
          serviceType: "tribe",
        },
        {
          serviceId: "retired-svc",
          name: "Retired",
          status: "retired",
          version: "0.1",
          exposes: [],
          serviceType: "tribe",
        },
      ]);
      (deps.registry.canAccess as jest.Mock).mockReturnValue(true);

      const result = handler.listServices("svc-alpha");

      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe("active-svc");
    });

    it("includes deprecation info for deprecated services", () => {
      (deps.registry.getByType as jest.Mock).mockReturnValue([
        {
          serviceId: "dep-svc",
          name: "Deprecated",
          status: "deprecated",
          version: "1.0",
          exposes: [],
          serviceType: "tribe",
          sunsetDate: "2025-12-31",
          replacementService: "new-svc",
        },
      ]);
      (deps.registry.canAccess as jest.Mock).mockReturnValue(true);

      const result = handler.listServices("svc-alpha");

      expect(result[0].deprecated).toBe(true);
      expect(result[0].sunsetDate).toBe("2025-12-31");
      expect(result[0].replacementService).toBe("new-svc");
    });

    it("filters out non-consumable services for non-admin callers", () => {
      (deps.registry.getByType as jest.Mock).mockReturnValue([
        {
          serviceId: "visible-svc",
          name: "Visible",
          status: "active",
          exposes: [],
          requiredScopes: [],
          serviceType: "tribe",
        },
        {
          serviceId: "hidden-svc",
          name: "Hidden",
          status: "active",
          exposes: [],
          requiredScopes: [],
          serviceType: "tribe",
        },
      ]);
      (deps.registry.canAccess as jest.Mock).mockImplementation(
        (sourceServiceId: string, targetServiceId: string) =>
          sourceServiceId === "svc-alpha" && targetServiceId === "visible-svc",
      );

      const result = handler.listServices("svc-alpha");

      expect(result).toHaveLength(1);
      expect(result[0].serviceId).toBe("visible-svc");
      expect(result[0].canAccess).toBe(true);
    });

    it("allows admin discovery requests to include non-consumable services", () => {
      (deps.registry.getByType as jest.Mock).mockReturnValue([
        {
          serviceId: "visible-svc",
          name: "Visible",
          status: "active",
          exposes: [],
          requiredScopes: [],
          serviceType: "tribe",
        },
        {
          serviceId: "hidden-svc",
          name: "Hidden",
          status: "active",
          exposes: [],
          requiredScopes: [],
          serviceType: "tribe",
        },
      ]);
      (deps.registry.canAccess as jest.Mock).mockImplementation(
        (sourceServiceId: string, targetServiceId: string) =>
          sourceServiceId === "svc-alpha" && targetServiceId === "visible-svc",
      );

      const result = handler.listServices("svc-alpha", true);

      expect(result).toHaveLength(2);
      expect(
        result.find((svc) => svc.serviceId === "hidden-svc")?.canAccess,
      ).toBe(false);
    });
  });

  // =========================================================================
  // destroy()
  // =========================================================================
  describe("destroy()", () => {
    it("clears proxy cache and circuit breakers", async () => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "user-svc",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
      });

      await handler.proxyRequest("user-svc", fakeReq(), fakeRes());

      expect((handler as any).proxyCache.size).toBe(1);
      expect((handler as any).circuitBreakers.size).toBe(1);

      handler.destroy();

      expect((handler as any).proxyCache.size).toBe(0);
      expect((handler as any).circuitBreakers.size).toBe(0);
    });
  });

  describe("bounded cache eviction", () => {
    it("evicts the oldest cached proxy when cache size limit is reached", async () => {
      const boundedHandler = new ProxyHandler(deps, {
        ...defaultOpts,
        maxProxyCacheSize: 1,
      });

      (deps.registry.get as jest.Mock).mockImplementation(
        (serviceId: string) => ({
          serviceId,
          serviceType: "tribe",
          status: "active",
          requiredScopes: [],
          consumes: [],
        }),
      );
      (deps.registry.resolveUpstream as jest.Mock).mockImplementation(
        (serviceId: string) => `http://${serviceId}.local`,
      );

      await boundedHandler.proxyRequest("svc-a", fakeReq(), fakeRes());
      await boundedHandler.proxyRequest("svc-b", fakeReq(), fakeRes());

      expect((boundedHandler as any).proxyCache.has("svc-a:test")).toBe(false);
      expect((boundedHandler as any).proxyCache.has("svc-b:test")).toBe(true);
      expect((boundedHandler as any).circuitBreakers.has("svc-a")).toBe(false);
      expect(deps.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Proxy cache size limit reached"),
        "ProxyHandler",
      );

      boundedHandler.destroy();
    });
  });

  describe("normalized service-call observation recording", () => {
    beforeEach(() => {
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "orders-api",
        serviceType: "tribe",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });
    });

    it("records normalized tribe-to-tribe service-call observations", async () => {
      const req = fakeReq({
        tribeId: "campusone",
        correlationId: "corr-tribe-call",
        method: "GET",
        originalUrl: "/api/v1/tribes/orders-api/orders",
        user: { environment: "test" } as any,
        headers: {
          "x-request-id": "req-tribe-call",
        },
      });
      const res = fakeResWithFinish(200);

      await handler.proxyRequest("orders-api", req, res);
      res.finishHandlers.forEach((handler: () => void) => handler());

      const expectedObservation = expect.objectContaining({
        correlation_id: "corr-tribe-call",
        request_id: "req-tribe-call",
        environment: "test",
        caller_type: "tribe",
        caller_id: "campusone",
        source_service_id: "campusone",
        target_type: "api_service",
        target_service_id: "orders-api",
        route_family: "tribe:orders-api",
        http_method: "GET",
        status_code: 200,
        outcome: "success",
        latency_ms: expect.any(Number),
        rollup_key:
          "campusone:test:orders-api:tribe:orders-api",
      });

      expect(deps.gatewayTraffic?.recordProxyRequest).toHaveBeenCalledWith(
        expect.objectContaining({ observation: expectedObservation }),
      );
      expect(deps.auditEvents?.record).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            observation: expectedObservation,
          }),
        }),
      );
    });
  });

  describe("shared-service runtime usage recording", () => {
    beforeEach(() => {
      (deps as any).sharedServiceRouting = {
        resolve: jest.fn((sharedServiceId: string, environment: string) => ({
          sharedServiceId,
          environment,
          targetUrl: `http://${sharedServiceId}-${environment}:4010`,
        })),
      };
      handler = new ProxyHandler(deps, {
        namespace: "shared",
        pathPrefix: "/api/v1/shared",
      });
      (deps.registry.resolveUpstream as jest.Mock).mockReturnValue(
        "http://localhost:3001",
      );
      (deps.registry.get as jest.Mock).mockReturnValue({
        serviceId: "paymongo",
        serviceType: "shared",
        status: "active",
        requiredScopes: [],
        consumes: [],
      });
    });


    it("routes shared-service requests through environment-scoped route settings", async () => {
      await handler.proxyRequest("paymongo", fakeReq(), fakeRes());
      await handler.proxyRequest(
        "paymongo",
        fakeReq({ user: { environment: "live" } as any }),
        fakeRes(),
      );

      expect((deps as any).sharedServiceRouting.resolve).toHaveBeenCalledWith(
        "paymongo",
        "test",
      );
      expect((deps as any).sharedServiceRouting.resolve).toHaveBeenCalledWith(
        "paymongo",
        "live",
      );
      expect(mockCreateProxyMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ target: "http://paymongo-test:4010" }),
      );
      expect(mockCreateProxyMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ target: "http://paymongo-live:4010" }),
      );
    });

    it("forwards authoritative APICenter identity headers to shared services", async () => {
      await handler.proxyRequest(
        "paymongo",
        fakeReq({
          tribeId: "campusone",
          sourceServiceId: "campusone-api",
          correlationId: "corr-shared-headers",
        }),
        fakeRes(),
      );

      const proxyOptions = (mockCreateProxyMiddleware.mock.calls as any[])[0]?.[0];
      expect(proxyOptions).toBeDefined();
      const proxyReq = { setHeader: jest.fn(), write: jest.fn() };
      proxyOptions.on.proxyReq(proxyReq, fakeReq({
        tribeId: "campusone",
        sourceServiceId: "campusone-api",
        correlationId: "corr-shared-headers",
      }));

      expect(proxyReq.setHeader).toHaveBeenCalledWith(
        "X-APICenter-Environment",
        "test",
      );
      expect(proxyReq.setHeader).toHaveBeenCalledWith(
        "X-APICenter-Source-Service-Id",
        "campusone-api",
      );
      expect(proxyReq.setHeader).toHaveBeenCalledWith("X-Tribe-Id", "campusone");
      expect(proxyReq.setHeader).toHaveBeenCalledWith(
        "X-APICenter-Correlation-Id",
        "corr-shared-headers",
      );
    });
    it("records successful shared-service proxy usage", async () => {
      const req = fakeReq({
        tribeId: "campusone",
        method: "POST",
        originalUrl: "/api/v1/shared/paymongo/payments",
      });
      const res = fakeResWithFinish(200);

      await handler.proxyRequest("paymongo", req, res);
      res.finishHandlers.forEach((handler: () => void) => handler());

      expect(deps.sharedServiceUsage?.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tribeServiceId: "campusone",
          sharedServiceId: "paymongo",
          route: "/api/v1/shared/paymongo/payments",
          method: "POST",
          status: 200,
          ok: true,
        }),
      );
      expect(deps.gatewayTraffic?.recordProxyRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: "shared",
          sourceTribe: "campusone",
          targetService: "paymongo",
          statusCode: 200,
        }),
      );
      expect(deps.auditEvents?.record).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "shared_service.call",
          tribeServiceId: "campusone",
          sharedServiceId: "paymongo",
        }),
      );
    });

    it("publishes sanitized shared-service export events", async () => {
      const req = fakeReq({
        tribeId: "campusone",
        method: "POST",
        originalUrl: "/api/v1/shared/sms/send",
        body: {
          to: "+639171234567",
          message: "Your OTP is 123456",
        },
      });
      const res = fakeResWithFinish(201);

      await handler.proxyRequest("sms", req, res);
      res.finishHandlers.forEach((handler: () => void) => handler());

      expect(
        deps.sharedServiceEvents?.publishSharedServiceCall,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          tribeId: "campusone",
          sharedServiceId: "sms",
          route: "/api/v1/shared/sms/send",
          method: "POST",
          statusCode: 201,
          ok: true,
          requestBody: {
            to: "+639171234567",
            message: "Your OTP is 123456",
          },
        }),
      );
    });

    it("passes upstream JSON response bodies to shared-service export events", async () => {
      setCreateProxyMiddlewareForTesting(
        jest.fn(
          () =>
            jest.fn((_req: any, res: any) => {
              res.write(
                JSON.stringify({
                  success: true,
                  data: {
                    subscriptionId: "sub_proxy_123",
                    status: "active",
                    provider: "paymongo",
                    providerMode: "test",
                  },
                }),
              );
              res.end();
            }) as any,
        ) as any,
      );

      const req = fakeReq({
        tribeId: "campusone",
        method: "POST",
        originalUrl: "/api/v1/shared/payment/subscriptions",
        body: {
          subscriptionId: "sub_proxy_123",
          idempotencyKey: "subscription-secret",
        },
      });
      const res = fakeResWithFinish(201);

      await handler.proxyRequest("payment", req, res);
      res.finishHandlers.forEach((handler: () => void) => handler());

      expect(
        deps.sharedServiceEvents?.publishSharedServiceCall,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          sharedServiceId: "payment",
          responseBody: {
            success: true,
            data: {
              subscriptionId: "sub_proxy_123",
              status: "active",
              provider: "paymongo",
              providerMode: "test",
            },
          },
        }),
      );
    });

    it("records failed shared-service proxy usage", async () => {
      const req = fakeReq({ tribeId: "campusone" });
      const res = fakeResWithFinish(502);

      await handler.proxyRequest("paymongo", req, res);
      res.finishHandlers.forEach((handler: () => void) => handler());

      expect(deps.sharedServiceUsage?.record).toHaveBeenCalledWith(
        expect.objectContaining({
          tribeServiceId: "campusone",
          sharedServiceId: "paymongo",
          status: 502,
          ok: false,
          observation: expect.objectContaining({
            correlation_id: "corr-1",
            request_id: "corr-1",
            environment: "test",
            caller_type: "tribe",
            caller_id: "campusone",
            source_service_id: "campusone",
            target_type: "shared_service",
            shared_service_id: "paymongo",
            route_family: "shared:paymongo",
            http_method: "GET",
            status_code: 502,
            outcome: "server_error",
            latency_ms: expect.any(Number),
            rollup_key:
              "campusone:test:paymongo:shared:paymongo",
          }),
        }),
      );
    });
  });
});
