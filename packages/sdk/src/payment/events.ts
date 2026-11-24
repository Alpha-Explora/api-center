import type { PayeeOnboardingStatus } from '@alpha-explora/apicenter-contracts';
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

/** A payee's share of a payment was confirmed and is held until you release it. referenceId is the payment's reference. */
const AllocationHeldEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payment.allocation.held'),
  aggregateType: z.literal('allocation'),
  data: z.object({
    status: z.literal('held'),
    allocationId: z.string().min(1),
    payeeId: z.string().min(1),
    paymentId: z.string().min(1),
    /** In minor units (centavos for PHP). */
    amount: z.number().int().positive(),
    currency: z.string().length(3),
  }).passthrough(),
});

const payout = {
  payoutId: z.string().min(1),
  payeeId: z.string().min(1),
  /** What the payee receives, in minor units. */
  net: z.number().int().positive(),
  /** The transfer fee, in minor units; deducted from net only when the payee bears it. */
  fee: z.number().int().nonnegative(),
  currency: z.string().length(3),
  trigger: z.enum(['schedule', 'release', 'cash_out']),
};

/** The transfer reached the payee. referenceId is the payee's externalRef. */
const PayoutPaidEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payment.payout.paid'),
  aggregateType: z.literal('payout'),
  data: z.object({ status: z.literal('paid'), ...payout }).passthrough(),
});

/** The transfer did not go through; the earnings return to the payee's balance for a later payout. */
const PayoutFailedEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payment.payout.failed'),
  aggregateType: z.literal('payout'),
  data: z.object({ status: z.literal('failed'), ...payout, failureCode: z.string().optional() }).passthrough(),
});

/** A payee's wallet onboarding status changed. referenceId is the payee's externalRef. */
const PayeeOnboardingUpdatedEventSchema = z.object({
  ...envelope,
  eventType: z.literal('payee.onboarding.updated'),
  environment: z.literal('test'),
  aggregateType: z.literal('payee_onboarding'),
  data: z.object({
    status: z.enum(['draft', 'created', 'details_submitted', 'verification_pending',
      'verification_failed', 'manual_review', 'activation_pending', 'active', 'declined']) satisfies z.ZodType<PayeeOnboardingStatus>,
    payeeId: z.string().regex(/^pye_[A-Za-z0-9]+$/),
    onboardingId: z.string().regex(/^lac_[A-Za-z0-9]+$/),
    attempts: z.number().int().nonnegative(),
  }),
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
export type AllocationHeldEvent = z.infer<typeof AllocationHeldEventSchema>;
export type PayoutPaidEvent = z.infer<typeof PayoutPaidEventSchema>;
export type PayoutFailedEvent = z.infer<typeof PayoutFailedEventSchema>;
export type PayeeOnboardingUpdatedEvent = z.infer<typeof PayeeOnboardingUpdatedEventSchema>;
export type UnrecognizedPaymentEvent = Omit<z.infer<typeof UnrecognizedEventSchema>, 'eventType'> & {
  eventType: 'unrecognized';
  /** The event type as sent. */
  type: string;
};
/** Narrow on `eventType`: `if (event.eventType === 'payment.checkout.paid') { event.data.amount … }`. */
export type PaymentEvent = CheckoutPaidEvent | IntentPaidEvent | IntentFailedEvent | AllocationHeldEvent | PayoutPaidEvent
  | PayoutFailedEvent | PayeeOnboardingUpdatedEvent | UnrecognizedPaymentEvent;

const KNOWN = {
  'payment.checkout.paid': CheckoutPaidEventSchema,
  'payment.intent.paid': IntentPaidEventSchema,
  'payment.intent.failed': IntentFailedEventSchema,
  'payment.allocation.held': AllocationHeldEventSchema,
  'payment.payout.paid': PayoutPaidEventSchema,
  'payment.payout.failed': PayoutFailedEventSchema,
  'payee.onboarding.updated': PayeeOnboardingUpdatedEventSchema,
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
  AllocationHeldEventSchema, PayoutPaidEventSchema, PayoutFailedEventSchema, PayeeOnboardingUpdatedEventSchema,
  UnrecognizedEventSchema]);
