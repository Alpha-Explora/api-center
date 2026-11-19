// Turns one Pub/Sub push into one signed POST to the destination's URL. Pub/Sub retries anything
// not acknowledged (with backoff, then dead-letter), so this answers "ack" only when the consumer
// returned 2xx, or when the destination was disabled and the event should be dropped.
import { activeSecrets, DESTINATION_ID, type DestinationStore } from "./destination-store";
import type { Sender } from "./send";
import { signatureHeader } from "./signature";

export interface PushEnvelope {
  message?: { data?: string; attributes?: Record<string, string>; messageId?: string };
  deliveryAttempt?: number;
  subscription?: string;
}

export type DeliveryOutcome =
  | { ack: true; reason: "delivered" | "disabled"; eventId?: string; status?: number }
  | {
      ack: false;
      reason: "unknown_destination" | "malformed_message" | "no_active_secret" | "rejected" | "unreachable";
      eventId?: string;
      status?: number;
      error?: string;
    };

export async function deliver(
  destinationId: string,
  push: PushEnvelope,
  deps: { store: DestinationStore; send: Sender; now?: () => number },
): Promise<DeliveryOutcome> {
  if (!DESTINATION_ID.test(destinationId)) return { ack: false, reason: "unknown_destination" };
  const config = await deps.store.get(destinationId);
  if (!config) return { ack: false, reason: "unknown_destination" };

  const encoded = push.message?.data;
  const body = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  let eventId: string | undefined;
  try {
    eventId = (JSON.parse(body) as { eventId?: unknown }).eventId as string | undefined;
  } catch {
    // Left undefined; reported below.
  }
  if (typeof eventId !== "string" || !eventId) return { ack: false, reason: "malformed_message" };
  if (config.disabled) return { ack: true, reason: "disabled", eventId };

  const now = (deps.now ?? Date.now)();
  const secrets = activeSecrets(config, now);
  if (secrets.length === 0) return { ack: false, reason: "no_active_secret", eventId };
  const timestamp = Math.floor(now / 1000);
  const headers = {
    "content-type": "application/json",
    "user-agent": "APICenter-Webhooks/1.0",
    "webhook-id": eventId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": signatureHeader(secrets, eventId, timestamp, body),
    "apicenter-delivery-attempt": String(push.deliveryAttempt ?? 1),
  };

  try {
    const { status } = await deps.send(config.url, headers, body);
    return status >= 200 && status < 300
      ? { ack: true, reason: "delivered", eventId, status }
      : { ack: false, reason: "rejected", eventId, status };
  } catch (error) {
    return { ack: false, reason: "unreachable", eventId, error: (error as Error).message.slice(0, 300) };
  }
}
