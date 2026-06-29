import { ExecutionContext } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";
import { trace } from "@opentelemetry/api";
import { CorrelationIdInterceptor } from "../../../../../src/shared/interceptors/correlation-id.interceptor";

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

describe("CorrelationIdInterceptor", () => {
  let interceptor: CorrelationIdInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new CorrelationIdInterceptor();
  });

  it("should reuse incoming correlation header and expose it downstream", async () => {
    const setHeader = jest.fn();
    const request: Record<string, unknown> = {
      headers: { "x-correlation-id": "corr-header-id" },
      path: "/api/v1/tribes/service-a/users",
    };
    const response = { setHeader };
    const span = {
      setAttribute: jest.fn(),
    };
    jest.spyOn(trace, "getActiveSpan").mockReturnValue(span as any);

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of("ok"),
      }),
    );

    expect(request.correlationId).toBe("corr-header-id");
    expect(setHeader).toHaveBeenCalledWith(
      "X-Correlation-ID",
      "corr-header-id",
    );
    expect(span.setAttribute).toHaveBeenCalledWith(
      "correlation.id",
      "corr-header-id",
    );
  });
});
