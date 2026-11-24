import { z } from "zod";
import { ApiError } from "@/lib/api-center/client-core";
import { environmentKindSchema } from "./control-plane";

export const featureKeySchema = z.enum([
  "plan.upgrade", "payments.live", "payouts.sending", "payouts.merchant_account", "payouts.payee_wallets",
  "sms.sender", "email.sender", "sms.daily_limit", "sms.international",
]);
export type FeatureKey = z.infer<typeof featureKeySchema>;
export type FeatureChange = { feature: FeatureKey; change: Record<string, unknown> };

export const featureRequestSchema = z.object({
  id: z.string(), feature: featureKeySchema, change: z.record(z.string(), z.unknown()), reason: z.string(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]), requestedBy: z.string(),
  decisionNote: z.string().nullable(), createdAt: z.string(),
});
export const featureViewSchema = z.object({
  key: featureKeySchema, title: z.string(), description: z.string(), release: z.enum(["available", "pilot", "coming_soon"]),
  offered: z.boolean(), paused: z.boolean(), pending: featureRequestSchema.nullable(), last: featureRequestSchema.nullable(),
});
export type FeatureView = z.infer<typeof featureViewSchema>;

export function featureAccessState(view: FeatureView) {
  if (!view.offered) return "not_offered";
  if (view.pending) return "pending";
  if (view.release === "coming_soon") return "coming_soon";
  if (view.paused) return "paused";
  if (view.last?.status === "rejected") return "rejected";
  return "request";
}

export function approvalChange(error: unknown, change: Record<string, unknown>): FeatureChange | null {
  if (!(error instanceof ApiError) || error.code !== "FEATURE_APPROVAL_REQUIRED") return null;
  const details = z.object({ feature: featureKeySchema }).safeParse(error.details);
  if (!details.success) return null;
  const feature = details.data.feature;
  const requested = feature === "sms.daily_limit" ? { dailyLimit: change.dailyLimit }
    : feature === "sms.international" ? { prefixes: change.allowedPrefixes }
    : feature === "sms.sender" ? { senderId: change.senderId }
    : feature === "payments.live" ? {} : change;
  return { feature, change: requested };
}

export const projectPayoutFeatureSchema = z.enum(["payouts_sending", "payee_wallets"]);
export type ProjectPayoutFeature = z.infer<typeof projectPayoutFeatureSchema>;
export const pausedFeatureSchema = z.enum(["payouts_sending", "payee_wallets", "merchant_account"]);
export const featurePauseSchema = z.object({
  feature: pausedFeatureSchema, paused: z.boolean(), reason: z.string().nullable(),
  updatedBy: z.string().nullable(), updatedAt: z.string().nullable(),
});
export const operatorSchema = z.object({
  email: z.email(), source: z.enum(["configuration", "console"]), addedBy: z.string().nullable(), addedAt: z.string().nullable(),
});

export type FeatureScope = { organizationId: string; projectId: string; kind: z.infer<typeof environmentKindSchema> };
