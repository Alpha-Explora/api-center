import { z } from 'zod';

const PaymentEventSchema = z.object({
  eventId: z.string().min(1), contractVersion: z.literal('1.0'), eventType: z.string().min(1),
  ownerTribeId: z.string().min(1), consumerServiceId: z.string().min(1), referenceId: z.string().min(1),
  aggregateType: z.enum(['checkout', 'payment_intent', 'refund', 'subscription', 'invoice']),
  aggregateId: z.string().min(1), aggregateVersion: z.number().int().min(1),
  occurredAt: z.string().datetime({ offset: true }), correlationId: z.string().min(1).optional(),
  data: z.record(z.string(), z.unknown()),
}).superRefine((event, context) => {
  if (event.data.aggregateVersion !== undefined && event.data.aggregateVersion !== event.aggregateVersion) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['data', 'aggregateVersion'], message: 'data.aggregateVersion must match aggregateVersion' });
  }
});

export type PaymentEvent = z.infer<typeof PaymentEventSchema>;
export function parsePaymentEvent(input: unknown): PaymentEvent { return PaymentEventSchema.parse(input); }
export { PaymentEventSchema };
