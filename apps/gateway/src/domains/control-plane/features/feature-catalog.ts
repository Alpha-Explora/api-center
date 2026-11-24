import { z } from "zod";
import type { EnvironmentKind } from "../control-plane.types";

export const FEATURE_KEYS = [
  "plan.upgrade", "payments.live", "payouts.sending", "payouts.merchant_account", "payouts.payee_wallets",
  "sms.sender", "email.sender", "sms.daily_limit", "sms.international",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureRelease = "available" | "pilot" | "coming_soon";
export type FeatureContext = { environment: EnvironmentKind; current: Record<string, unknown> };

const environments: readonly EnvironmentKind[] = ["test", "live"];
const planKeys = ["starter", "standard", "pro", "enterprise"] as const;
const empty = z.strictObject({});
export const smsDailyLimit = z.number().int().min(1).max(2_147_483_647);
export const smsPrefixes = z.array(z.string().regex(/^\+[1-9]\d{0,3}$/)).min(1).max(100)
  .transform((prefixes) => [...new Set(prefixes)].sort());
export const SMS_DAILY_LIMIT_DEFAULT = 500;
export const SMS_DEFAULT_PREFIXES = ["+63"];

type Definition<C extends Record<string, unknown>> = {
  title: string;
  description: string;
  release: FeatureRelease;
  environments: readonly EnvironmentKind[];
  change: z.ZodType<C>;
  needsApproval(change: C, context: FeatureContext): boolean;
  summary(change: C): string;
};

function define<C extends Record<string, unknown>>(definition: Definition<C>) {
  return {
    ...definition,
    needsApproval: (change: unknown, context: FeatureContext) => definition.needsApproval(definition.change.parse(change), context),
    summary: (change: unknown) => definition.summary(definition.change.parse(change)),
  };
}

const available = { release: "available", environments } as const;
export const FEATURE_CATALOG = {
  "plan.upgrade": define({
    ...available, title: "Pro or Enterprise plan", description: "Use a higher service plan.",
    change: z.strictObject({ planKey: z.enum(planKeys) }),
    needsApproval: ({ planKey }, { current }) =>
      planKeys.indexOf(planKey) >= 2 && planKeys.indexOf(planKey) > planKeys.findIndex((key) => key === current.planKey),
    summary: ({ planKey }) => `Switch to the ${planKey} plan`,
  }),
  "payments.live": define({
    ...available, title: "Payments in live", description: "Use payments in the live environment.", environments: ["live"],
    change: empty, needsApproval: (_, { environment, current }) => environment === "live" && current.enabled !== true,
    summary: () => "Enable live payments",
  }),
  "payouts.sending": define({
    ...available, title: "Sending payouts", description: "Send payouts from your project's wallet.", release: "coming_soon",
    change: empty, needsApproval: (_, { environment, current }) => environment === "live" && current.enabled !== true,
    summary: () => "Enable payout transfers",
  }),
  "payouts.merchant_account": define({
    ...available, title: "Project merchant account", description: "Onboard a project-owned merchant account.", release: "coming_soon",
    change: empty, needsApproval: (_, { current }) => current.enabled !== true,
    summary: () => "Enable project merchant onboarding",
  }),
  "payouts.payee_wallets": define({
    release: "pilot", environments: ["test"], title: "Payee wallet onboarding", description: "Verify and activate test consumer wallets.",
    change: empty, needsApproval: (_, { current }) => current.enabled !== true,
    summary: () => "Enable test payee wallet onboarding",
  }),
  "sms.sender": define({
    ...available, title: "SMS sender ID", description: "Pin a sender ID for SMS messages.",
    change: z.strictObject({
      senderId: z.string().trim().regex(/^(?:\+[1-9]\d{6,14}|(?=[A-Za-z0-9 ]*[A-Za-z])[A-Za-z0-9 ]{1,11})$/),
    }),
    needsApproval: ({ senderId }, { environment, current }) => environment === "live" && senderId !== current.senderId,
    summary: ({ senderId }) => `Pin sender ID ${senderId}`,
  }),
  "email.sender": define({
    ...available, title: "Email sender", description: "Set a sender address or raise the email sending limit.",
    change: z.strictObject({ fromAddress: z.email().max(320), dailyLimit: smsDailyLimit.nullable() }),
    needsApproval: ({ fromAddress, dailyLimit }, { environment, current }) => {
      const previousLimit = current.dailyLimit ?? null;
      if (fromAddress === current.fromAddress && dailyLimit === previousLimit) return false;
      return environment === "live" || (dailyLimit !== null
        && (typeof current.defaultDailyLimit !== "number" || dailyLimit > current.defaultDailyLimit));
    },
    summary: ({ fromAddress, dailyLimit }) => `Send email from ${fromAddress}${dailyLimit === null ? "" : ` with a daily limit of ${dailyLimit}`}`,
  }),
  "sms.daily_limit": define({
    ...available, title: "Higher SMS limit", description: "Raise the daily SMS and OTP text limit.",
    change: z.strictObject({ dailyLimit: smsDailyLimit.nullable() }),
    needsApproval: ({ dailyLimit }, { current }) => dailyLimit !== null && dailyLimit !== current.dailyLimit
      && dailyLimit > (typeof current.defaultDailyLimit === "number" ? current.defaultDailyLimit : SMS_DAILY_LIMIT_DEFAULT),
    summary: ({ dailyLimit }) => `Set daily SMS limit to ${dailyLimit ?? SMS_DAILY_LIMIT_DEFAULT}`,
  }),
  "sms.international": define({
    ...available, title: "SMS to other countries", description: "Send SMS and OTP texts to additional countries.",
    change: z.strictObject({ prefixes: smsPrefixes }),
    needsApproval: ({ prefixes }, { current }) => {
      const allowed = Array.isArray(current.prefixes) ? current.prefixes : SMS_DEFAULT_PREFIXES;
      return prefixes.some((prefix) => !SMS_DEFAULT_PREFIXES.includes(prefix) && !allowed.includes(prefix));
    },
    summary: ({ prefixes }) => `Allow SMS to ${prefixes.join(", ")}`,
  }),
};

export const featureKeySchema = z.enum(FEATURE_KEYS);

export function featureDefinition(key: string) {
  const parsed = featureKeySchema.safeParse(key);
  return parsed.success ? FEATURE_CATALOG[parsed.data] : undefined;
}
