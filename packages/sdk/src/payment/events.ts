import { z } from 'zod';

// Payment event contract 2.0. Every event names the organization, project and application it
// belongs to; contract 1.x fields (ownerTribeId, ownerGroupId, consumerServiceId) are gone.
const envelope = {
  eventId: z.string().min(1),
  contractVersion: z.literal('2.0'),
  environment: z.enum(['test', 'live']),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  applicationId: z.string().min(1),
  /** Your reference for the resource, such as the order ID you gave the checkout. */
  referenceId: z.string().min(1),
  aggregateId: z.string().min(1),
  /** Increases with every change to the resource; apply an event only if it is newer than what you stored. */
  aggregateVersion: z.number().int().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  correlationId: z.string().min(1).optional(),
};

const CheckoutPaidEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payment.checkout.paid'),
  aggregateType: z.literal('checkout'),
  data: z.object({
    status: z.literal('paid'),
    checkoutId: z.string().min(1),
    paymentId: z.string().min(1),
    /** In minor units (centavos for PHP). */
    amount: z.number().int().positive(),
    currency: z.string().length(3),
  }).passthrough(),
});

const intentPayment = {
  paymentIntentId: z.string().min(1),
  paymentId: z.string().min(1),
  /** In minor units (centavos for PHP). */
  amount: z.number().int().positive(),
  currency: z.string().length(3),
};

const IntentPaidEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payment.intent.paid'),
  aggregateType: z.literal('payment_intent'),
  data: z.object({ status: z.literal('succeeded'), ...intentPayment }).passthrough(),
});

/** The customer's attempt did not go through. Create a new intent, with a new idempotency key, to let them retry. */
const IntentFailedEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payment.intent.failed'),
  aggregateType: z.literal('payment_intent'),
  data: z.object({
    status: z.literal('failed'),
    ...intentPayment,
    failureCode: z.string().optional(),
    failureMessage: z.string().optional(),
  }).passthrough(),
});

/** An event type this SDK version does not know yet. Acknowledge it; upgrade to read it. */
const UnrecognizedEventSchema = z.object({
  ...envelope,
  eventType: z.string().min(1),
  aggregateType: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export type CheckoutPaidEvent = z.infer<typeof CheckoutPaidEventSchema>;
export type IntentPaidEvent = z.infer<typeof IntentPaidEventSchema>;
export type IntentFailedEvent = z.infer<typeof IntentFailedEventSchema>;
export type UnrecognizedPaymentEvent = Omit<z.infer<typeof UnrecognizedEventSchema>, 'eventType'> & {
  eventType: 'unrecognized';
  /** The event type as sent. */
  type: string;
};
/** Narrow on `eventType`: `if (event.eventType === 'payment.checkout.paid') { event.data.amount … }`. */
export type PaymentEvent = CheckoutPaidEvent | IntentPaidEvent | IntentFailedEvent | UnrecognizedPaymentEvent;

const KNOWN = {
  'payment.checkout.paid': CheckoutPaidEventSchema,
  'payment.intent.paid': IntentPaidEventSchema,
  'payment.intent.failed': IntentFailedEventSchema,
} as const;

/** Validates a contract 2.0 payment event. Throws a ZodError for anything malformed. */
export function parsePaymentEvent(input: unknown): PaymentEvent {
  const type = (input as { eventType?: unknown } | null)?.eventType;
  const known = typeof type === 'string' ? KNOWN[type as keyof typeof KNOWN] : undefined;
  if (known) return known.parse(input);
  const event = UnrecognizedEventSchema.parse(input);
  return { ...event, eventType: 'unrecognized', type: event.eventType };
}

export const PaymentEventSchema = z.union([CheckoutPaidEventSchema, IntentPaidEventSchema, IntentFailedEventSchema,
  UnrecognizedEventSchema]);
