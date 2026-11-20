import { z } from "zod";
import type { Tone } from "@/components/patterns/status-badge";

/** One delivery attempt the webhooks runtime made to the consumer's URL. */
export const webhookDeliverySchema = z.object({
  destinationId: z.string(),
  eventId: z.string(),
  eventType: z.string().nullable(),
  attempt: z.number(),
  outcome: z.enum(["delivered", "rejected", "unreachable", "no_active_secret", "disabled"]),
  statusCode: z.number().nullable(),
  latencyMs: z.number(),
  error: z.string().nullable(),
  attemptedAt: z.string(),
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const sentTestEventSchema = z.object({
  destinationId: z.string(),
  eventId: z.string(),
  eventType: z.string(),
  messageId: z.string(),
  sentAt: z.string(),
});
export type SentTestEvent = z.infer<typeof sentTestEventSchema>;

export const TEST_EVENT_TYPE = "webhook.test";

const OUTCOMES: Record<WebhookDelivery["outcome"], { label: string; tone: Tone }> = {
  delivered: { label: "Delivered", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  unreachable: { label: "Unreachable", tone: "danger" },
  no_active_secret: { label: "No signing secret", tone: "danger" },
  disabled: { label: "Dropped (disabled)", tone: "neutral" },
};

export function deliveryOutcome(delivery: Pick<WebhookDelivery, "outcome">) {
  return OUTCOMES[delivery.outcome];
}

/** What the endpoint answered, in a few words: "HTTP 204", or the connection error. */
export function deliveryResponse(delivery: Pick<WebhookDelivery, "statusCode" | "error" | "outcome">): string {
  if (delivery.statusCode !== null) return `HTTP ${delivery.statusCode}`;
  if (delivery.error) return delivery.error;
  if (delivery.outcome === "no_active_secret") return "Not sent: no active signing secret";
  if (delivery.outcome === "disabled") return "Not sent: destination disabled";
  return "No response";
}

export type TestEventProgress = { state: "waiting" } | { state: "delivered"; delivery: WebhookDelivery } | { state: "failing"; delivery: WebhookDelivery };

/**
 * Where a sent test event stands, from the delivery history: its newest attempt decides. Pub/Sub retries
 * a failed attempt with backoff, so "failing" can still turn into "delivered".
 */
export function testEventProgress(eventId: string, deliveries: WebhookDelivery[]): TestEventProgress {
  const latest = deliveries
    .filter((delivery) => delivery.eventId === eventId)
    .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt) || b.attempt - a.attempt)[0];
  if (!latest) return { state: "waiting" };
  return latest.outcome === "delivered" ? { state: "delivered", delivery: latest } : { state: "failing", delivery: latest };
}

/** Whether to keep polling while following a test event: until it is delivered. Nothing followed, nothing to poll. */
export function shouldPollForTestEvent(eventId: string | null, deliveries: WebhookDelivery[]): boolean {
  return eventId !== null && testEventProgress(eventId, deliveries).state !== "delivered";
}

/** How long the console keeps polling for a test event's first attempt before saying so. */
export const TEST_EVENT_WAIT_MS = 60_000;
