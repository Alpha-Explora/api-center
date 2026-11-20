import { EventEmitter } from "node:events";
import { ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { LoggerService } from "../../../../../apps/gateway/src/shared/logger.service";
import { AuditLogInterceptor } from "../../../../../apps/gateway/src/shared/interceptors/audit-log.interceptor";

function fakeResponse() {
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false });
  return {
    response,
    finish(statusCode: number) {
      response.statusCode = statusCode;
      response.writableFinished = true;
      response.emit("finish");
      response.emit("close");
    },
  };
}

function createContext(request: Record<string, unknown>, response: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe("AuditLogInterceptor", () => {
  const mockLogger = { info: jest.fn() } as unknown as LoggerService;
  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new AuditLogInterceptor(mockLogger);
  });

  it("logs a successful call with its application once the response finishes", async () => {
    const request = {
      method: "GET",
      originalUrl: "/api/v1/shared/email/status/msg_1",
      ip: "127.0.0.1",
      correlationId: "corr-1",
      caller: { applicationId: "app_1", environmentKind: "test" },
    };
    const { response, finish } = fakeResponse();

    await lastValueFrom(interceptor.intercept(createContext(request, response), { handle: () => of({ success: true }) }));
    expect(mockLogger.info).not.toHaveBeenCalled();
    finish(200);

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
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

  it("logs the status the exception filter sent, not Express's default 200", async () => {
    const request = { method: "POST", originalUrl: "/api/v1/shared/geo/reverse-geocode", ip: "127.0.0.1", correlationId: "corr-2" };
    const { response, finish } = fakeResponse();

    await expect(
      lastValueFrom(interceptor.intercept(createContext(request, response), { handle: () => throwError(() => new Error("proxy-failed")) })),
    ).rejects.toThrow("proxy-failed");
    finish(500);

    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith("Audit log", expect.objectContaining({ statusCode: 500 }));
  });

  it("logs 499 when the client disconnects before the response finishes", async () => {
    const request = { method: "GET", originalUrl: "/api/v1/whoami", ip: "127.0.0.1" };
    const { response } = fakeResponse();

    await lastValueFrom(interceptor.intercept(createContext(request, response), { handle: () => of({}) }));
    response.emit("close");

    expect(mockLogger.info).toHaveBeenCalledWith("Audit log", expect.objectContaining({ statusCode: 499 }));
  });

  it("skips audit events for health checks", async () => {
    const request = { method: "GET", originalUrl: "/api/v1/health/ready", ip: "127.0.0.1", correlationId: "corr-3" };
    const { response, finish } = fakeResponse();

    await lastValueFrom(interceptor.intercept(createContext(request, response), { handle: () => of({ success: true }) }));
    finish(200);

    expect(mockLogger.info).not.toHaveBeenCalled();
  });
});
