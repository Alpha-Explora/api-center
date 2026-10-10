import { describe, expect, it, vi } from "vitest";

import {
  PaymentConsumerManagementError,
  PaymentConsumerService,
} from "@/lib/payment-consumer-service";

describe("PaymentConsumerService", () => {
  it("registers a consumer, provisions delivery, and exposes the key once", async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
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
              keyPrefix: "apic_test_secret",
              scopes: ["payments:read", "payments:write"],
              createdAt: "2026-07-28T00:00:00.000Z",
              expiresAt: "2027-07-28T00:00:00.000Z",
              revokedAt: null,
              status: "active",
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
      eventDelivery: { status: "pending_validation" },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api-center.example.test/api/v1/admin/payments/consumers");
    expect(calls[1].url).toBe("https://api-center.example.test/api/v1/admin/payments/events/consumers");
    expect(calls[0].headers["x-platform-secret"]).toBe("operator-secret");
    expect(calls[1].body).toMatchObject({ consumerServiceId: "alphaci-backend" });
  });

  it("rejects non-HTTPS delivery endpoints before making a request", async () => {
    const fetchImpl = vi.fn();
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
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ success: false, error: { code: "INVALID_PAYMENT_CONSUMER", message: "payments.live_access approval is required" } }),
      { status: 400 },
    ));
    const service = new PaymentConsumerService({
      gatewayBaseUrl: "https://api-center.example.test",
      operatorToken: "operator-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    const failure = service.rotatePaymentApiKey("alphaci-backend", {
      ownerTribeId: "alphaci",
      environment: "test",
    });
    await expect(failure).rejects.toBeInstanceOf(PaymentConsumerManagementError);
    await expect(failure).rejects.toMatchObject({ message: "payments.live_access approval is required" });
  });

  it("forwards the live approval request ID to the gateway", async () => {
    const approvalRequestId = "00000000-0000-4000-8000-000000000001";
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ approvalRequestId });
      return new Response(JSON.stringify({ success: true, data: {
        ownerTribeId: "alphaci", consumerServiceId: "alphaci-backend", environment: "live",
        apiKey: "apic_live_secret", keyPrefix: "apic_live_secret", scopes: ["payments:write"],
        createdAt: "2026-07-28T00:00:00.000Z", expiresAt: null, revokedAt: null, status: "active",
      } }), { status: 201 });
    });
    const service = new PaymentConsumerService({
      gatewayBaseUrl: "https://api-center.example.test",
      operatorToken: "operator-token",
      fetchImpl: fetchImpl as typeof fetch,
    });

    await service.registerPaymentConsumer({
      consumerServiceId: "alphaci-backend",
      environment: "live",
      approvalRequestId,
      scopes: ["payments:write"],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
