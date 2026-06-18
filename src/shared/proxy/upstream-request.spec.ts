import { createUpstreamProxyOptions } from "./upstream-request";
import type { LoggerService } from "../logger.service";

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
  it("sets gateway headers and re-streams parsed JSON request bodies", () => {
    const options = createUpstreamProxyOptions({
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

    options.on?.proxyReq?.(proxyReq as any, {
      tribeId: "orders-tribe",
      correlationId: "corr-1",
      body: { orderId: "ord-1" },
    } as any, {} as any, {} as any);

    expect(proxyReq.setHeader).toHaveBeenCalledWith("X-Tribe-Id", "orders-tribe");
    expect(proxyReq.setHeader).toHaveBeenCalledWith("X-Correlation-ID", "corr-1");
    expect(proxyReq.setHeader).toHaveBeenCalledWith("X-Forwarded-By", "apicenter-gateway");
    expect(proxyReq.setHeader).toHaveBeenCalledWith("Content-Type", "application/json");
    expect(proxyReq.setHeader).toHaveBeenCalledWith("Content-Length", 19);
    expect(proxyReq.write).toHaveBeenCalledWith('{"orderId":"ord-1"}');
  });

  it("records circuit-breaker success and failure from upstream responses", () => {
    const breaker = {
      recordFailure: jest.fn(),
      recordSuccess: jest.fn(),
    };
    const log = logger();
    const options = createUpstreamProxyOptions({
      targetServiceId: "orders",
      targetEnvironment: "test",
      upstream: "https://orders.test",
      namespace: "tribe",
      pathPrefix: "/api/v1/tribes",
      proxyTimeoutMs: 30_000,
      circuitBreakers: new Map([["orders", breaker as any]]),
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
    expect(log.error).toHaveBeenCalledWith("Proxy error for orders: ECONNREFUSED");
  });
});
