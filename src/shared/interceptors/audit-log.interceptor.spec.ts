import { ExecutionContext } from "@nestjs/common";
import { lastValueFrom, of, throwError } from "rxjs";
import { KafkaService } from "../../kafka/kafka.service";
import { TOPICS } from "../../kafka/topics";
import { AuditLogInterceptor } from "./audit-log.interceptor";

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
  const mockKafka = {
    publish: jest.fn(),
    publishNonBlocking: jest.fn(),
  } as unknown as KafkaService;

  let interceptor: AuditLogInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    interceptor = new AuditLogInterceptor(mockKafka);
  });

  it("should publish audit event on successful response with tribe route target", async () => {
    const request = {
      method: "GET",
      originalUrl: "/api/v1/tribes/billing-service/invoices",
      ip: "127.0.0.1",
      tribeId: "caller-service",
      correlationId: "corr-1",
    };
    const response = {
      statusCode: 200,
    };

    await lastValueFrom(
      interceptor.intercept(createContext(request, response), {
        handle: () => of({ success: true }),
      }),
    );

    expect(mockKafka.publishNonBlocking).toHaveBeenCalledWith(
      TOPICS.AUDIT_LOG,
      expect.objectContaining({
        tribeId: "caller-service",
        method: "GET",
        path: "/api/v1/tribes/billing-service/invoices",
        statusCode: 200,
        targetServiceId: "billing-service",
        correlationId: "corr-1",
      }),
      expect.objectContaining({ key: "caller-service" }),
    );
  });

  it("should still emit audit log when handler throws an error", async () => {
    const request = {
      method: "POST",
      originalUrl: "/api/v1/external/geolocation/reverse",
      ip: "127.0.0.1",
      tribeId: "caller-service",
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

    expect(mockKafka.publishNonBlocking).toHaveBeenCalled();
  });

  it("should skip audit events for health checks", async () => {
    const request = {
      method: "GET",
      originalUrl: "/api/v1/health/ready",
      ip: "127.0.0.1",
      tribeId: "health-check",
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

    expect(mockKafka.publishNonBlocking).not.toHaveBeenCalled();
  });
});
