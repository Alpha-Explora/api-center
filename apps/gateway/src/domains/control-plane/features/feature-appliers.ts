import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { BadGatewayError } from "@shared/errors";
import { CapabilityConfigurationService } from "../capability-configuration.service";
import { ControlPlaneAdminService, type EnvironmentScope } from "../control-plane-admin.service";
import { PaymentsRuntimeClient } from "../payments-runtime.client";
import { QuotaService } from "../quota.service";
import { FEATURE_CATALOG, type FeatureKey } from "./feature-catalog";

export const PAYMENT_FEATURE_PATHS = {
  "payouts.sending": "/admin/payouts/project-features/payouts_sending",
  "payouts.payee_wallets": "/admin/payouts/project-features/payee_wallets",
  "payouts.merchant_account": "/admin/payouts/linked-account/enabled",
} as const;

const settingsRecord = z.record(z.string(), z.unknown());
export async function currentConfiguration(configuration: CapabilityConfigurationService, scope: EnvironmentScope,
  capability: "sms" | "otp" | "email", actor: string): Promise<Record<string, unknown>> {
  const result = settingsRecord.safeParse(await configuration.configure(scope, capability, "GET", undefined, actor));
  if (!result.success) throw new BadGatewayError("The runtime returned invalid settings");
  const defaults = settingsRecord.safeParse(result.data.defaults);
  return { ...result.data, defaultDailyLimit: defaults.success ? defaults.data.dailyLimit : result.data.defaultDailyLimit,
    prefixes: result.data.allowedPrefixes ?? null };
}

@Injectable()
export class FeatureAppliers {
  constructor(private readonly quotas: QuotaService, private readonly admin: ControlPlaneAdminService,
    private readonly configuration: CapabilityConfigurationService, private readonly payments: PaymentsRuntimeClient) {}

  async apply(scope: EnvironmentScope, feature: FeatureKey, change: unknown, actor: string) {
    if (feature === "plan.upgrade") {
      const input = FEATURE_CATALOG[feature].change.parse(change);
      let before: string | null = null;
      await this.quotas.assignPlan(scope, input.planKey, actor, (current) => { before = current; });
      return { before: { planKey: before }, after: input };
    }
    if (feature === "payments.live") {
      let before = false;
      await this.admin.setCapability(scope, "payments", true, actor, (enabled) => { before = enabled; });
      return { before: { enabled: before }, after: { enabled: true } };
    }
    if (feature === "payouts.sending" || feature === "payouts.payee_wallets" || feature === "payouts.merchant_account") {
      const readPath = feature === "payouts.merchant_account" ? "/admin/payouts/linked-account" : PAYMENT_FEATURE_PATHS[feature];
      const state = z.object({ data: z.object({ enabled: z.boolean().optional(), projectEnabled: z.boolean().optional() }) })
        .safeParse(await this.payments.call(scope, "payments:payouts:read", "GET", readPath));
      if (!state.success) throw new BadGatewayError("The payment runtime returned invalid feature settings");
      const enabled = state.data.data.enabled ?? state.data.data.projectEnabled ?? false;
      await this.payments.call(scope, "payments:payouts:write", "PUT", PAYMENT_FEATURE_PATHS[feature], { enabled: true, actor });
      return { before: { enabled }, after: { enabled: true } };
    }
    if (feature === "sms.sender" || feature === "email.sender") {
      const capability = feature === "sms.sender" ? "sms" : "email";
      const input = FEATURE_CATALOG[feature].change.parse(change);
      const current = await currentConfiguration(this.configuration, scope, capability, actor);
      await this.configuration.configure(scope, capability, "PUT", input, `approved:${actor}`);
      const before = Object.fromEntries(Object.keys(input).map((key) => [key, current[key] ?? null]));
      return { before, after: input };
    }
    const input = feature === "sms.daily_limit" ? FEATURE_CATALOG[feature].change.parse(change)
      : { allowedPrefixes: FEATURE_CATALOG[feature].change.parse(change).prefixes };
    const [sms, otp] = await Promise.all((["sms", "otp"] as const).map((capability) =>
      currentConfiguration(this.configuration, scope, capability, actor)));
    await this.configuration.configure(scope, "sms", "PUT", input, `approved:${actor}`);
    await this.configuration.configure(scope, "otp", "PUT", input, `approved:${actor}`);
    const readFields = (state: Record<string, unknown>) => Object.fromEntries(Object.keys(input).map((key) => [key, state[key] ?? null]));
    return { before: { sms: readFields(sms), otp: readFields(otp) }, after: input };
  }
}
