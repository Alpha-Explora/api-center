import { ExecutionContext } from "@nestjs/common";
import { ExternalPolicyGuard } from "../../../../../src/external/guards/external-policy.guard";
import { AuthService } from "../../../../../src/auth/auth.service";
import { LoggerService } from "../../../../../src/shared/logger.service";
import { ForbiddenError } from "../../../../../src/shared/errors";

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe("ExternalPolicyGuard", () => {
  const mockAuth = {
    mergeCallerScopes: jest.fn(),
  } as unknown as AuthService;

  const mockLogger = {
    debug: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  let guard: ExternalPolicyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ExternalPolicyGuard(mockAuth, mockLogger);
  });

  it("should allow platform admins without evaluating external policies", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([
      "platform:admin",
    ]);

    const result = guard.canActivate(
      createContext({
        method: "POST",
        params: { apiName: "legacy-provider", 0: "v1/anything" },
        user: { tribeId: "tribe-a" },
      }),
    );

    expect(result).toBe(true);
  });

  it("should deny requests to unknown external APIs", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([]);

    expect(() =>
      guard.canActivate(
        createContext({
          method: "POST",
          params: { apiName: "unknown-api", 0: "v1/anything" },
          user: { tribeId: "tribe-a" },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it("should deny removed geo external API requests", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue(["geo:read"]);

    expect(() =>
      guard.canActivate(
        createContext({
          method: "POST",
          params: { apiName: "geo", 0: "reverse-geocode" },
          user: { tribeId: "tribe-a" },
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it("should deny legacy Kafka REST external API requests", () => {
    (mockAuth.mergeCallerScopes as jest.Mock).mockReturnValue([
      "external:kafka:read",
      "external:kafka:write",
    ]);

    expect(() =>
      guard.canActivate(
        createContext({
          method: "POST",
          params: {
            apiName: "kafka",
            0: "v3/clusters/cluster-1/topics/tribe.tribe-b.orders/records",
          },
          user: { tribeId: "tribe-a" },
        }),
      ),
    ).toThrow(ForbiddenError);
  });
});
