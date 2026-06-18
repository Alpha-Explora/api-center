import { enforceProxyAuthContext } from "./proxy-auth-context";
import { ForbiddenError } from "../errors";

function input(overrides: Record<string, unknown> = {}) {
  return {
    registry: {
      canAccess: jest.fn().mockReturnValue(true),
      getRequiredScopes: jest.fn().mockReturnValue([]),
    },
    auth: {
      checkScopes: jest.fn().mockReturnValue([]),
    },
    emergencyControls: {
      evaluate: jest.fn().mockReturnValue({ allowed: true }),
    },
    targetServiceId: "orders",
    tribeId: "orders-tribe",
    req: {
      user: { token: { scopes: ["orders:read"] } },
    },
    ...overrides,
  } as any;
}

describe("enforceProxyAuthContext", () => {
  it("throws when emergency controls block the target service", () => {
    const context = input({
      emergencyControls: {
        evaluate: jest.fn().mockReturnValue({
          allowed: false,
          reason: "incident hold",
        }),
      },
    });

    expect(() => enforceProxyAuthContext(context)).toThrow(
      new ForbiddenError("Emergency control active: incident hold"),
    );
  });

  it("throws when the tribe cannot access the target service", () => {
    const context = input({
      registry: {
        canAccess: jest.fn().mockReturnValue(false),
        getRequiredScopes: jest.fn().mockReturnValue([]),
      },
    });

    expect(() => enforceProxyAuthContext(context)).toThrow(
      new ForbiddenError(
        "Tribe 'orders-tribe' is not authorised to access 'orders'",
      ),
    );
  });

  it("throws when required scopes are missing", () => {
    const context = input({
      registry: {
        canAccess: jest.fn().mockReturnValue(true),
        getRequiredScopes: jest.fn().mockReturnValue(["orders:write"]),
      },
      auth: {
        checkScopes: jest.fn().mockReturnValue(["orders:write"]),
      },
    });

    expect(() => enforceProxyAuthContext(context)).toThrow(
      new ForbiddenError(
        "Insufficient scopes for 'orders'. Missing: orders:write",
      ),
    );
  });
});
