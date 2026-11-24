import { z } from "zod";

export const onboardingSchema = z.object({
  id: z.string(),
  status: z.enum(["draft", "created", "details_submitted", "verification_pending", "verification_failed",
    "manual_review", "activation_pending", "active", "declined"]),
  nextAction: z.enum(["create", "submit_details", "issue_verification_link", "await_verification", "reissue_verification_link",
    "activate", "await_activation", "request_payment_methods", "await_manual_review", "none"]),
  attempts: z.number(),
  walletOnly: z.boolean(),
  declineReason: z.string().nullable(),
  verification: z.object({ url: z.url({ protocol: /^https$/ }), expiresAt: z.string() }).nullable(),
});

export const linkedAccountSchema = z.object({
  environmentEnabled: z.boolean(),
  projectEnabled: z.boolean(),
  providerAvailable: z.boolean(),
  collectionMoveAvailable: z.boolean(),
  onboarding: onboardingSchema.nullable(),
});

export type LinkedMerchantDetails = {
  businessName: string;
  tin: string;
  expectedMonthlyVolume: number;
  representative: { email: string; firstName: string; lastName: string };
};

export type LinkedAccountAction =
  | { kind: "enabled"; enabled: boolean }
  | { kind: "start"; details: LinkedMerchantDetails }
  | { kind: "verification-link"; id: string; requestKey: string }
  | { kind: "advance" | "close"; id: string }
  | { kind: "move"; id: string; target: "child" | "parent" };

// Payouts as the payments runtime reports them through the gateway's console routes. Amounts are
// whole centavos; payee account numbers arrive masked to their last four digits.

const centavos = z.number().int();

export const PAYOUT_STATUSES = ["draft", "submitting", "pending", "unknown", "paid", "failed", "needs_review"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const payoutSchema = z.object({
  id: z.string(),
  payeeId: z.string(),
  gross: centavos,
  fee: centavos,
  net: centavos,
  trigger: z.enum(["schedule", "release", "cash_out"]),
  status: z.enum(PAYOUT_STATUSES),
  failureCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});
export type Payout = z.infer<typeof payoutSchema>;

export const payeeDestinationSchema = z.object({
  type: z.enum(["instapay", "wallet", "provider_wallet"]),
  bic: z.string().optional(),
  accountName: z.string(),
  accountNumberLast4: z.string(),
});

export const payeeSchema = z.object({
  id: z.string(),
  externalRef: z.string(),
  legalName: z.string(),
  status: z.enum(["active", "suspended"]),
  destination: payeeDestinationSchema.nullable(),
  destinationHoldUntil: z.string().nullable(),
  verification: z.object({
    verifiedBy: z.string(),
    verifiedAt: z.string(),
    method: z.enum(["government_id", "in_person", "third_party", "other"]),
    reference: z.string().nullable(),
  }).nullable().default(null),
  createdAt: z.string(),
});
export type Payee = z.infer<typeof payeeSchema>;

export const payeeDetailSchema = payeeSchema.extend({
  earnings: z.object({ awaitingPayment: centavos, held: centavos, settling: centavos.default(0), available: centavos,
    inFlight: centavos, paidThisWeek: centavos }),
});
export type PayeeDetail = z.infer<typeof payeeDetailSchema>;

export const pageSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ records: z.array(item), nextCursor: z.string().optional() });

export const featureAvailabilitySchema = z.object({ available: z.boolean(), reason: z.string().nullable() });
export type FeatureAvailability = z.infer<typeof featureAvailabilitySchema>;

const notYet = { available: false, reason: "not_enabled" };
/** What the payouts area can do right now. A runtime that predates this reports nothing; assume the safe answer. */
export const payoutAvailabilitySchema = z.object({
  transfers: featureAvailabilitySchema,
  linkedAccounts: featureAvailabilitySchema,
  payeeWallets: featureAvailabilitySchema,
});
export type PayoutAvailability = z.infer<typeof payoutAvailabilitySchema>;

/** What to tell a project about a feature that is not available yet. */
export function availabilityMessage(feature: keyof PayoutAvailability, availability: FeatureAvailability): string | null {
  if (availability.available) return null;
  if (availability.reason === "paused") return "Paused by APICenter.";
  switch (feature) {
    case "transfers":
      return availability.reason === "not_enabled" || availability.reason === "live_payouts_disabled"
        ? "Sending live payouts is coming soon. Payees, shares and earnings are recorded now and are paid once live payouts open."
        : "Sending payouts is coming soon in this environment. Payees, shares and earnings are recorded now; payouts start once an operator sets the payout wallet (“Before the first payout” in the payouts runbook).";
    case "linkedAccounts":
      return "A merchant account of the project's own, which collects payments in the project's name, is coming soon. Payments are collected through APICenter's account until then.";
    case "payeeWallets":
      return availability.reason === "test_only"
        ? "Payee wallets are in a test pilot and are not available in live."
        : "Payee wallets, with a hosted identity check, are coming soon. Pay payees through InstaPay or a wallet number until then.";
  }
}

export const payoutOverviewSchema = z.object({
  wallet: z.object({ configured: z.boolean(), available: centavos.nullable(), lowFloatAlert: centavos }),
  wallets: z.array(z.object({ accountId: z.string(), configured: z.boolean(), available: centavos.nullable(),
    lowFloatAlert: centavos, collectedCentavos: centavos })).default([]),
  counts: z.record(z.string(), z.number().int()),
  needsReview: z.array(payoutSchema),
  nextScheduledAt: z.string().nullable(),
  availability: payoutAvailabilitySchema.default({
    transfers: { available: true, reason: null }, linkedAccounts: notYet, payeeWallets: notYet,
  }),
});
export type PayoutOverview = z.infer<typeof payoutOverviewSchema>;

const bearer = z.enum(["platform", "payee"]);
export const payoutPolicySchema = z.object({
  settlementHoldDays: z.number().int().min(0).max(30).default(7),
  requirePayeeVerification: z.boolean().default(false),
  schedule: z.object({ weekday: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23) }).nullable(),
  immediate: z.boolean(),
  thresholdCentavos: centavos.nullable(),
  onDemand: z.object({ minimum: centavos, dailyCap: centavos }).nullable(),
  feeBearer: z.object({ scheduled: bearer, cashOut: bearer }),
  minimumPayout: centavos,
  transferFee: centavos,
});
export type PayoutPolicy = z.infer<typeof payoutPolicySchema>;

/** Resolving payouts and the payout settings move the platform's money, so only platform operators change them. */
export const PAYOUT_OPERATOR_REASON = "Only APICenter platform operators can resolve payouts or change payout settings.";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 72_500 -> "₱725.00". */
export function formatCentavos(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}₱${(Math.abs(value) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Pesos typed into a form, as centavos; undefined when it is not a non-negative amount with at most two decimals. */
export function parsePesos(value: string): number | undefined {
  const trimmed = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * 100);
}

export function describeDestination(destination: Payee["destination"]): string {
  if (!destination) return "Not set";
  const where = destination.type === "instapay" ? (destination.bic === "GXCHPHM2XXX" ? "GCash" : `Bank ${destination.bic ?? ""}`.trim()) : "Wallet";
  return `${where} •••• ${destination.accountNumberLast4}`;
}

/** "Friday 8:00 PM". */
export function describeSchedule(schedule: PayoutPolicy["schedule"]): string {
  if (!schedule) return "No weekly payout";
  const hour = schedule.hour % 12 === 0 ? 12 : schedule.hour % 12;
  return `${WEEKDAYS[schedule.weekday]} ${hour}:00 ${schedule.hour < 12 ? "AM" : "PM"}`;
}

export const TRIGGER_LABELS: Record<Payout["trigger"], string> = { schedule: "Weekly", release: "On release", cash_out: "Cash-out" };
