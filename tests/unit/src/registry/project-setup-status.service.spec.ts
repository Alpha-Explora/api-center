import { ProjectSetupStatusService } from "../../../../apps/gateway/src/domains/catalog-registry/project-overview/project-setup-status.service";

describe("ProjectSetupStatusService", () => {
  const oldFetch = global.fetch;
  const oldToken = process.env.GAUTH_ADMIN_TOKEN;

  afterEach(() => {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.GAUTH_ADMIN_TOKEN;
    else process.env.GAUTH_ADMIN_TOKEN = oldToken;
  });

  function createService(hasConfiguredPaymentKey = false) {
    process.env.GAUTH_ADMIN_TOKEN = "test-admin-token";
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ registered: true, credentialSettingsConfigured: true }),
    }) as unknown as typeof fetch;
    const source = {
      serviceId: "orders-api",
      projectId: "shop",
      status: "active",
      consumes: ["email", "payment", "missing-service"],
      environments: [{ environment: "test", status: "active" }],
    };
    const registry = {
      canAccess: jest.fn(() => true),
      get: jest.fn((serviceId: string) => ({
        "orders-api": source,
        payment: { serviceId: "payment", serviceType: "shared", status: "active", environments: [{ environment: "test", status: "active" }] },
        email: { serviceId: "email", status: "active", environments: [{ environment: "test", status: "active" }] },
        gauth: { environments: [{ environment: "test", baseUrl: "http://gauth.local" }] },
      })[serviceId] ?? null),
    };
    const tenancy = {
      resolveProject: jest.fn(() => ({
        tribe: { organizationId: "org", status: "active" },
        project: { status: "active" },
      })),
    };
    const paymentAccess = {
      hasActiveReadWriteKey: jest.fn(async () => hasConfiguredPaymentKey),
    };
    return new ProjectSetupStatusService(registry as never, tenancy as never, paymentAccess as never);
  }

  it("requires read and write scopes and keeps configured keys unknown without proof the caller has them", async () => {
    const service = createService(true);
    const status = await service.getStatus({ projectId: "shop", serviceId: "orders-api", environment: "test", scopes: ["payments:read"] });
    expect(status.checks.find((check) => check.id === "payments-access")).toMatchObject({
      status: "unknown",
      detail: expect.stringContaining("cannot confirm the client has that key"),
    });
    expect(status.checks.find((check) => check.id === "payment-event-delivery")?.status).toBe("unknown");
  });

  it("marks checkout access ready only when the authenticated token has read and write scopes", async () => {
    const service = createService(false);
    const status = await service.getStatus({
      projectId: "shop",
      serviceId: "orders-api",
      environment: "test",
      scopes: ["payments:read", "payments:write"],
    });
    expect(status.checks.find((check) => check.id === "payments-access")?.status).toBe("ready");
    expect(status.checks.find((check) => check.id === "google-sign-in")?.status).toBe("ready");
    expect(status.checks.find((check) => check.id === "dependency:missing-service")?.status).toBe("missing");
  });

  it("does not treat legacy payment read scope as checkout write access", async () => {
    const service = createService(false);
    const status = await service.getStatus({
      projectId: "shop",
      serviceId: "orders-api",
      environment: "test",
      scopes: ["payments:read"],
    });
    expect(status.checks.find((check) => check.id === "payments-access")?.status).toBe("missing");
  });

  it("does not query payment registrations without a resolved project placement", async () => {
    const service = createService(false);
    const tenancy = (service as unknown as { tenancy: { resolveProject: jest.Mock } }).tenancy;
    tenancy.resolveProject.mockReturnValue(null);
    const status = await service.getStatus({ projectId: "missing", serviceId: "orders-api", environment: "test", scopes: [] });
    expect(status.checks.find((check) => check.id === "payments-access")?.status).toBe("unknown");
  });
  it.each([
    [["payment:read", "payment:write"], "ready"],
    [["payment:read"], "missing"],
    [["payment:charge", "payment:refund"], "missing"],
  ])("reports current checkout access for legacy service scopes %j", async (scopes, expected) => {
    const service = createService(false);
    const status = await service.getStatus({ projectId: "shop", serviceId: "orders-api", environment: "test", scopes });
    expect(status.checks.find((check) => check.id === "payments-access")?.status).toBe(expected);
  });

  it("does not mark payment access ready after the consumer grant is removed", async () => {
    const service = createService(false);
    const registry = (service as unknown as { registry: { canAccess: jest.Mock } }).registry;
    registry.canAccess.mockReturnValue(false);
    const status = await service.getStatus({ projectId: "shop", serviceId: "orders-api", environment: "test", scopes: ["payments:read", "payments:write"] });
    expect(status.checks.find((check) => check.id === "payments-access")).toMatchObject({ status: "missing", detail: expect.stringContaining("current registration") });
  });

});
