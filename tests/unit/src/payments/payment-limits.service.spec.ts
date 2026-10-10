import { PaymentLimitsService } from "../../../../apps/gateway/src/domains/payments/features/payment-limits/payment-limits.service";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";

describe("PaymentLimitsService", () => {
  const previousDatabaseEnabled = process.env.DATABASE_ENABLED;
  const prisma = { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() };
  let service: PaymentLimitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DATABASE_ENABLED;
    service = new PaymentLimitsService(prisma as unknown as PrismaService);
  });

  afterAll(() => {
    if (previousDatabaseEnabled === undefined) delete process.env.DATABASE_ENABLED;
    else process.env.DATABASE_ENABLED = previousDatabaseEnabled;
  });

  it("rejects a payment above the active plan amount limit with 422", async () => {
    await expect(service.enforce({
      ownerTribeId: "tribe-a",
      projectId: "project-a",
      environment: "test",
      amountMinor: 1_000_001,
    })).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({ code: "AMOUNT_LIMIT_EXCEEDED" }),
    });
  });

  it("rejects payment requests above the plan requests-per-minute limit with 429", async () => {
    const input = { ownerTribeId: "tribe-rate", projectId: "project-rate", environment: "test" as const };
    for (let request = 0; request < 30; request += 1) await service.enforce(input);

    await expect(service.enforce(input)).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ code: "PAYMENT_RATE_LIMIT_EXCEEDED" }),
    });
  });

  it("uses the project/environment override before the active plan defaults", async () => {
    process.env.DATABASE_ENABLED = "true";
    prisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ plan_key: "pro" }])
      .mockResolvedValueOnce([{
        maximum_payment_amount_minor: "2500000",
        payment_requests_per_minute: 7,
        reason: "temporary reviewed limit",
      }]);
    service = new PaymentLimitsService(prisma as unknown as PrismaService);

    const limits = await service.resolve("tribe-a", "project-a", "live");

    expect(limits).toEqual(expect.objectContaining({
      planKey: "pro",
      maximumPaymentAmountMinor: 2_500_000,
      paymentRequestsPerMinute: 7,
      overridden: true,
      reason: "temporary reviewed limit",
    }));
    expect(prisma.$queryRawUnsafe.mock.calls[0].slice(1)).toEqual(["tribe-a", "project-a", "live"]);
    expect(prisma.$queryRawUnsafe.mock.calls[1].slice(1)).toEqual(["project-a", "live"]);
  });
});
