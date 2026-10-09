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
  // Stands in for the registry: a service resolves to the project it is placed in.
  function registry(placements: Record<string, Placement>) {
    return {
      resolveServicePlacement: jest.fn((serviceId: string) =>
        placements[serviceId] ? { serviceId, ...placements[serviceId] } : null),
    };
  }

  const prisma = {} as ConstructorParameters<typeof PaymentApiKeyService>[0];
  function serviceWith(tenancy: ReturnType<typeof registry>) {
    return new PaymentApiKeyService(prisma, tenancy as unknown as ConstructorParameters<typeof PaymentApiKeyService>[1]);
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
    const tenancy = registry({ "alphaci-backend": { tribeId: "alphaci", projectId: "alphaci-core" } });
    await expect(serviceWith(tenancy).resolve(key)).resolves.toMatchObject({
      ownerTribeId: "alphaci",
      projectId: "alphaci-core",
      consumerServiceId: "alphaci-backend",
      environment: "test",
    });
  });

  it("refuses a key whose consumer service has no registry placement", async () => {
    await expect(serviceWith(registry({})).resolve(key)).resolves.toBeNull();
  });

  it("refuses a key whose consumer service is placed in a different tribe than the key's owner", async () => {
    const tenancy = registry({ "alphaci-backend": { tribeId: "other-tribe", projectId: "other-core" } });
    await expect(serviceWith(tenancy).resolve(key)).resolves.toBeNull();
  });

  it("rejects an unknown key", async () => {
    process.env.APICENTER_PAYMENT_API_KEY_CONFIG = "[]";
    await expect(serviceWith(registry({})).resolve("apic_test_unknown")).resolves.toBeNull();
  });
});

