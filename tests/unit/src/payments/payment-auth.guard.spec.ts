import { ForbiddenException } from "@nestjs/common";
import paymentManifest from "../../../../apps/payments/service-manifest.json";
import { PaymentsController } from "../../../../apps/gateway/src/domains/payments/features/payment-facade/payments.controller";
import { PaymentAuthGuard } from "../../../../apps/gateway/src/domains/payments/shared/payment-auth.guard";
import { PaymentIdempotencyService } from "../../../../apps/gateway/src/domains/payments/shared/payment-idempotency.service";
import { normalizePaymentServiceScopes } from "../../../../apps/gateway/src/domains/payments/shared/payment-service-scopes";

const activePlacement = {
  project: { projectId: "project-alpha", tribeId: "tribe-alpha", status: "active" },
  tribe: { tribeId: "tribe-alpha", status: "active" },
};

function createHarness(overrides: {
  claims?: Record<string, unknown> | null;
  service?: Record<string, unknown> | null;
  paymentService?: Record<string, unknown> | null;
  placement?: Record<string, unknown> | null;
  projectPlacement?: Record<string, unknown> | null;
  jwtResult?: boolean;
  canAccess?: boolean;
} = {}) {
  const request: Record<string, any> = {
    headers: {
      authorization: "Bearer signed-service-token",
      "x-project-id": "attacker-project",
      "x-tribe-id": "attacker-tribe",
      "x-apicenter-environment": "live",
    },
    body: { projectId: "attacker-project", tribeId: "attacker-tribe", environment: "live" },
    method: "POST",
    originalUrl: "/api/v1/payments/checkouts",
    get(name: string) { return this.headers[name.toLowerCase()]; },
    user: overrides.claims === undefined ? {
      sub: "serbizio",
      sourceServiceId: "serbizio",
      tribeId: "tribe-alpha",
      projectId: "project-alpha",
      environment: "test",
      scopes: ["payments:read", "payments:write"],
      permissions: [],
    } : overrides.claims,
  };
  const jwt = {
    canActivate: jest.fn(async () => {
      if (request.user === null) request.user = undefined;
      return overrides.jwtResult ?? true;
    }),
  };
  const defaultService = {
    serviceId: "serbizio",
    serviceType: "tribe",
    projectId: "project-alpha",
    ownerTribeId: "tribe-alpha",
    status: "active",
    consumes: ["payment"],
    environments: [{ environment: "test", status: "active" }],
  };
  const service = overrides.service === undefined
    ? defaultService
    : { ...defaultService, ...overrides.service };
  const paymentService = overrides.paymentService === undefined
    ? { serviceId: "payment", serviceType: "shared", status: "active", environments: [{ environment: "test", status: "active" }] }
    : overrides.paymentService;
  const registry = {
    get: jest.fn((serviceId: string) => serviceId === "payment" ? paymentService : service),
    canAccess: jest.fn(() => overrides.canAccess ?? true),
  };
  const tenancy = {
    resolveServicePlacement: jest.fn(() => overrides.placement === undefined
      ? { serviceId: "serbizio", projectId: "project-alpha", tribeId: "tribe-alpha" }
      : overrides.placement),
    resolveProject: jest.fn(() => overrides.projectPlacement === undefined
      ? activePlacement
      : overrides.projectPlacement),
  };
  const apiKeys = { resolve: jest.fn() };
  const guard = new PaymentAuthGuard(apiKeys as any, jwt as any, registry as any, tenancy as any);
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as any;
  return { guard, context, request, jwt, registry, tenancy, apiKeys };
}

describe("PaymentAuthGuard service-token path", () => {
  it("builds the payment principal from verified claims and current placement", async () => {
    const h = createHarness();
    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.jwt.canActivate).toHaveBeenCalledWith(h.context);
    expect(h.tenancy.resolveServicePlacement).toHaveBeenCalledWith("serbizio");
    expect(h.registry.canAccess).toHaveBeenCalledWith("serbizio", "payment", "test");
    expect(h.request.paymentPrincipal).toEqual({
      ownerTribeId: "tribe-alpha",
      projectId: "project-alpha",
      consumerServiceId: "serbizio",
      environment: "test",
      scopes: ["payments:read", "payments:write"],
    });
  });

  it("accepts the canonical scopes advertised by the shared payment manifest", async () => {
    expect(paymentManifest.requiredScopes).toEqual(["payments:read", "payments:write"]);
    const h = createHarness({ claims: {
      sub: "serbizio",
      sourceServiceId: "serbizio",
      tribeId: "tribe-alpha",
      projectId: "project-alpha",
      environment: "test",
      scopes: paymentManifest.requiredScopes,
      permissions: [],
    } });
    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.request.paymentPrincipal.scopes).toEqual(paymentManifest.requiredScopes);
  });

  it.each([
    ["missing claims", null],
    ["missing project", { sub: "serbizio", sourceServiceId: "serbizio", tribeId: "tribe-alpha", environment: "test", scopes: [] }],
    ["missing tribe", { sub: "serbizio", sourceServiceId: "serbizio", projectId: "project-alpha", environment: "test", scopes: [] }],
    ["mismatched subject", { sub: "someone-else", sourceServiceId: "serbizio", tribeId: "tribe-alpha", projectId: "project-alpha", environment: "test", scopes: [] }],
    ["mismatched project", { sub: "serbizio", sourceServiceId: "serbizio", tribeId: "tribe-alpha", projectId: "other-project", environment: "test", scopes: [] }],
    ["mismatched tribe", { sub: "serbizio", sourceServiceId: "serbizio", tribeId: "other-tribe", projectId: "project-alpha", environment: "test", scopes: [] }],
    ["unsupported environment", { sub: "serbizio", sourceServiceId: "serbizio", tribeId: "tribe-alpha", projectId: "project-alpha", environment: "staging", scopes: [] }],
  ])("rejects %s", async (_label, claims) => {
    const h = createHarness({ claims: claims as any });
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.request.paymentPrincipal).toBeUndefined();
  });

  it.each([
    ["inactive service", { status: "deprecated" }, undefined, undefined, true],
    ["inactive service environment", { environments: [{ environment: "test", status: "suspended" }] }, undefined, undefined, true],
    ["unplaced service", undefined, null, undefined, true],
    ["inactive project", undefined, undefined, { ...activePlacement, project: { ...activePlacement.project, status: "suspended" } }, true],
    ["missing payment consumes grant", undefined, undefined, undefined, false],
  ])("rejects %s", async (_label, servicePatch, placement, projectPlacement, canAccess) => {
    const h = createHarness({
      service: servicePatch as any,
      placement: placement as any,
      projectPlacement: projectPlacement as any,
      canAccess: canAccess as boolean,
    });
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.request.paymentPrincipal).toBeUndefined();
  });

  it("maps only the legacy generic payment read/write scopes and merges permissions", async () => {
    const h = createHarness({ claims: {
      sub: "serbizio",
      sourceServiceId: "serbizio",
      tribeId: "tribe-alpha",
      projectId: "project-alpha",
      environment: "test",
      scopes: ["payment:read", "payment:write"],
      permissions: ["payments:read", "payments:write"],
    } });
    await h.guard.canActivate(h.context);
    expect(h.request.paymentPrincipal.scopes).toEqual(["payments:read", "payments:write"]);
    expect(normalizePaymentServiceScopes(["payment:charge", "payment:refund"])).toEqual([
      "payment:charge", "payment:refund",
    ]);
  });

  it("does not let a read-only service JWT write a checkout", async () => {
    const h = createHarness({ claims: {
      sub: "serbizio",
      sourceServiceId: "serbizio",
      tribeId: "tribe-alpha",
      projectId: "project-alpha",
      environment: "test",
      scopes: ["payment:read"],
      permissions: [],
    } });
    await h.guard.canActivate(h.context);
    const controller = new PaymentsController(
      new PaymentIdempotencyService(),
      { enforce: jest.fn() } as any,
    );
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    await expect(controller.proxy(h.request as any, response)).rejects.toMatchObject({
      response: { code: "INSUFFICIENT_SCOPE" },
    });
  });

  it("returns false without creating a principal when the JWT guard declines the token", async () => {
    const h = createHarness({ jwtResult: false });
    await expect(h.guard.canActivate(h.context)).resolves.toBe(false);
    expect(h.request.paymentPrincipal).toBeUndefined();
  });

  it("preserves the payment API-key authentication path", async () => {
    const h = createHarness();
    const principal = {
      ownerTribeId: "tribe-key",
      projectId: "project-key",
      consumerServiceId: "key-consumer",
      environment: "test",
      scopes: ["payments:read"],
    };
    h.request.headers.authorization = "Bearer apic_test_key";
    h.apiKeys.resolve.mockResolvedValue(principal);

    await expect(h.guard.canActivate(h.context)).resolves.toBe(true);
    expect(h.apiKeys.resolve).toHaveBeenCalledWith("apic_test_key");
    expect(h.jwt.canActivate).not.toHaveBeenCalled();
    expect(h.request.paymentPrincipal).toEqual(principal);
  });

  it("rejects a consumer token when the payment environment is inactive", async () => {
    const h = createHarness({
      claims: {
        sub: "serbizio", sourceServiceId: "serbizio", tribeId: "tribe-alpha",
        projectId: "project-alpha", environment: "live", scopes: ["payments:write"],
      },
      service: {
        environments: [{ environment: "live", status: "active" }],
      },
      paymentService: {
        serviceId: "payment", serviceType: "shared", status: "active",
        environments: [{ environment: "live", status: "suspended" }],
      },
    });
    await expect(h.guard.canActivate(h.context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.request.paymentPrincipal).toBeUndefined();
  });
});
