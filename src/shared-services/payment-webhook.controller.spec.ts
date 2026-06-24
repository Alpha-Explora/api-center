import { createHmac } from "node:crypto";
import { PaymentWebhookController } from "./payment-webhook.controller";
import { RegistryService } from "../registry/registry.service";
import { ConfigService } from "../config/config.service";
import {
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../shared/errors";

describe("PaymentWebhookController", () => {
  const mockRegistry = {
    resolveUpstream: jest.fn(),
  } as unknown as RegistryService;
  const mockConfig = {
    paymentWebhooks: {
      paymongoSecret: "test-key",
    },
  } as ConfigService;

  let controller: PaymentWebhookController;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.paymentWebhooks.paymongoSecret = "test-key";
    controller = new PaymentWebhookController(mockRegistry, mockConfig);
    fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      headers: {
        get: jest.fn().mockReturnValue("application/json"),
      },
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          received: true,
          event: "checkout_session.payment.paid",
          data: { paymentId: "pay_123" },
        }),
      ),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("forwards PayMongo webhooks to the payment shared service with the raw body and signature", async () => {
    (mockRegistry.resolveUpstream as jest.Mock).mockReturnValue(
      "http://payment-service:4010/webhooks",
    );
    const rawBody = Buffer.from('{"data":{"id":"evt_123"}}');
    const timestamp = "1496734173";
    const signature = signPayMongoPayload(timestamp, rawBody);

    const result = await controller.forwardPayMongoWebhook({
      rawBody,
      body: { data: { id: "evt_123" } },
      headers: {
        "content-type": "application/json",
        "paymongo-signature": `t=${timestamp},te=${signature},li=`,
      },
    } as any);

    expect(mockRegistry.resolveUpstream).toHaveBeenCalledWith(
      "payment",
      "/webhooks",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://payment-service:4010/webhooks",
      expect.objectContaining({
        method: "POST",
        body: rawBody,
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Paymongo-Signature": `t=${timestamp},te=${signature},li=`,
        }),
      }),
    );
    expect(result).toEqual({
      received: true,
      event: "checkout_session.payment.paid",
      data: { paymentId: "pay_123" },
    });
  });

  it("fails clearly when the payment shared service is not registered", async () => {
    (mockRegistry.resolveUpstream as jest.Mock).mockReturnValue(null);

    await expect(
      controller.forwardPayMongoWebhook({
        rawBody: Buffer.from("{}"),
        body: {},
        headers: {},
      } as any),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects PayMongo webhooks before forwarding when the gateway secret is not configured", async () => {
    (mockRegistry.resolveUpstream as jest.Mock).mockReturnValue(
      "http://payment-service:4010/webhooks",
    );
    mockConfig.paymentWebhooks.paymongoSecret = "";

    await expect(
      controller.forwardPayMongoWebhook({
        rawBody: Buffer.from("{}"),
        body: {},
        headers: {
          "paymongo-signature": "t=1496734173,te=signature",
        },
      } as any),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects PayMongo webhooks before forwarding when the signature does not match", async () => {
    (mockRegistry.resolveUpstream as jest.Mock).mockReturnValue(
      "http://payment-service:4010/webhooks",
    );

    await expect(
      controller.forwardPayMongoWebhook({
        rawBody: Buffer.from('{"data":{"id":"evt_123"}}'),
        body: { data: { id: "evt_123" } },
        headers: {
          "paymongo-signature": "t=1496734173,te=bad",
        },
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function signPayMongoPayload(timestamp: string, rawBody: Buffer): string {
  return createHmac("sha256", "test-key")
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
}
