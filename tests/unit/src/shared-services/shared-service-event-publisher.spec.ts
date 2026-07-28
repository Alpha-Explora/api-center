import { SharedServiceEventPublisher } from "../../../../apps/gateway/src/shared-services/shared-service-event-publisher";

describe("SharedServiceEventPublisher", () => {
  beforeEach(() => {
    process.env.SHARED_SERVICE_PUBSUB_ENABLED = "true";
  });

  afterEach(() => {
    delete process.env.SHARED_SERVICE_PUBSUB_ENABLED;
    delete process.env.APICENTER_SHARED_SERVICE_EVENTS_TOPIC_TEST;
    delete process.env.APICENTER_SHARED_SERVICE_EVENTS_TOPIC_LIVE;
  });

  it("publishes sanitized shared-service calls to the Pub/Sub topic", () => {
    const publishMessage = jest.fn().mockResolvedValue("message-123");
    const pubsub = { topic: jest.fn(() => ({ publishMessage })) };
    process.env.APICENTER_SHARED_SERVICE_EVENTS_TOPIC_TEST =
      "apicenter.shared-service-events.test";
    const publisher = new SharedServiceEventPublisher(pubsub as any);

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
      requestBody: { to: "+639171234567", message: "Your OTP is 123456" },
      responseBody: { data: { messageId: "msg_123", status: "mock_sent" } },
    });

    expect(pubsub.topic).toHaveBeenCalledWith(
      "apicenter.shared-service-events.test",
    );
    expect(publishMessage).toHaveBeenCalledWith({
      json: expect.objectContaining({
        eventId: expect.any(String),
        eventType: "shared.sms.call",
        tribeId: "smoke-tribe",
        environment: "test",
        sharedServiceId: "sms",
        request: expect.objectContaining({
          recipientHash: expect.stringMatching(/^sha256:/),
        }),
        response: expect.objectContaining({ messageId: "msg_123" }),
      }),
      attributes: {
        eventType: "shared.sms.call",
        environment: "test",
        sharedServiceId: "sms",
        tribeId: "smoke-tribe",
        correlationId: "corr-123",
      },
    });
  });

  it("skips unknown shared-service IDs", () => {
    const pubsub = { topic: jest.fn() };
    const publisher = new SharedServiceEventPublisher(pubsub as any);

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

    expect(pubsub.topic).not.toHaveBeenCalled();
  });

  it("publishes payment telemetry through Pub/Sub with sensitive fields redacted", () => {
    const publishMessage = jest.fn().mockResolvedValue("message-123");
    const pubsub = { topic: jest.fn(() => ({ publishMessage })) };
    const publisher = new SharedServiceEventPublisher(pubsub as any);

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

    expect(publishMessage).toHaveBeenCalledWith({
      json: expect.objectContaining({
        eventType: "shared.payment.call",
        environment: "test",
        redactions: expect.arrayContaining(["request.idempotencyKey"]),
      }),
      attributes: expect.objectContaining({
        eventType: "shared.payment.call",
        environment: "test",
        sharedServiceId: "payment",
      }),
    });
  });

  it("rejects caller-supplied live targets on test shared-service events", () => {
    const pubsub = { topic: jest.fn() };
    const publisher = new SharedServiceEventPublisher(pubsub as any);

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
        requestBody: { environment: "live", targetEnvironment: "live" },
      }),
    ).toThrow(
      "Shared-service event payload cannot override APICenter environment",
    );
    expect(pubsub.topic).not.toHaveBeenCalled();
  });
});
