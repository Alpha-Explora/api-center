import { createUpstreamProxyOptions } from "../../../../../apps/gateway/src/shared/proxy/upstream-request";
import type { LoggerService } from "../../../../../apps/gateway/src/shared/logger.service";

jest.mock("../../../../../apps/gateway/src/shared/proxy/cloud-run-auth", () => ({
  getCloudRunAuthorizationHeader: jest.fn(async (upstream: string) =>
    upstream.includes(".run.app") ? "Bearer cloud-run-token" : undefined,
  ),
}));

function logger(): LoggerService {
  return {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;
}

describe("createUpstreamProxyOptions", () => {
  it("sets gateway headers and re-streams parsed JSON request bodies", async () => {
    const options = await createUpstreamProxyOptions({
      targetServiceId: "orders",
      targetEnvironment: "test",
      upstream: "https://orders.test",
      namespace: "tribe",
      pathPrefix: "/api/v1/tribes",
      proxyTimeoutMs: 30_000,
      correlationId: "corr-1",
      circuitBreakers: new Map(),
      logger: logger(),
    });
    const proxyReq = {
      setHeader: jest.fn(),
      write: jest.fn(),
    };

    options.on?.proxyReq?.(
      proxyReq as any,
      {
        tribeId: "orders-tribe",
        correlationId: "corr-1",
        body: { orderId: "ord-1" },
      } as any,
      {} as any,
      {} as any,
    );

    expect(proxyReq.setHeader).toHaveBeenCalledWith(
      "X-Tribe-Id",
      "orders-tribe",
    );
    expect(proxyReq.setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      "corr-1",
    );
    expect(proxyReq.setHeader).toHaveBeenCalledWith(
      "X-Forwarded-By",
      "apicenter-gateway",
    );
    expect(proxyReq.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/json",
    );
    expect(proxyReq.setHeader).toHaveBeenCalledWith("Content-Length", 19);
    expect(proxyReq.write).toHaveBeenCalledWith('{"orderId":"ord-1"}');
  });

  it("adds Cloud Run IAM Authorization when the upstream requires it", async () => {
    const options = await createUpstreamProxyOptions({
      targetServiceId: "payment",
      targetEnvironment: "live",
      upstream: "https://payment-live-abc.a.run.app",
      namespace: "shared",
      pathPrefix: "/api/v1/shared",
      proxyTimeoutMs: 30_000,
      circuitBreakers: new Map(),
      logger: logger(),
    });
    const proxyReq = {
      setHeader: jest.fn(),
      write: jest.fn(),
    };

    options.on?.proxyReq?.(
      proxyReq as any,
      {
        tribeId: "orders-tribe",
        correlationId: "corr-1",
        body: {},
        user: { environment: "live" },
      } as any,
      {} as any,
      {} as any,
    );

    expect(proxyReq.setHeader).toHaveBeenCalledWith(
      "X-Serverless-Authorization",
      "Bearer cloud-run-token",
    );
    expect(proxyReq.setHeader).toHaveBeenCalledWith(
      "Authorization",
      "Bearer cloud-run-token",
    );
  });

  it("records circuit-breaker success and failure from upstream responses", async () => {
    const breaker = {
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };
    const log = logger();
    const options = await createUpstreamProxyOptions({
      targetServiceId: "orders",
      targetEnvironment: "test",
      upstream: "https://orders.test",
      namespace: "tribe",
      pathPrefix: "/api/v1/tribes",
      proxyTimeoutMs: 30_000,
      circuitBreakers: new Map([["orders:test", breaker as any]]),
      logger: log,
    });

    options.on?.proxyRes?.({ statusCode: 200 } as any, {} as any, {} as any);
    options.on?.proxyRes?.({ statusCode: 503 } as any, {} as any, {} as any);
    options.on?.error?.(new Error("ECONNREFUSED"), {} as any, {} as any);

    expect(breaker.recordSuccess).toHaveBeenCalledTimes(1);
    expect(breaker.recordFailure).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("returned 503"),
      "ProxyHandler",
    );
    expect(log.error).toHaveBeenCalledWith(
      "Proxy error for orders: ECONNREFUSED",
    );
  });
});
