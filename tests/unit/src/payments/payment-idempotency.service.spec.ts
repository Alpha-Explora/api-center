import { PaymentIdempotencyService } from "../../../../apps/gateway/src/domains/payments/shared/payment-idempotency.service";
import { PaymentPrincipal } from "../../../../apps/gateway/src/domains/payments/features/payment-facade/payment-api-key.service";

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

  it('atomically gives the first concurrent request the processing lease', async () => {
    const service = new PaymentIdempotencyService();
    const request = {
      principal,
      method: 'POST',
      path: '/checkouts',
      key: 'idempotency-concurrent-order-3',
      body: { referenceId: 'order-concurrent' },
    };

    const results = await Promise.allSettled([
      service.lookupOrValidate(request),
      service.lookupOrValidate(request),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled' && 'miss' in result.value)).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected' && result.reason?.response?.code === 'IDEMPOTENCY_KEY_IN_PROGRESS')).toHaveLength(1);
  });

  it("keeps an unresolved payment key blocked after the provider retry window expires", async () => {
    const clock = jest.spyOn(Date, "now");
    const start = Date.now();
    clock.mockReturnValue(start);
    const service = new PaymentIdempotencyService();
    const request = {
      principal,
      method: "POST",
      path: "/checkouts",
      key: "idempotency-unknown-123",
      body: { referenceId: "order-unknown" },
    };

    try {
      await service.lookupOrValidate(request);
      await service.markUnknown(request);
      clock.mockReturnValue(start + 24 * 60 * 60 * 1000);
      await expect(service.lookupOrValidate(request)).rejects.toMatchObject({
        response: { code: "PAYMENT_OUTCOME_UNKNOWN" },
      });
    } finally {
      clock.mockRestore();
    }
  });
});

