import { EventEmitter } from "node:events";
import { ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { MetricsService } from "../../../../apps/gateway/src/metrics/metrics.service";
import { MetricsInterceptor } from "../../../../apps/gateway/src/metrics/metrics.interceptor";

function fakeResponse() {
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false });
  return {
    response,
    finish(statusCode: number) {
      response.statusCode = statusCode;
      response.writableFinished = true;
      response.emit("finish");
    },
  };
}

function createContext(request: Record<string, unknown>, response: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe("MetricsInterceptor", () => {
  const mockMetrics = { recordHttpRequest: jest.fn() } as unknown as MetricsService;
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new MetricsInterceptor(mockMetrics);
  });

  it("records the normalized route and final status on success", async () => {
    const request = { method: "GET", route: { path: "/api/v1/shared/:capability/*" }, path: "/api/v1/shared/email/status/m1" };
    const { response, finish } = fakeResponse();

    await lastValueFrom(interceptor.intercept(createContext(request, response), { handle: () => of({ ok: true }) }));
    finish(200);

    expect(mockMetrics.recordHttpRequest).toHaveBeenCalledWith("GET", "/api/v1/shared/:capability/*", 200, expect.any(Number));
  });

  it("records the status the exception filter sent for a failed handler", async () => {
    const request = { method: "POST", path: "/api/v1/shared/geo/reverse-geocode" };
    const { response, finish } = fakeResponse();

    await expect(
      lastValueFrom(interceptor.intercept(createContext(request, response), { handle: () => throwError(() => new Error("request-failed")) })),
    ).rejects.toThrow("request-failed");
    finish(503);

    expect(mockMetrics.recordHttpRequest).toHaveBeenCalledTimes(1);
    expect(mockMetrics.recordHttpRequest).toHaveBeenCalledWith("POST", "/api/v1/shared/geo/reverse-geocode", 503, expect.any(Number));
  });
});
