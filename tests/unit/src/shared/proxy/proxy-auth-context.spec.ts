import { enforceProxyAuthContext } from "../../../../../apps/gateway/src/shared/proxy/proxy-auth-context";
import { ForbiddenError } from "../../../../../apps/gateway/src/shared/errors";

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
    sourceServiceId: "checkout-api",
    tribeId: "orders-tribe",
    req: {
      projectId: "orders-web",
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

  it("passes the calling service, its project, and its tribe to emergency controls", () => {
    const context = input();

    enforceProxyAuthContext(context);

    expect(context.emergencyControls.evaluate).toHaveBeenCalledWith({
      ownerTribeId: "orders-tribe",
      projectId: "orders-web",
      sourceServiceId: "checkout-api",
      serviceId: "orders",
    });
    expect(context.registry.canAccess).toHaveBeenCalledWith("checkout-api", "orders");
  });

  it("throws when the calling service cannot access the target service", () => {
    const context = input({
      registry: {
        canAccess: jest.fn().mockReturnValue(false),
        getRequiredScopes: jest.fn().mockReturnValue([]),
      },
    });

    expect(() => enforceProxyAuthContext(context)).toThrow(
      new ForbiddenError(
        "Service 'checkout-api' is not authorised to access 'orders'",
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
