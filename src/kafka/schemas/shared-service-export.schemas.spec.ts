import { SharedServiceExportEventSchema } from "./shared-service-export.schemas";

describe("SharedServiceExportEventSchema", () => {
  it("accepts a sanitized shared-service export event", () => {
    const result = SharedServiceExportEventSchema.safeParse({
      eventId: "evt_123",
      eventType: "shared.sms.call",
      tribeId: "smoke-tribe",
      sharedServiceId: "sms",
      route: "/api/v1/shared/sms/send",
      method: "POST",
      statusCode: 201,
      ok: true,
      latencyMs: 42,
      correlationId: "corr-123",
      request: {
        recipientHash:
          "sha256:5cc3f61180b52a2f19b951b2ec108a0250f0e3d0671c5ebaf35f2f2d97fd3f4d",
        hasMessage: true,
      },
      response: {
        messageId: "msg_123",
        status: "mock_sent",
      },
      redactions: ["request.to", "request.message"],
      timestamp: "2026-05-15T00:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown shared services", () => {
    const result = SharedServiceExportEventSchema.safeParse({
      eventId: "evt_123",
      eventType: "shared.unknown.call",
      tribeId: "smoke-tribe",
      sharedServiceId: "unknown",
      route: "/api/v1/shared/unknown/send",
      method: "POST",
      statusCode: 200,
      ok: true,
      latencyMs: 42,
      request: {},
      response: {},
      redactions: [],
      timestamp: "2026-05-15T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});
