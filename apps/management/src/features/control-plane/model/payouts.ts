import { z } from "zod";

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
  type: z.enum(["instapay", "provider_wallet"]),
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
  createdAt: z.string(),
});
export type Payee = z.infer<typeof payeeSchema>;

export const payeeDetailSchema = payeeSchema.extend({
  earnings: z.object({ awaitingPayment: centavos, held: centavos, available: centavos, inFlight: centavos, paidThisWeek: centavos }),
});
export type PayeeDetail = z.infer<typeof payeeDetailSchema>;

export const pageSchema = <T extends z.ZodTypeAny>(item: T) => z.object({ records: z.array(item), nextCursor: z.string().optional() });

export const payoutOverviewSchema = z.object({
  wallet: z.object({ configured: z.boolean(), available: centavos.nullable(), lowFloatAlert: centavos }),
  counts: z.record(z.string(), z.number().int()),
  needsReview: z.array(payoutSchema),
  nextScheduledAt: z.string().nullable(),
});
export type PayoutOverview = z.infer<typeof payoutOverviewSchema>;

const bearer = z.enum(["platform", "payee"]);
export const payoutPolicySchema = z.object({
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
