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
  timestamp: z.string().datetime(),
});

export type SharedServiceId = z.infer<typeof SharedServiceIdSchema>;
export type SharedServiceExportEvent = z.infer<
  typeof SharedServiceExportEventSchema
>;
