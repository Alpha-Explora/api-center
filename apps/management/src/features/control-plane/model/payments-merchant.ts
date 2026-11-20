import { z } from "zod";

/** Whether the organization is bound to APICenter's payments merchant (PAYMENTS_MERCHANT_ORGANIZATION_IDS). */
export const merchantBindingSchema = z.object({
  organizationId: z.string(),
  bound: z.boolean(),
  reason: z.string().nullable(),
});
export type MerchantBinding = z.infer<typeof merchantBindingSchema>;

export const MERCHANT_UNBOUND_REASON =
  "Payments can't be enabled: this organization has no approved payments merchant binding. Ask an APICenter platform operator to bind it.";

/**
 * What the payments row shows. An unbound organization cannot enable payments; one that already
 * has payments on without a binding is warned that every payment request is refused.
 */
export function paymentsMerchantState(binding: MerchantBinding | undefined, enabled: boolean) {
  if (!binding) return { canEnable: true, badge: null, warning: null };
  if (binding.bound) return { canEnable: true, badge: { tone: "success" as const, label: "Merchant bound" }, warning: null };
  return {
    canEnable: false,
    badge: { tone: "warning" as const, label: "No merchant" },
    warning: enabled ? "Payments is on, but this organization has no merchant binding, so every payment request is refused." : null,
  };
}
