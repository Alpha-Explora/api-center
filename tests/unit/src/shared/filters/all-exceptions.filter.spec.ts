import { ArgumentsHost, HttpException, HttpStatus } from "@nestjs/common";
import { AllExceptionsFilter } from "../../../../../apps/gateway/src/shared/filters/all-exceptions.filter";
import { LoggerService } from "../../../../../apps/gateway/src/shared/logger.service";
import { ConfigService } from "../../../../../apps/gateway/src/config/config.service";
import { UnauthorizedError } from "../../../../../apps/gateway/src/shared/errors";

function createHost(
  request: Record<string, unknown>,
  response: Record<string, unknown>,
): ArgumentsHost {
  response.locals = {};
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
      new HttpException(
        { message: "Quota used up", code: "QUOTA_EXCEEDED", detail: { retryAfterSeconds: 60, budget: "plan:env_l" } },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      createHost(request, response),
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.TOO_MANY_REQUESTS);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "QUOTA_EXCEEDED",
          message: "Quota used up",
          detail: expect.objectContaining({ retryAfterSeconds: 60 }),
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

describe("AllExceptionsFilter database failures", () => {
  const logger = { warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;
  const filter = new AllExceptionsFilter(logger, { isProduction: true } as ConfigService);

  function prismaError(code: string, message = "database error") {
    return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });
  }

  function send(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const setHeader = jest.fn();
    filter.catch(exception, createHost({ correlationId: "corr-db" }, { status, setHeader }));
    return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0], setHeader };
  }

  it("answers 503 with Retry-After when no transaction slot frees up in time", () => {
    const { status, body, setHeader } = send(prismaError("P2028", "Transaction API error: Unable to start a transaction in the given time."));
    expect(status).toBe(503);
    expect(body.error).toEqual({ code: "DATABASE_BUSY", message: "APICenter is busy. Retry shortly." });
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "2");
  });

  it("answers 503 when the database cannot be reached", () => {
    expect(send(prismaError("P1001")).status).toBe(503);
    expect(send(Object.assign(new Error("Can't reach database"), { name: "PrismaClientInitializationError" })).body.error.code).toBe("DATABASE_UNAVAILABLE");
  });

  it("answers 409 for a duplicate and 404 for a vanished record", () => {
    expect(send(prismaError("P2002"))).toMatchObject({ status: 409, body: { error: { code: "CONFLICT" } } });
    expect(send(prismaError("P2025"))).toMatchObject({ status: 404, body: { error: { code: "NOT_FOUND" } } });
  });

  it("still answers 500 for other errors, including unrelated ones that carry a code", () => {
    expect(send(prismaError("P2010")).status).toBe(500);
    expect(send(Object.assign(new Error("boom"), { code: "P2028" })).status).toBe(500);
  });
});

describe("AllExceptionsFilter codes for Nest's own exceptions", () => {
  const logger = { warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;
  const filter = new AllExceptionsFilter(logger, { isProduction: true } as ConfigService);

  function codeOf(exception: unknown) {
    const json = jest.fn();
    filter.catch(exception, createHost({}, { status: jest.fn().mockReturnValue({ json }), setHeader: jest.fn() }));
    return json.mock.calls[0][0].error.code;
  }

  it("uses an UPPER_SNAKE_CASE code instead of the reason phrase", () => {
    expect(codeOf(new HttpException({ statusCode: 404, message: "Cannot GET /x", error: "Not Found" }, 404))).toBe("NOT_FOUND");
    expect(codeOf(new HttpException({ statusCode: 400, message: ["a must be a string"], error: "Bad Request" }, 400))).toBe("VALIDATION_ERROR");
    expect(codeOf(new HttpException("ThrottlerException: Too Many Requests", 429))).toBe("RATE_LIMITED");
    expect(codeOf(new HttpException("I'm a teapot", 418))).toBe("HTTP_418");
  });

  it("keeps a code the exception names itself", () => {
    expect(codeOf(new HttpException({ message: "Quota used up", code: "QUOTA_EXCEEDED" }, 429))).toBe("QUOTA_EXCEEDED");
  });
});
