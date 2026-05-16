import { z } from "zod";

export const SharedServiceIdSchema = z.enum([
  "sms",
  "email",
  "payment",
  "otp",
  "geo",
  "gauth",
]);

export const SharedServiceExportEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  tribeId: z.string().min(1),
  sharedServiceId: SharedServiceIdSchema,
  route: z.string().min(1),
  method: z.string().min(1),
  statusCode: z.number().int(),
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  correlationId: z.string().optional(),
  request: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()),
  redactions: z.array(z.string()),
  lifecycle: z
    .object({
      eventType: z
        .enum([
          "payment.checkout.created",
          "payment.checkout.paid",
          "payment.checkout.failed",
          "payment.checkout.cancelled",
          "payment.checkout.expired",
          "payment.refunded",
          "payment.refund.updated",
        ])
        .or(z.string().min(1)),
      checkoutId: z.string().optional(),
      paymentId: z.string().optional(),
      refundId: z.string().optional(),
      referenceId: z.string().optional(),
      status: z
        .enum([
          "created",
          "pending",
          "paid",
          "failed",
          "cancelled",
          "expired",
          "refunded",
          "partially_refunded",
        ])
        .or(z.string().min(1))
        .optional(),
      amount: z.number().int().optional(),
      currency: z.string().optional(),
      provider: z.string().optional(),
      providerMode: z.enum(["test", "live"]).optional(),
    })
    .optional(),
  timestamp: z.string().datetime(),
});

export type SharedServiceId = z.infer<typeof SharedServiceIdSchema>;
export type SharedServiceExportEvent = z.infer<
  typeof SharedServiceExportEventSchema
>;
