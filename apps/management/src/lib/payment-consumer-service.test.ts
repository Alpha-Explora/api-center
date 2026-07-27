import {
  PaymentConsumerManagementError,
  PaymentConsumerService,
} from "./payment-consumer-service";

describe("PaymentConsumerService", () => {
  it("registers a consumer, provisions delivery, and exposes the key once", async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const fetchImpl = jest.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      const body = calls.length === 1
        ? {
            success: true,
            data: {
              ownerTribeId: "alphaci",
              consumerServiceId: "alphaci-backend",
              environment: "test",
              apiKey: "apic_test_secret",
            },
          }
        : {
            success: true,
            data: {
              topicName: "apicenter.payment-events.test",
              subscriptionName: "apicenter.payment-events.test.alphaci-backend",
            },
          };
      return new Response(JSON.stringify(body), { status: 201 });
    });

    const service = new PaymentConsumerService({
      gatewayBaseUrl: "https://api-center.example.test",
      platformSecret: "operator-secret",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      service.registerPaymentConsumer({
        ownerTribeId: "alphaci",
        consumerServiceId: "alphaci-backend",
        environment: "test",
        eventEndpointUrl: "https://alphaci.example.test/payments/events",
        pushEndpoint: "https://alphaci-uc.a.run.app/api/v1/payments/events",
        deliveryServiceAccountEmail: "payments-delivery@example.iam.gserviceaccount.com",
      }),
    ).resolves.toMatchObject({
      ownerTribeId: "alphaci",
      consumerServiceId: "alphaci-backend",
      environment: "test",
      keyPrefix: "apic_test_secret",
      eventDelivery: { status: "active" },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api-center.example.test/api/v1/admin/payments/consumers");
    expect(calls[1].url).toBe("https://api-center.example.test/api/v1/admin/payments/events/consumers");
    expect(calls[0].headers["x-platform-secret"]).toBe("operator-secret");
    expect(calls[1].body).toMatchObject({ consumerServiceId: "alphaci-backend" });
  });

  it("rejects non-HTTPS delivery endpoints before making a request", async () => {
    const fetchImpl = jest.fn();
    const service = new PaymentConsumerService({
      gatewayBaseUrl: "https://api-center.example.test",
      operatorToken: "operator-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      service.provisionEventDelivery({
        ownerTribeId: "alphaci",
        consumerServiceId: "alphaci-backend",
        environment: "test",
        pushEndpoint: "http://alphaci.example.test/events",
        deliveryServiceAccountEmail: "payments-delivery@example.iam.gserviceaccount.com",
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces operator API failures without returning credentials", async () => {
    const fetchImpl = jest.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: "INVALID_PAYMENT_CONSUMER" } }),
      { status: 400 },
    ));
    const service = new PaymentConsumerService({
      gatewayBaseUrl: "https://api-center.example.test",
      operatorToken: "operator-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      service.rotatePaymentApiKey("alphaci-backend", {
        ownerTribeId: "alphaci",
        environment: "test",
      }),
    ).rejects.toBeInstanceOf(PaymentConsumerManagementError);
  });
});
