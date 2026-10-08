import { z } from "zod";

export const quotaScopeSchema = z.enum([
  "all",
  "shared",
  "tribe",
  "kafka_publish",
]);

export const quotaModeSchema = z.enum(["observe", "enforce"]);
export const quotaStatusSchema = z.enum(["active", "disabled"]);
export const quotaUsageOutcomeSchema = z.enum([
  "allowed",
  "observed_exceeded",
  "blocked",
]);
export const quotaUsageWindowSchema = z.enum(["1h", "24h", "7d", "30d"]);

export const quotaPolicySchema = z.object({
  id: z.string(),
  ownerTribeId: z.string(),
  /** Null for a tribe-wide ceiling. */
  projectId: z.string().nullable().optional(),
  level: z.enum(["project", "tribe"]).optional(),
  scope: quotaScopeSchema,
  targetServiceId: z.string().nullable().optional(),
  windowSeconds: z.number().int().positive(),
  maxRequests: z.number().int().positive(),
  burstRequests: z.number().int().positive().nullable().optional(),
  mode: quotaModeSchema,
  status: quotaStatusSchema,
  reason: z.string(),
  updatedAt: z.string(),
});

export const quotaPolicyListResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(quotaPolicySchema),
  meta: z
    .object({
      total: z.number().optional(),
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const quotaPolicyDetailResponseSchema = z.object({
  success: z.boolean(),
  data: quotaPolicySchema,
  meta: z
    .object({
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const quotaUsageDecisionSchema = z.object({
  id: z.string(),
  ownerTribeId: z.string(),
  projectId: z.string().nullable().optional(),
  policyId: z.string().nullable().optional(),
  scope: quotaScopeSchema,
  targetServiceId: z.string().nullable().optional(),
  routeFamily: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  requestCount: z.number().int().nonnegative(),
  maxRequests: z.number().int().positive(),
  mode: quotaModeSchema,
  outcome: quotaUsageOutcomeSchema,
  estimatedChargeback: z
    .object({
      apiCallCost: z.number(),
      kafkaPublishCost: z.number(),
      analyticsScanCost: z.number(),
      totalCost: z.number(),
    })
    .optional(),
  forecast: z
    .object({
      status: z.enum(["normal", "warning"]),
      daysUntilExhaustion: z.number().nullable(),
      projectedMonthlyUsage: z.number(),
    })
    .optional(),
  correlationId: z.string().nullable().optional(),
  createdAt: z.string(),
});

export const quotaUsageResponseSchema = z.object({
  success: z.boolean(),
  data: z.array(quotaUsageDecisionSchema),
  meta: z
    .object({
      total: z.number().optional(),
      window: quotaUsageWindowSchema.optional(),
      timestamp: z.string().optional(),
      correlationId: z.string().optional(),
    })
    .optional(),
});

export const quotaIncreaseRequestInputSchema = z.object({
  ownerTribeId: z.string().min(1),
  /** Set to raise one project's budget; omit to raise the tribe-wide ceiling. */
  projectId: z.string().min(1).optional(),
  requestedMaxRequests: z.number().int().positive(),
  reason: z.string().min(1),
});

export const quotaIncreaseRequestResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    id: z.string().optional(),
    actionType: z.string(),
    status: z.string(),
  }),
});

export type QuotaScope = z.infer<typeof quotaScopeSchema>;
export type QuotaMode = z.infer<typeof quotaModeSchema>;
export type QuotaStatus = z.infer<typeof quotaStatusSchema>;
export type QuotaUsageWindow = z.infer<typeof quotaUsageWindowSchema>;
export type QuotaPolicy = z.infer<typeof quotaPolicySchema>;
export type QuotaUsageDecision = z.infer<typeof quotaUsageDecisionSchema>;
export type QuotaIncreaseRequestInput = z.infer<
  typeof quotaIncreaseRequestInputSchema
>;
