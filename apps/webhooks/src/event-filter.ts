// A destination may limit delivery to chosen event types (the gateway writes them into its config).
// Pub/Sub cannot change a subscription's filter after creation, so the filter is applied here, where
// editing it takes effect within the config cache window. A filtered event is acknowledged and dropped.
import type { DestinationConfig } from "./destination-store";

/** The console's "send test event" type: it always reaches the endpoint, whatever the filter. */
export const ALWAYS_DELIVERED_EVENT_TYPES: ReadonlySet<string> = new Set(["webhook.test"]);

/** Whether the event in `body` passes the destination's event-type filter. No filter delivers all. */
export function deliversEventType(config: Pick<DestinationConfig, "eventTypes">, body: string): boolean {
  if (!config.eventTypes?.length) return true;
  let eventType: unknown;
  try {
    eventType = (JSON.parse(body) as { eventType?: unknown }).eventType;
  } catch {
    return true; // Malformed bodies are reported by delivery, not hidden by the filter.
  }
  if (typeof eventType !== "string") return true;
  return ALWAYS_DELIVERED_EVENT_TYPES.has(eventType) || config.eventTypes.includes(eventType);
}
