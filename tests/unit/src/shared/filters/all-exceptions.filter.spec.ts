import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { AllExceptionsFilter } from "../../../../../apps/gateway/src/shared/filters/all-exceptions.filter";
import { LoggerService } from "../../../../../apps/gateway/src/shared/logger.service";
import { ConfigService } from "../../../../../apps/gateway/src/config/config.service";
import { QuotaExceededError, UnauthorizedError } from "../../../../../apps/gateway/src/shared/errors";

function createHost(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
}

describe("AllExceptionsFilter", () => {
  const mockLogger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should map AppError responses with domain code and correlation id", () => {
    const filter = new AllExceptionsFilter(mockLogger, {
      isProduction: false,
    } as ConfigService);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { correlationId: "corr-1" };

    filter.catch(
      new UnauthorizedError("Token required"),
      createHost(request, response),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: "UNAUTHORIZED",
          message: "Token required",
        }),
        meta: expect.objectContaining({ correlationId: "corr-1" }),
      }),
    );
  });

  it("should map validation-style HttpException arrays into standard details payload", () => {
    const filter = new AllExceptionsFilter(mockLogger, {
      isProduction: false,
    } as ConfigService);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { correlationId: "corr-2" };
    const exception = new HttpException(
      {
        message: ["field a required", "field b invalid"],
        error: "Bad Request",
      },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, createHost(request, response));

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "Validation failed",
          details: ["field a required", "field b invalid"],
        }),
      }),
    );
  });

  it("should preserve quota error code and retry metadata", () => {
    const filter = new AllExceptionsFilter(mockLogger, {
      isProduction: false,
    } as ConfigService);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { correlationId: "corr-quota" };

    filter.catch(
      new QuotaExceededError("Tribe API quota exceeded", {
        ownerTribeId: "campus-one",
        retryAfterSeconds: 60,
        quota: {
          scope: "shared",
          targetServiceId: "payment-service",
          maxRequests: 100,
          windowSeconds: 60,
        },
      }),
      createHost(request, response),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "TRIBE_API_QUOTA_EXCEEDED",
          message: "Tribe API quota exceeded",
          detail: expect.objectContaining({
            ownerTribeId: "campus-one",
            retryAfterSeconds: 60,
          }),
        }),
      }),
    );
  });

  it("should hide internal error details in production mode", () => {
    const filter = new AllExceptionsFilter(mockLogger, {
      isProduction: true,
    } as ConfigService);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { correlationId: "corr-3" };

    filter.catch(
      new Error("sensitive-stack-detail"),
      createHost(request, response),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "An unexpected error occurred",
        }),
      }),
    );
  });

  it("should include stack details in non-production mode", () => {
    const filter = new AllExceptionsFilter(mockLogger, {
      isProduction: false,
    } as ConfigService);
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const response = { status };
    const request = { correlationId: "corr-4" };
    const error = new Error("debug-visible-message");

    filter.catch(error, createHost(request, response));

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: "debug-visible-message",
          stack: expect.any(String),
        }),
      }),
    );
  });
});
