import { z } from "zod";
import { quotaModeSchema, quotaScopeSchema } from "./schemas";

export const quotaPolicyInputSchema = z
  .object({
    id: z.string().optional(),
    /** With projectId: that project's budget. Without it: a tribe-wide ceiling for ownerTribeId. */
    projectId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    ownerTribeId: z
      .string()
      .trim()
      .min(1)
      .optional()
      .or(z.literal("").transform(() => undefined)),
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
    if (!input.projectId && !input.ownerTribeId) {
      context.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Choose a project for a project budget, or a tribe for a tribe-wide ceiling",
      });
    }
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
