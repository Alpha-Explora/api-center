import { SharedServiceEventPublisher } from "./shared-service-event-publisher";
import { TOPICS } from "../kafka/topics";

describe("SharedServiceEventPublisher", () => {
  it("publishes sanitized shared-service calls to the matching export topic", () => {
    const kafka = {
      publishNonBlocking: jest.fn(),
    };
    const publisher = new SharedServiceEventPublisher(kafka as any);

    publisher.publishSharedServiceCall({
      tribeId: "smoke-tribe",
      environment: "test",
      sharedServiceId: "sms",
      route: "/api/v1/shared/sms/send",
      method: "POST",
      statusCode: 201,
      ok: true,
      latencyMs: 42,
      correlationId: "corr-123",
      requestBody: {
        to: "+639171234567",
        message: "Your OTP is 123456",
      },
      responseBody: {
        data: {
          messageId: "msg_123",
          status: "mock_sent",
        },
      },
    });

    expect(kafka.publishNonBlocking).toHaveBeenCalledWith(
      TOPICS.SHARED_SMS_EVENTS,
      expect.objectContaining({
        eventId: expect.any(String),
        eventType: "shared.sms.call",
        tribeId: "smoke-tribe",
        environment: "test",
        sharedServiceId: "sms",
        route: "/api/v1/shared/sms/send",
        method: "POST",
        statusCode: 201,
        ok: true,
        latencyMs: 42,
        correlationId: "corr-123",
        request: expect.objectContaining({
          recipientHash: expect.stringMatching(/^sha256:/),
        }),
        response: expect.objectContaining({
          messageId: "msg_123",
        }),
      }),
      {
        key: "smoke-tribe:test:sms",
        context: "SharedServiceEventPublisher",
      },
    );
  });

  it("skips unknown shared-service IDs", () => {
    const kafka = {
      publishNonBlocking: jest.fn(),
    };
    const publisher = new SharedServiceEventPublisher(kafka as any);

    publisher.publishSharedServiceCall({
      tribeId: "smoke-tribe",
      environment: "test",
      sharedServiceId: "unknown",
      route: "/api/v1/shared/unknown/send",
      method: "POST",
      statusCode: 200,
      ok: true,
      latencyMs: 42,
    });

    expect(kafka.publishNonBlocking).not.toHaveBeenCalled();
  });

  it("publishes subscription lifecycle metadata for payment responses", () => {
    const kafka = {
      publishNonBlocking: jest.fn(),
    };
    const publisher = new SharedServiceEventPublisher(kafka as any);

    publisher.publishSharedServiceCall({
      tribeId: "smoke-tribe",
      environment: "test",
      sharedServiceId: "payment",
      route: "/api/v1/shared/payment/subscriptions",
      method: "POST",
      statusCode: 201,
      ok: true,
      latencyMs: 84,
      requestBody: {
        referenceId: "church_123_basic",
        idempotencyKey: "subscription-secret",
        customerId: "cus_123",
        priceId: "price_123",
      },
      responseBody: {
        data: {
          subscriptionId: "sub_123",
          customerId: "cus_123",
          priceId: "price_123",
          referenceId: "church_123_basic",
          status: "active",
          provider: "paymongo",
          providerMode: "test",
        },
      },
    });

    expect(kafka.publishNonBlocking).toHaveBeenCalledWith(
      TOPICS.SHARED_PAYMENT_EVENTS,
      expect.objectContaining({
        eventType: "shared.payment.call",
        environment: "test",
        lifecycle: expect.objectContaining({
          eventType: "payment.subscription.active",
          subscriptionId: "sub_123",
          customerId: "cus_123",
          priceId: "price_123",
          referenceId: "church_123_basic",
          status: "active",
          provider: "paymongo",
          providerMode: "test",
        }),
        redactions: expect.arrayContaining(["request.idempotencyKey"]),
      }),
      expect.any(Object),
    );
  });

  it("rejects caller-supplied live targets on test shared-service events", () => {
    const kafka = {
      publishNonBlocking: jest.fn(),
    };
    const publisher = new SharedServiceEventPublisher(kafka as any);

    expect(() =>
      publisher.publishSharedServiceCall({
        tribeId: "smoke-tribe",
        environment: "test",
        sharedServiceId: "payment",
        route: "/api/v1/shared/payment/checkout",
        method: "POST",
        statusCode: 201,
        ok: true,
        latencyMs: 84,
        requestBody: {
          environment: "live",
          targetEnvironment: "live",
        },
        responseBody: {
          data: {
            checkoutId: "chk_123",
            status: "created",
            providerMode: "test",
          },
        },
      }),
    ).toThrow("Shared-service event payload cannot override APICenter environment");
    expect(kafka.publishNonBlocking).not.toHaveBeenCalled();
  });
});