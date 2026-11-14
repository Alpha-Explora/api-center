import { z } from 'zod';

// Contract 1.1 adds ownerGroupId and ownerProjectId; 1.0 events still parse. ownerTribeId is kept
// for 1.0 consumers and carries the same value as ownerGroupId.
const PaymentEventSchema = z.object({
  eventId: z.string().min(1), contractVersion: z.enum(['1.0', '1.1']), eventType: z.string().min(1),
  ownerTribeId: z.string().min(1), ownerGroupId: z.string().min(1).optional(), ownerProjectId: z.string().min(1).optional(),
  consumerServiceId: z.string().min(1), referenceId: z.string().min(1),
  aggregateType: z.enum(['checkout', 'payment_intent', 'refund', 'subscription', 'invoice']),
  aggregateId: z.string().min(1), aggregateVersion: z.number().int().min(1),
  occurredAt: z.string().datetime({ offset: true }), correlationId: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
}).superRefine((event, context) => {
  if (event.data.aggregateVersion !== undefined && event.data.aggregateVersion !== event.aggregateVersion) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'aggregateVersion'], message: 'data.aggregateVersion must match aggregateVersion' });
  }
});

export type PaymentEvent = z.infer<typeof PaymentEventSchema> & {
  /** Who owns the resource, whichever contract version delivered the event. */
  owner: { groupId: string; projectId?: string };
};
export function parsePaymentEvent(input: unknown): PaymentEvent {
  const event = PaymentEventSchema.parse(input);
  return {
    ...event,
    owner: { groupId: event.ownerGroupId ?? event.ownerTribeId, ...(event.ownerProjectId ? { projectId: event.ownerProjectId } : {}) },
  };
}
export { PaymentEventSchema };
