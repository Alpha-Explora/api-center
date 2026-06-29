import { SharedServiceExportEventSchema } from "../../../../../src/kafka/schemas/shared-service-export.schemas";

describe("SharedServiceExportEventSchema", () => {
  it("accepts a sanitized shared-service export event", () => {
    const result = SharedServiceExportEventSchema.safeParse({
      eventId: "evt_123",
      eventType: "shared.sms.call",
      tribeId: "smoke-tribe",
      sharedServiceId: "sms",
      route: "/api/v1/shared/sms/send",
      method: "POST",
      statusCode: 201,
      ok: true,
      latencyMs: 42,
      correlationId: "corr-123",
      request: {
        recipientHash:
          "sha256:5cc3f61180b52a2f19b951b2ec108a0250f0e3d0671c5ebaf35f2f2d97fd3f4d",
        hasMessage: true,
      },
      response: {
        messageId: "msg_123",
        status: "mock_sent",
      },
      redactions: ["request.to", "request.message"],
      timestamp: "2026-05-15T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown shared services", () => {
    const result = SharedServiceExportEventSchema.safeParse({
      eventId: "evt_123",
      eventType: "shared.unknown.call",
      tribeId: "smoke-tribe",
      sharedServiceId: "unknown",
      route: "/api/v1/shared/unknown/send",
      method: "POST",
      statusCode: 200,
      ok: true,
      latencyMs: 42,
      request: {},
      response: {},
      redactions: [],
      timestamp: "2026-05-15T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("accepts subscription lifecycle metadata", () => {
    const result = SharedServiceExportEventSchema.safeParse({
      eventId: "evt_sub_123",
      eventType: "shared.payment.call",
      tribeId: "smoke-tribe",
      sharedServiceId: "payment",
      route: "/api/v1/shared/payment/subscriptions",
      method: "POST",
      statusCode: 201,
      ok: true,
      latencyMs: 50,
      request: {
        referenceId: "church_123_basic",
        customerId: "cus_123",
        priceId: "price_123",
      },
      response: {
        subscriptionId: "sub_123",
        status: "active",
        provider: "paymongo",
      },
      redactions: ["request.idempotencyKey"],
      lifecycle: {
        eventType: "payment.subscription.active",
        customerId: "cus_123",
        priceId: "price_123",
        subscriptionId: "sub_123",
        invoiceId: "inv_123",
        paymentId: "pay_123",
        referenceId: "church_123_basic",
        status: "active",
        amount: 9900,
        currency: "PHP",
        provider: "paymongo",
        providerMode: "test",
      },
      timestamp: "2026-05-15T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });
});
