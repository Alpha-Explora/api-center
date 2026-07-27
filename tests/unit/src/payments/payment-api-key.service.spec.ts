import { createHash } from "node:crypto";
import { PaymentApiKeyService } from "../../../../src/payments/payment-api-key.service";

describe("PaymentApiKeyService", () => {
  const originalConfig = process.env.APICENTER_PAYMENT_API_KEY_CONFIG;
  const originalDatabase = process.env.DATABASE_ENABLED;

  afterEach(() => {
    if (originalConfig === undefined) delete process.env.APICENTER_PAYMENT_API_KEY_CONFIG;
    else process.env.APICENTER_PAYMENT_API_KEY_CONFIG = originalConfig;
    if (originalDatabase === undefined) delete process.env.DATABASE_ENABLED;
    else process.env.DATABASE_ENABLED = originalDatabase;
  });

  it("resolves a configured hashed APICenter key to its consumer principal", async () => {
    const key = "apic_test_alpha_backend";
    process.env.DATABASE_ENABLED = "false";
    process.env.APICENTER_PAYMENT_API_KEY_CONFIG = JSON.stringify([
      {
        keyHash: createHash("sha256").update(key).digest("hex"),
        ownerTribeId: "alphaci",
        consumerServiceId: "alphaci-backend",
        environment: "test",
        scopes: ["payments:read", "payments:write"],
      },
    ]);

    const prisma = {} as ConstructorParameters<typeof PaymentApiKeyService>[0];
    expect(await new PaymentApiKeyService(prisma).resolve(key)).toMatchObject({
      ownerTribeId: "alphaci",
      consumerServiceId: "alphaci-backend",
      environment: "test",
    });
  });

  it("rejects an unknown key", async () => {
    process.env.DATABASE_ENABLED = "false";
    process.env.APICENTER_PAYMENT_API_KEY_CONFIG = "[]";
    const prisma = {} as ConstructorParameters<typeof PaymentApiKeyService>[0];
    expect(await new PaymentApiKeyService(prisma).resolve("apic_test_unknown")).toBeNull();
  });
});

