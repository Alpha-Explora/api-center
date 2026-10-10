import { PaymentLimitsAdminController } from "../../../../apps/gateway/src/domains/payments/features/payment-limits/payment-limits-admin.controller";

describe("PaymentLimitsAdminController", () => {
  it("stores a project/environment override with a reason and required audit record", async () => {
    const limits = {
      setOverride: jest.fn().mockResolvedValue(undefined),
      resolve: jest.fn().mockResolvedValue({ overridden: true }),
    };
    const tenancy = {
      resolveProject: jest.fn().mockReturnValue({ tribe: { tribeId: "tribe-a" } }),
    };
    const audit = { recordRequired: jest.fn().mockResolvedValue(undefined) };
    const controller = new PaymentLimitsAdminController(limits as any, tenancy as any, audit as any);

    const response = await controller.set({
      projectId: "project-a",
      environment: "live",
      maximumPaymentAmountMinor: 2_500_000,
      paymentRequestsPerMinute: 40,
      reason: "approved temporary increase",
    }, {
      user: { sub: "operator-a" },
      correlationId: "request-123",
    } as any);

    expect(limits.setOverride).toHaveBeenCalledWith(expect.objectContaining({
      ownerTribeId: "tribe-a",
      projectId: "project-a",
      environment: "live",
      maximumPaymentAmountMinor: 2_500_000,
      paymentRequestsPerMinute: 40,
      reason: "approved temporary increase",
      updatedBy: "operator-a",
    }));
    expect(audit.recordRequired).toHaveBeenCalledWith(expect.objectContaining({
      type: "payment.limits.overridden",
      resourceType: "payment_limit_override",
      resourceId: "project-a:live",
      payload: expect.objectContaining({ reason: "approved temporary increase" }),
    }));
    expect(response).toEqual({ success: true, data: { overridden: true } });
  });
});
