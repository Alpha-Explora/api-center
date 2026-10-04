import { createHmac } from "node:crypto";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/audit-events.service";
import { PaymentWebhookController } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/payment-webhook.controller";
import { RegistryService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/registry.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { SharedServiceRoutingService } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-service-routing.service";
import {
  ServiceUnavailableError,
  UnauthorizedError,
} from "../../../../apps/gateway/src/shared/errors";

jest.mock("../../../../apps/gateway/src/shared/proxy/cloud-run-auth", () => ({
  getCloudRunAuthorizationHeader: jest.fn(async (upstream: string) =>
    upstream.includes(".run.app")
      ? "Bearer webhook-cloud-run-token"
      : undefined,
  ),
}));

describe("PaymentWebhookController", () => {
  const mockRegistry = {} as RegistryService;
  const mockConfig = {
    paymentWebhooks: {
      paymongoTestSecret: "test-key",
      paymongoLiveSecret: "live-key",
      paymongoSecret: "legacy-key",
    },
  } as unknown as ConfigService;
  const mockRouting = {
    resolve: jest.fn(),
  } as unknown as SharedServiceRoutingService;

  let controller: PaymentWebhookController;
  let fetchMock: jest.Mock;
  let auditEvents: { record: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.paymentWebhooks.paymongoTestSecret = "test-key";
    mockConfig.paymentWebhooks.paymongoLiveSecret = "live-key";
    mockConfig.paymentWebhooks.paymongoSecret = "legacy-key";
    (mockRouting.resolve as jest.Mock).mockImplementation(
      (_serviceId: string, environment: string) => ({
        sharedServiceId: "payment",
        environment,
        targetUrl: `http://payment-${environment}:4010`,
      }),
    );
    auditEvents = { record: jest.fn().mockResolvedValue(undefined) };
    controller = new PaymentWebhookController(
      mockRegistry,
      mockConfig,
      auditEvents as unknown as AuditEventsService,
      mockRouting,
    );
    fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        get: jest.fn().mockReturnValue("application/json"),
      },
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          received: true,
          event: "checkout_session.payment.paid",
          environment: "test",
          data: { paymentId: "pay_123" },
        }),
      ),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("forwards PayMongo test webhooks to the test payment runtime with environment evidence", async () => {
    const rawBody = Buffer.from('{"data":{"id":"evt_123"}}');
    const timestamp = "1496734173";
    const signature = signPayMongoPayload(timestamp, rawBody, "test-key");

    const result = await controller.forwardPayMongoWebhook("test", {
      rawBody,
      body: { data: { id: "evt_123" } },
      headers: {
        "content-type": "application/json",
        "paymongo-signature": `t=${timestamp},te=${signature},li=`,
      },
    } as any);

    expect(mockRouting.resolve).toHaveBeenCalledWith("payment", "test");
    expect(auditEvents.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "shared_service.webhook.received",
        sharedServiceId: "payment",
        payload: expect.objectContaining({
          environment: "test",
          providerEventKey: {
            environment: "test",
            provider: "paymongo",
            providerEventId: "evt_123",
          },
          route: "/webhooks/test",
          upstream: "http://payment-test:4010/webhooks",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://payment-test:4010/webhooks",
      expect.objectContaining({
        method: "POST",
        body: rawBody,
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Paymongo-Signature": `t=${timestamp},te=${signature},li=`,
          "X-APICenter-Environment": "test",
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        received: true,
        event: "checkout_session.payment.paid",
      }),
    );
  });

  it("forwards PayMongo live webhooks with the live secret and live signature field", async () => {
    const rawBody = Buffer.from('{"data":{"id":"evt_live"}}');
    const timestamp = "1496734173";
    const signature = signPayMongoPayload(timestamp, rawBody, "live-key");

    await controller.forwardPayMongoWebhook("live", {
      rawBody,
      body: { data: { id: "evt_live" } },
      headers: {
        "content-type": "application/json",
        "paymongo-signature": `t=${timestamp},te=wrong,li=${signature}`,
      },
    } as any);

    expect(mockRouting.resolve).toHaveBeenCalledWith("payment", "live");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://payment-live:4010/webhooks",
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-APICenter-Environment": "live",
          "Paymongo-Signature": `t=${timestamp},te=wrong,li=${signature}`,
        }),
      }),
    );
  });

  it("adds Cloud Run IAM Authorization when forwarding to private payment Cloud Run", async () => {
    (mockRouting.resolve as jest.Mock).mockReturnValue({
      sharedServiceId: "payment",
      environment: "live",
      targetUrl: "https://payment-live-abc.a.run.app",
    });
    const rawBody = Buffer.from('{"data":{"id":"evt_live"}}');
    const timestamp = "1496734173";
    const signature = signPayMongoPayload(timestamp, rawBody, "live-key");

    await controller.forwardPayMongoWebhook("live", {
      rawBody,
      body: { data: { id: "evt_live" } },
      headers: {
        "content-type": "application/json",
        "paymongo-signature": `t=${timestamp},te=wrong,li=${signature}`,
      },
    } as any);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://payment-live-abc.a.run.app/webhooks",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer webhook-cloud-run-token",
          "X-APICenter-Environment": "live",
        }),
      }),
    );
  });

  it("rejects mismatched live signatures on the test webhook route before forwarding", async () => {
    const rawBody = Buffer.from('{"data":{"id":"evt_123"}}');
    const timestamp = "1496734173";
    const liveSignature = signPayMongoPayload(timestamp, rawBody, "live-key");

    await expect(
      controller.forwardPayMongoWebhook("test", {
        rawBody,
        body: { data: { id: "evt_123" } },
        headers: {
          "paymongo-signature": `t=${timestamp},te=wrong,li=${liveSignature}`,
        },
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auditEvents.record).not.toHaveBeenCalled();
  });

  it("rejects before forwarding when the matching environment secret is not configured", async () => {
    mockConfig.paymentWebhooks.paymongoLiveSecret = "";
    const rawBody = Buffer.from("{}");

    await expect(
      controller.forwardPayMongoWebhook("live", {
        rawBody,
        body: {},
        headers: {
          "paymongo-signature": "t=1496734173,li=signature",
        },
      } as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auditEvents.record).not.toHaveBeenCalled();
  });
});

function signPayMongoPayload(
  timestamp: string,
  rawBody: Buffer,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
}
