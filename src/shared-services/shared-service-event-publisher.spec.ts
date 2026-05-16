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
        key: "smoke-tribe:sms",
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
      sharedServiceId: "unknown",
      route: "/api/v1/shared/unknown/send",
      method: "POST",
      statusCode: 200,
      ok: true,
      latencyMs: 42,
    });

    expect(kafka.publishNonBlocking).not.toHaveBeenCalled();
  });
});
