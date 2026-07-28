import { sanitizeSharedServiceEventInput } from "../../../../apps/gateway/src/shared-services/shared-service-event-sanitizer";

describe("sanitizeSharedServiceEventInput", () => {
  it("exports SMS metadata without raw recipient or message text", () => {
    const result = sanitizeSharedServiceEventInput({
      sharedServiceId: "sms",
      route: "/send",
      requestBody: {
        to: "+639171234567",
        message: "Your OTP is 123456",
        nested: { token: "secret-token" },
      },
      responseBody: {
        success: true,
        data: {
          messageId: "msg_123",
          status: "mock_sent",
          recipient: "+639171234567",
        },
      },
    });

    const serialized = JSON.stringify(result);

    expect(result.request).toEqual(
      expect.objectContaining({
        recipientHash: expect.stringMatching(/^sha256:/),
        hasMessage: true,
      }),
    );
    expect(result.response).toEqual(
      expect.objectContaining({
        messageId: "msg_123",
        status: "mock_sent",
      }),
    );
    expect(serialized).not.toContain("+639171234567");
    expect(serialized).not.toContain("Your OTP is 123456");
    expect(serialized).not.toContain("secret-token");
    expect(result.redactions).toEqual(
      expect.arrayContaining(["request.to", "request.message"]),
    );
  });

  it("exports payment metadata without idempotency keys or secret fields", () => {
    const result = sanitizeSharedServiceEventInput({
      sharedServiceId: "payment",
      route: "/checkout/sessions",
      requestBody: {
        referenceId: "order-123",
        idempotencyKey: "idem-secret",
        lineItems: [
          {
            name: "Test item",
            quantity: 2,
            amount: { value: 5000, currency: "PHP" },
          },
        ],
        secret: "provider-secret",
      },
      responseBody: {
        data: {
          checkoutId: "checkout_123",
          status: "created",
          provider: "paymongo",
        },
      },
    });

    const serialized = JSON.stringify(result);

    expect(result.request).toEqual(
      expect.objectContaining({
        referenceId: "order-123",
        idempotencyKeyHash: expect.stringMatching(/^sha256:/),
        amount: 10000,
        currency: "PHP",
        lineItemCount: 1,
      }),
    );
    expect(result.response).toEqual(
      expect.objectContaining({
        checkoutId: "checkout_123",
        status: "created",
        provider: "paymongo",
      }),
    );
    expect(serialized).not.toContain("idem-secret");
    expect(serialized).not.toContain("provider-secret");
  });

  it("exports subscription metadata without customer contact or provider secrets", () => {
    const result = sanitizeSharedServiceEventInput({
      sharedServiceId: "payment",
      route: "/subscriptions",
      requestBody: {
        referenceId: "church_123_basic",
        idempotencyKey: "sub-idem-secret",
        customerId: "cus_123",
        priceId: "price_123",
        email: "buyer@example.com",
        PAYMONGO_TEST_SECRET_KEY: "sk_test_secret",
      },
      responseBody: {
        data: {
          subscriptionId: "sub_123",
          customerId: "cus_123",
          priceId: "price_123",
          status: "active",
          provider: "paymongo",
          providerMode: "test",
        },
      },
    });

    const serialized = JSON.stringify(result);

    expect(result.request).toEqual(
      expect.objectContaining({
        referenceId: "church_123_basic",
        customerId: "cus_123",
        priceId: "price_123",
        idempotencyKeyHash: expect.stringMatching(/^sha256:/),
      }),
    );
    expect(result.response).toEqual(
      expect.objectContaining({
        subscriptionId: "sub_123",
        customerId: "cus_123",
        priceId: "price_123",
        status: "active",
        provider: "paymongo",
        providerMode: "test",
      }),
    );
    expect(serialized).not.toContain("sub-idem-secret");
    expect(serialized).not.toContain("buyer@example.com");
    expect(serialized).not.toContain("sk_test_secret");
  });

  it("redacts OTP codes and raw email targets", () => {
    const result = sanitizeSharedServiceEventInput({
      sharedServiceId: "otp",
      route: "/generate",
      requestBody: {
        target: "user@example.com",
        channel: "email",
        length: 6,
        expiresInSeconds: 300,
      },
      responseBody: {
        data: {
          otpId: "otp_123",
          code: "123456",
          channel: "email",
          status: "issued",
        },
      },
    });

    const serialized = JSON.stringify(result);

    expect(result.request).toEqual(
      expect.objectContaining({
        targetHash: expect.stringMatching(/^sha256:/),
        channel: "email",
        length: 6,
        expiresInSeconds: 300,
      }),
    );
    expect(result.response).toEqual(
      expect.objectContaining({
        otpId: "otp_123",
        channel: "email",
        status: "issued",
      }),
    );
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("123456");
  });
});
