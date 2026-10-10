import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { PaymentConsumerManagementService } from "../../../../apps/gateway/src/domains/payments/features/consumer-management/payment-consumer-management.service";
import type { TenancyDirectory } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.types";
import { ApprovalRequestService } from "../../../../apps/gateway/src/domains/governance/approvals/approval-request.service";

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
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
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

  it("requires an approved live-access request before registering a live consumer", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);
    const approvals = new ApprovalRequestService({ approvalRequest: {} } as any);
    const liveService = new PaymentConsumerManagementService(prisma, tenancy, approvals);

    await expect(liveService.register({ consumerServiceId: "billing-api", environment: "live" }))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("consumes an approved live-access request for the project on registration", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);
    const request = {
      id: "approval-id",
      actionType: "payments.live_access",
      targetId: "alphaci-billing",
      targetEnvironment: "live",
      status: "approved",
    };
    const findUnique = jest.fn()
      .mockResolvedValueOnce(request)
      .mockResolvedValueOnce({ ...request, status: "applied" });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const approvals = new ApprovalRequestService({ approvalRequest: { findUnique, updateMany } } as any);
    const liveService = new PaymentConsumerManagementService(prisma, tenancy, approvals);

    const result = await liveService.register({
      consumerServiceId: "billing-api",
      environment: "live",
      approvalRequestId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result.environment).toBe("live");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "00000000-0000-4000-8000-000000000001", status: "approved" },
      data: expect.objectContaining({ status: "applied" }),
    }));
  });

  it("rejects a live-access request that has already been used", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);
    const request = {
      id: "approval-id",
      actionType: "payments.live_access",
      targetId: "alphaci-billing",
      targetEnvironment: "live",
      status: "applied",
    };
    const findUnique = jest.fn().mockResolvedValue(request);
    const updateMany = jest.fn();
    const approvals = new ApprovalRequestService({ approvalRequest: { findUnique, updateMany } } as any);
    const liveService = new PaymentConsumerManagementService(prisma, tenancy, approvals);

    await expect(liveService.register({
      consumerServiceId: "billing-api",
      environment: "live",
      approvalRequestId: "00000000-0000-4000-8000-000000000001",
    })).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rotates an existing live registration without consuming a new approval", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([{ id: "consumer-row" }]);
    const approvals = { assertApprovedForAction: jest.fn() } as unknown as ApprovalRequestService;
    const liveService = new PaymentConsumerManagementService(prisma, tenancy, approvals);

    const result = await liveService.rotate({ consumerServiceId: "billing-api", environment: "live" });

    expect(result.environment).toBe("live");
    expect(approvals.assertApprovedForAction).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when asked to rotate a consumer without an existing registration", async () => {
    (prisma.$queryRawUnsafe as jest.Mock).mockResolvedValueOnce([]);

    await expect(service.rotate({ consumerServiceId: "billing-api", environment: "live" }))
      .rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({ code: "PAYMENT_CONSUMER_NOT_REGISTERED" }),
      });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
