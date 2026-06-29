import { ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { MetricsService } from "../../../../src/metrics/metrics.service";
import { MetricsInterceptor } from "../../../../src/metrics/metrics.interceptor";

function createContext(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe("MetricsInterceptor", () => {
  const mockMetrics = {
    recordHttpRequest: jest.fn(),
  } as unknown as MetricsService;

  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new MetricsInterceptor(mockMetrics);
  });

  it("should record request metrics using normalized route path on success", async () => {
    const request = {
      method: "GET",
      route: { path: "/api/v1/tribes/:targetServiceId/*" },
      path: "/api/v1/tribes/billing-service/invoices",
    };
    const response = {
      statusCode: 200,
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of({ ok: true }),
      }),
    );

    expect(mockMetrics.recordHttpRequest).toHaveBeenCalledWith(
      "GET",
      "/api/v1/tribes/:targetServiceId/*",
      200,
      expect.any(Number),
    );
  });

  it("should record error metrics with fallback status code when response status is missing", async () => {
    const request = {
      method: "POST",
      path: "/api/v1/external/kafka/publish",
    };
    const response = {
      statusCode: undefined,
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(createContext(request, response), {
          handle: () => throwError(() => new Error("request-failed")),
        }),
      ),
    ).rejects.toThrow("request-failed");

    expect(mockMetrics.recordHttpRequest).toHaveBeenCalledWith(
      "POST",
      "/api/v1/external/kafka/publish",
      500,
      expect.any(Number),
    );
  });
});
