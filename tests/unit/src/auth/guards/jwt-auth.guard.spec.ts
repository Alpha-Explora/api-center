import { ExecutionContext } from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../apps/gateway/src/domains/auth-security/auth/guards/jwt-auth.guard";
import { AuthService } from "../../../../../apps/gateway/src/domains/auth-security/auth/auth.service";
import { LoggerService } from "../../../../../apps/gateway/src/shared/logger.service";
import { UnauthorizedError } from "../../../../../apps/gateway/src/shared/errors";

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("JwtAuthGuard", () => {
  const mockAuth = {
    validateToken: jest.fn(),
  } as unknown as AuthService;

  const mockLogger = {
    warn: jest.fn(),
  } as unknown as LoggerService;

  let guard: JwtAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new JwtAuthGuard(mockAuth, mockLogger);
  });

  it("should reject requests without an authorization token", async () => {
    const request = { headers: {}, ip: "127.0.0.1", path: "/api/v1/tribes" };

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("should attach the calling service, its project, and its tribe when token is valid", async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer valid-token" },
      ip: "127.0.0.1",
      path: "/api/v1/tribes",
    };
    (mockAuth.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha-worker",
      tribeId: "alpha",
      projectId: "alpha-core",
      sourceServiceId: "svc-alpha-worker",
      scopes: ["scope:read"],
      permissions: [],
    });

    const allowed = await guard.canActivate(createContext(request));

    expect(allowed).toBe(true);
    expect(request.user).toEqual(expect.objectContaining({ sub: "svc-alpha-worker" }));
    expect(request.tribeId).toBe("alpha");
    expect(request.projectId).toBe("alpha-core");
    expect(request.sourceServiceId).toBe("svc-alpha-worker");
  });


  it("uses sub as the calling service and never invents a tribe from it", async () => {
    const request: Record<string, unknown> = {
      headers: { authorization: "Bearer valid-token" },
      ip: "127.0.0.1",
      path: "/api/v1/tribes",
    };
    (mockAuth.validateToken as jest.Mock).mockResolvedValue({
      sub: "svc-alpha",
      scopes: [],
      permissions: [],
    });

    await guard.canActivate(createContext(request));

    expect(request.tribeId).toBeUndefined();
    expect(request.projectId).toBeUndefined();
    expect(request.sourceServiceId).toBe("svc-alpha");
  });
  it("should reject invalid tokens and emit guard warning", async () => {
    const request = {
      headers: { authorization: "Bearer invalid-token" },
      ip: "127.0.0.1",
      path: "/api/v1/tribes",
    };
    (mockAuth.validateToken as jest.Mock).mockRejectedValue(
      new Error("invalid-token"),
    );

    await expect(guard.canActivate(createContext(request))).rejects.toThrow(
      UnauthorizedError,
    );
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});
