import { ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { LoggerService } from "../../../../../apps/gateway/src/shared/logger.service";
import { AuditLogInterceptor } from "../../../../../apps/gateway/src/shared/interceptors/audit-log.interceptor";

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

describe("AuditLogInterceptor", () => {
  const mockLogger = { info: jest.fn() } as unknown as LoggerService;

  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new AuditLogInterceptor(mockLogger);
  });

  it("logs a successful call with its application", async () => {
    const request = {
      method: "GET",
      originalUrl: "/api/v1/shared/email/status/msg_1",
      ip: "127.0.0.1",
      correlationId: "corr-1",
      caller: { applicationId: "app_1", environmentKind: "test" },
    };
    const response = {
      statusCode: 200,
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of({ success: true }),
      }),
    );

    expect(mockLogger.info).toHaveBeenCalledWith(
      "Audit log",
      expect.objectContaining({
        method: "GET",
        path: "/api/v1/shared/email/status/msg_1",
        statusCode: 200,
        correlationId: "corr-1",
        applicationId: "app_1",
        environment: "test",
      }),
    );
  });

  it("should still emit audit log when handler throws an error", async () => {
    const request = {
      method: "POST",
      originalUrl: "/api/v1/shared/geo/reverse-geocode",
      ip: "127.0.0.1",
      correlationId: "corr-2",
    };
    const response = {
      statusCode: 502,
    };

    await expect(
      lastValueFrom(
        interceptor.intercept(createContext(request, response), {
          handle: () => throwError(() => new Error("proxy-failed")),
        }),
      ),
    ).rejects.toThrow("proxy-failed");

    expect(mockLogger.info).toHaveBeenCalled();
  });

  it("should skip audit events for health checks", async () => {
    const request = {
      method: "GET",
      originalUrl: "/api/v1/health/ready",
      ip: "127.0.0.1",
      correlationId: "corr-3",
    };
    const response = {
      statusCode: 200,
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of({ success: true }),
      }),
    );

    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
