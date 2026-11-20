// The payment event types a destination can subscribe to. Kept in step with the messages of
// packages/contracts/apicenter-asyncapi.json (a unit test compares them).

import { ValidationError } from "@shared/errors";

export interface EventTypeDefinition {
  type: string;
  title: string;
  description: string;
}

export const PAYMENT_EVENT_TYPES: readonly EventTypeDefinition[] = [
  { type: "payment.checkout.paid", title: "Checkout paid", description: "A hosted checkout was paid." },
  { type: "payment.intent.paid", title: "Payment intent paid", description: "A payment intent was paid." },
  {
    type: "payment.intent.failed",
    title: "Payment intent failed",
    description: "The customer's attempt did not go through; create a new intent to let them retry.",
  },
];

/**
 * Validates a destination's event types and returns them de-duplicated in catalogue order. An empty
 * list means every type, including types added to the catalogue later.
 */
export function normalizeEventTypes(eventTypes: readonly string[]): string[] {
  const known = new Set(PAYMENT_EVENT_TYPES.map((definition) => definition.type));
  const unknown = eventTypes.filter((type) => !known.has(type));
  if (unknown.length) throw new ValidationError(`Unknown event type(s): ${[...new Set(unknown)].join(", ")}`);
  const chosen = new Set(eventTypes);
  return PAYMENT_EVENT_TYPES.map((definition) => definition.type).filter((type) => chosen.has(type));
}
