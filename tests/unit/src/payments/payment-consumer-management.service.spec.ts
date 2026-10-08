import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { PaymentConsumerManagementService } from "../../../../apps/gateway/src/domains/payments/features/consumer-management/payment-consumer-management.service";
import type { TenancyDirectory } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.types";

describe("PaymentConsumerManagementService ownership", () => {
  const tenancy: TenancyDirectory = {
    getTribe: jest.fn(),
    resolveProject: jest.fn(),
    requireActiveProject: jest.fn(),
    resolveServicePlacement: jest.fn((serviceId: string) =>
      serviceId === "billing-api"
        ? { serviceId, projectId: "alphaci-billing", tribeId: "alphaci" }
        : null,
    ),
  };
  const tx = {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
  } as unknown as PrismaService;
  let service: PaymentConsumerManagementService;
  const previous = process.env.DATABASE_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DATABASE_ENABLED = "true";
    tx.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: "consumer-row" }])
      .mockResolvedValueOnce([
        { key_prefix: "apic_test_abc", scopes: ["payments:read"], created_at: new Date(), expires_at: null, revoked_at: null },
      ]);
    service = new PaymentConsumerManagementService(prisma, tenancy);
  });

  afterAll(() => {
    process.env.DATABASE_ENABLED = previous;
  });

  it("derives the owner tribe from the registered service", async () => {
    const result = await service.register({ consumerServiceId: "billing-api", environment: "test" });

    expect(result.ownerTribeId).toBe("alphaci");
    expect(tx.$queryRawUnsafe.mock.calls[0].slice(1, 4)).toEqual(["alphaci", "billing-api", "test"]);
  });

  it("rejects a caller-supplied ownerTribeId", async () => {
    await expect(
      service.register({ ownerTribeId: "someone-else", consumerServiceId: "billing-api", environment: "test" }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "INVALID_PAYMENT_CONSUMER" }) });
  });

  it("rejects services that are not registered tribe services", async () => {
    await expect(
      service.register({ consumerServiceId: "unknown-api", environment: "test" }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: "UNKNOWN_PAYMENT_CONSUMER_SERVICE" }) });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
