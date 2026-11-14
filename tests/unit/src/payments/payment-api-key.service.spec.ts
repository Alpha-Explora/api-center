import { createHash } from "node:crypto";
import { PaymentApiKeyService } from "../../../../apps/gateway/src/domains/payments/features/payment-facade/payment-api-key.service";

describe("PaymentApiKeyService", () => {
  const originalConfig = process.env.APICENTER_PAYMENT_API_KEY_CONFIG;
  const originalDatabase = process.env.DATABASE_ENABLED;
  const key = "apic_test_alpha_backend";
  const keyConfig = JSON.stringify([
    {
      keyHash: createHash("sha256").update(key).digest("hex"),
      ownerTribeId: "alphaci",
      consumerServiceId: "alphaci-backend",
      environment: "test",
      scopes: ["payments:read", "payments:write"],
    },
  ]);

  type Placement = { tribeId: string; projectId: string };
  function tenancy(placements: Record<string, Placement>, projectPlacement = {
    project: { projectId: "alphaci-core", tribeId: "alphaci", status: "active" },
    tribe: { tribeId: "alphaci", status: "active" },
  }) {
    return {
      resolveServicePlacement: jest.fn((serviceId: string) =>
        placements[serviceId] ? { serviceId, ...placements[serviceId] } : null),
      resolveProject: jest.fn(() => projectPlacement),
    };
  }

  const prisma = {} as ConstructorParameters<typeof PaymentApiKeyService>[0];
  function serviceWith(
    currentTenancy: ReturnType<typeof tenancy>,
    serviceOverrides: Record<string, unknown> = {},
  ) {
    const currentRegistry = {
      get: jest.fn((serviceId: string) => serviceId === "alphaci-backend" ? {
        serviceId: "alphaci-backend",
        serviceType: "tribe",
        projectId: "alphaci-core",
        ownerTribeId: "alphaci",
        status: "active",
        environments: [{ environment: "test", status: "active" }],
        // Payment API keys are dedicated credentials and do not require a registry consumes grant.
        consumes: [],
        ...serviceOverrides,
      } : null),
    };
    return new PaymentApiKeyService(
      prisma,
      currentRegistry as unknown as ConstructorParameters<typeof PaymentApiKeyService>[1],
      currentTenancy as unknown as ConstructorParameters<typeof PaymentApiKeyService>[2],
    );
  }

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "false";
    process.env.APICENTER_PAYMENT_API_KEY_CONFIG = keyConfig;
  });

  afterEach(() => {
    if (originalConfig === undefined) delete process.env.APICENTER_PAYMENT_API_KEY_CONFIG;
    else process.env.APICENTER_PAYMENT_API_KEY_CONFIG = originalConfig;
    if (originalDatabase === undefined) delete process.env.DATABASE_ENABLED;
    else process.env.DATABASE_ENABLED = originalDatabase;
  });

  it("resolves a configured key to the project its consumer service is placed in", async () => {
    const currentTenancy = tenancy({ "alphaci-backend": { tribeId: "alphaci", projectId: "alphaci-core" } });
    await expect(serviceWith(currentTenancy).resolve(key)).resolves.toMatchObject({
      ownerTribeId: "alphaci",
      projectId: "alphaci-core",
      consumerServiceId: "alphaci-backend",
      environment: "test",
    });
    expect(currentTenancy.resolveProject).toHaveBeenCalledWith("alphaci-core");
  });

  it("refuses a key whose consumer service has no registry placement", async () => {
    await expect(serviceWith(tenancy({})).resolve(key)).resolves.toBeNull();
  });

  it("refuses a key whose consumer service is placed in a different tribe than the key's owner", async () => {
    const currentTenancy = tenancy({ "alphaci-backend": { tribeId: "other-tribe", projectId: "other-core" } });
    await expect(serviceWith(currentTenancy).resolve(key)).resolves.toBeNull();
  });

  it.each([
    ["inactive service", { status: "retired" }, undefined],
    ["shared service", { serviceType: "shared" }, undefined],
    ["changed project", { projectId: "other-core" }, undefined],
    ["changed owner tribe", { ownerTribeId: "other-tribe" }, undefined],
    ["inactive test environment", { environments: [{ environment: "test", status: "suspended" }] }, undefined],
    ["inactive project", {}, { project: { projectId: "alphaci-core", tribeId: "alphaci", status: "suspended" }, tribe: { tribeId: "alphaci", status: "active" } }],
    ["inactive tribe", {}, { project: { projectId: "alphaci-core", tribeId: "alphaci", status: "active" }, tribe: { tribeId: "alphaci", status: "suspended" } }],
  ])("refuses a valid key when the current %s", async (_label, serviceOverrides, projectPlacement) => {
    const currentTenancy = tenancy(
      { "alphaci-backend": { tribeId: "alphaci", projectId: "alphaci-core" } },
      projectPlacement as any,
    );
    await expect(serviceWith(currentTenancy, serviceOverrides as Record<string, unknown>).resolve(key)).resolves.toBeNull();
  });

  it("rejects an unknown key", async () => {
    process.env.APICENTER_PAYMENT_API_KEY_CONFIG = "[]";
    await expect(serviceWith(tenancy({})).resolve("apic_test_unknown")).resolves.toBeNull();
  });

  it("recognizes checkout-scoped API keys as configured without claiming caller possession", async () => {
    process.env.APICENTER_PAYMENT_API_KEY_CONFIG = JSON.stringify([{
      keyHash: createHash("sha256").update(key).digest("hex"),
      ownerTribeId: "alphaci",
      consumerServiceId: "alphaci-backend",
      environment: "test",
      scopes: ["payments:checkout:read", "payments:checkout:write"],
    }]);
    const currentTenancy = tenancy({ "alphaci-backend": { tribeId: "alphaci", projectId: "alphaci-core" } });
    await expect(serviceWith(currentTenancy).hasActiveReadWriteKey("alphaci-backend", "alphaci-core", "test")).resolves.toBe(true);
  });
});

