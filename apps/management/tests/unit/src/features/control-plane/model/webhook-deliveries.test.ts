import { describe, expect, it } from "vitest";
import {
  deliveryResponse,
  shouldPollForTestEvent,
  testEventProgress,
  webhookDeliverySchema,
  type WebhookDelivery,
} from "@/features/control-plane/model/webhook-deliveries";

const attempt = (overrides: Partial<WebhookDelivery>): WebhookDelivery => ({
  destinationId: "dst_abcdefghijklmnopqrstuvwx",
  eventId: "evt_test",
  eventType: "webhook.test",
  attempt: 1,
  outcome: "delivered",
  statusCode: 204,
  latencyMs: 80,
  error: null,
  attemptedAt: "2026-11-20T00:00:01.000Z",
  ...overrides,
});

describe("webhook deliveries", () => {
  it("waits until an attempt for the test event is recorded", () => {
    expect(testEventProgress("evt_test", [attempt({ eventId: "evt_other" })])).toEqual({ state: "waiting" });
  });

  it("follows the newest attempt, so a retry that succeeds reads as delivered", () => {
    const failed = attempt({ outcome: "rejected", statusCode: 500, attemptedAt: "2026-11-20T00:00:01.000Z" });
    expect(testEventProgress("evt_test", [failed])).toMatchObject({ state: "failing", delivery: failed });
    const retried = attempt({ attempt: 2, attemptedAt: "2026-11-20T00:00:11.000Z" });
    expect(testEventProgress("evt_test", [failed, retried])).toMatchObject({ state: "delivered", delivery: retried });
  });

  it("polls only while a followed test event is not yet delivered", () => {
    expect(shouldPollForTestEvent(null, [])).toBe(false);
    expect(shouldPollForTestEvent("evt_test", [])).toBe(true);
    expect(shouldPollForTestEvent("evt_test", [attempt({ outcome: "rejected", statusCode: 500 })])).toBe(true);
    expect(shouldPollForTestEvent("evt_test", [attempt({})])).toBe(false);
  });

  it("describes what the endpoint answered", () => {
    expect(deliveryResponse(attempt({}))).toBe("HTTP 204");
    expect(deliveryResponse(attempt({ outcome: "unreachable", statusCode: null, error: "connect ETIMEDOUT" }))).toBe("connect ETIMEDOUT");
    expect(deliveryResponse(attempt({ outcome: "no_active_secret", statusCode: null }))).toBe("Not sent: no active signing secret");
  });

  it("parses the gateway's delivery shape and rejects unknown outcomes", () => {
    expect(webhookDeliverySchema.parse(attempt({}))).toEqual(attempt({}));
    expect(webhookDeliverySchema.safeParse({ ...attempt({}), outcome: "teleported" }).success).toBe(false);
  });
});
