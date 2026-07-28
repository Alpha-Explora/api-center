import { PaymentIdempotencyService } from "../../../../apps/gateway/src/payments/payment-idempotency.service";
import { PaymentPrincipal } from "../../../../apps/gateway/src/payments/payment-api-key.service";

describe("PaymentIdempotencyService", () => {
  const principal: PaymentPrincipal = {
    ownerTribeId: "alphaci",
    consumerServiceId: "alphaci-backend",
    environment: "test",
    scopes: ["payments:write"],
  };

  it("requires a key for mutations and replays the original response", async () => {
    const service = new PaymentIdempotencyService();

    await expect(
      service.lookupOrValidate({
        principal,
        method: "POST",
        path: "/checkouts",
        body: { referenceId: "order-1" },
      }),
    ).rejects.toMatchObject({
      response: { code: "IDEMPOTENCY_KEY_REQUIRED" },
    });

    const first = await service.lookupOrValidate({
      principal,
      method: "POST",
      path: "/checkouts",
      key: "idempotency-order-1",
      body: { referenceId: "order-1" },
    });
    expect(first).toEqual({ miss: true });

    await expect(service.lookupOrValidate({
      principal, method: 'POST', path: '/checkouts', key: 'idempotency-order-1', body: { referenceId: 'order-1' },
    })).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS' } });

    await service.store({
      principal,
      method: "POST",
      path: "/checkouts",
      key: "idempotency-order-1",
      body: { referenceId: "order-1" },
      response: { status: 201, body: "eyJzdWNjZXNzIjp0cnVlfQ==" },
    });

    const replay = await service.lookupOrValidate({
      principal,
      method: "POST",
      path: "/checkouts",
      key: "idempotency-order-1",
      body: { referenceId: "order-1" },
    });
    expect(replay).toEqual({
      replay: { status: 201, body: "eyJzdWNjZXNzIjp0cnVlfQ==" },
    });
  });

  it("rejects a changed payload for an existing key", async () => {
    const service = new PaymentIdempotencyService();
    await service.lookupOrValidate({
      principal,
      method: "POST",
      path: "/checkouts",
      key: "idempotency-order-2",
      body: { referenceId: "order-2", amountMinor: 1000 },
    });

    await expect(
      service.lookupOrValidate({
        principal,
        method: "POST",
        path: "/checkouts",
        key: "idempotency-order-2",
        body: { referenceId: "order-2", amountMinor: 2000 },
      }),
    ).rejects.toMatchObject({
      response: { code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" },
    });
  });
});

