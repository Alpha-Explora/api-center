import { z } from "zod";

/** A payment event type a webhook can subscribe to; the gateway's catalogue follows the AsyncAPI contract. */
export const eventTypeSchema = z.object({ type: z.string(), title: z.string(), description: z.string() });
export type EventTypeDefinition = z.infer<typeof eventTypeSchema>;

/** The console's test event; it always reaches the endpoint, whatever the filter. */
export const TEST_EVENT_TYPE = "webhook.test";

/** Every type (no filter, so types added later are delivered too), or a chosen subset. */
export type EventTypeSelection = { all: true } | { all: false; types: string[] };

export const ALL_EVENT_TYPES: EventTypeSelection = { all: true };

/** The stored filter as a selection; an empty list means every type. */
export function selectionFrom(eventTypes: readonly string[]): EventTypeSelection {
  return eventTypes.length === 0 ? ALL_EVENT_TYPES : { all: false, types: [...eventTypes] };
}

/** Adds or removes one type, keeping catalogue order. */
export function toggleEventType(selection: EventTypeSelection, type: string, catalogue: readonly EventTypeDefinition[]): EventTypeSelection {
  const current = new Set(selection.all ? [] : selection.types);
  if (current.has(type)) current.delete(type);
  else current.add(type);
  return { all: false, types: catalogue.map((entry) => entry.type).filter((entry) => current.has(entry)) };
}

/** The body's `eventTypes`, or what is wrong with the selection. */
export function eventTypesBody(selection: EventTypeSelection): { ok: true; eventTypes: string[] } | { ok: false; error: string } {
  if (selection.all) return { ok: true, eventTypes: [] };
  if (selection.types.length === 0) return { ok: false, error: "Choose at least one event type, or deliver all of them." };
  return { ok: true, eventTypes: selection.types };
}

/** "All event types", "Payment intent failed", or "2 of 3 event types". */
export function eventTypesSummary(eventTypes: readonly string[], catalogue: readonly EventTypeDefinition[]): string {
  if (eventTypes.length === 0) return "All event types";
  if (eventTypes.length === 1) return catalogue.find((entry) => entry.type === eventTypes[0])?.title ?? eventTypes[0];
  return catalogue.length ? `${eventTypes.length} of ${catalogue.length} event types` : `${eventTypes.length} event types`;
}

/** Whether saving the selection changes the stored filter. */
export function selectionChanges(selection: EventTypeSelection, stored: readonly string[]): boolean {
  const body = eventTypesBody(selection);
  if (!body.ok) return true;
  return body.eventTypes.length !== stored.length || body.eventTypes.some((type, index) => type !== stored[index]);
}
