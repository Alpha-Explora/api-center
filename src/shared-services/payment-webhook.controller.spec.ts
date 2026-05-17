import { PaymentWebhookController } from "./payment-webhook.controller";
import { RegistryService } from "../registry/registry.service";
import { NotFoundError } from "../shared/errors";

describe("PaymentWebhookController", () => {
  const mockRegistry = {
    resolveUpstream: jest.fn(),
  } as unknown as RegistryService;

  let controller: PaymentWebhookController;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PaymentWebhookController(mockRegistry);
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

    const result = await controller.forwardPayMongoWebhook({
      rawBody,
      body: { data: { id: "evt_123" } },
      headers: {
        "content-type": "application/json",
        "paymongo-signature": "t=1496734173,te=sig,li=",
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
          "Paymongo-Signature": "t=1496734173,te=sig,li=",
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
});
