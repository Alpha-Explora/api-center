import { ExecutionContext } from "@nestjs/common";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { ConfigService } from "../../config/config.service";
import { LoggerService } from "../../shared/logger.service";
import { UnauthorizedError } from "../../shared/errors";

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("PlatformAdminGuard", () => {
  const mockLogger = {
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as LoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should reject when platform admin secret is not configured", () => {
    const guard = new PlatformAdminGuard(
      { platformAdminSecret: "" } as ConfigService,
      mockLogger,
    );
    const request = {
      headers: { "x-platform-secret": "anything" },
      ip: "127.0.0.1",
      path: "/api/v1/registry/services",
    };

    expect(() => guard.canActivate(createContext(request))).toThrow(
      UnauthorizedError,
    );
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("should reject when secret header is missing or invalid", () => {
    const guard = new PlatformAdminGuard(
      { platformAdminSecret: "correct-secret" } as ConfigService,
      mockLogger,
    );
    const request = {
      headers: { "x-platform-secret": "wrong-secret" },
      ip: "127.0.0.1",
      path: "/api/v1/registry/services",
    };

    expect(() => guard.canActivate(createContext(request))).toThrow(
      UnauthorizedError,
    );
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("should allow when secret header matches configured admin secret", () => {
    const guard = new PlatformAdminGuard(
      { platformAdminSecret: "correct-secret" } as ConfigService,
      mockLogger,
    );
    const request = {
      headers: { "x-platform-secret": "correct-secret" },
      ip: "127.0.0.1",
      path: "/api/v1/registry/services",
    };

    expect(guard.canActivate(createContext(request))).toBe(true);
  });
});
