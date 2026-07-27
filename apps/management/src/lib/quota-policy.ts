import { z } from "zod";
import { quotaModeSchema, quotaScopeSchema } from "./schemas";

export const quotaPolicyInputSchema = z
  .object({
    id: z.string().optional(),
    ownerTribeId: z.string().trim().min(1),
    scope: quotaScopeSchema,
    targetServiceId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    windowSeconds: z.number().int().positive(),
    maxRequests: z.number().int().positive(),
    burstRequests: z.number().int().positive().optional().nullable(),
    mode: quotaModeSchema.default("observe"),
    reason: z.string().trim().min(1),
  })
  .superRefine((input, context) => {
    if (
      input.burstRequests !== undefined &&
      input.burstRequests !== null &&
      input.burstRequests < input.maxRequests
    ) {
      context.addIssue({
        code: "custom",
        path: ["burstRequests"],
        message: "Burst requests must be greater than or equal to max requests",
      });
    }
  });

export type QuotaPolicyInput = z.input<typeof quotaPolicyInputSchema>;
