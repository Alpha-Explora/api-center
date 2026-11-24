import { FEATURE_CATALOG, type FeatureKey } from "../../../../../apps/gateway/src/domains/control-plane/features/feature-catalog";
import { assertFeatureAllowed, parseChange } from "../../../../../apps/gateway/src/domains/control-plane/features/feature-gate";

describe("feature escalation decisions", () => {
  it.each([
    ["plan.upgrade", { planKey: "enterprise" }, { planKey: "standard" }, true],
    ["plan.upgrade", { planKey: "pro" }, { planKey: "enterprise" }, false],
    ["payments.live", {}, { enabled: false }, true],
    ["payments.live", {}, { enabled: true }, false],
    ["payouts.sending", {}, { enabled: false }, true],
    ["payouts.merchant_account", {}, { enabled: false }, true],
    ["payouts.payee_wallets", {}, { enabled: true }, false],
    ["sms.sender", { senderId: "MYSHOP" }, { senderId: "MYSHOP" }, false],
    ["sms.sender", { senderId: "OTHER" }, { senderId: "MYSHOP" }, true],
    ["email.sender", { fromAddress: "test@example.com", dailyLimit: null }, { fromAddress: "test@example.com" }, false],
    ["sms.daily_limit", { dailyLimit: 501 }, {}, true],
    ["sms.daily_limit", { dailyLimit: 100 }, {}, false],
    ["sms.international", { prefixes: ["+63", "+65"] }, { prefixes: ["+63"] }, true],
    ["sms.international", { prefixes: ["+63"] }, { prefixes: ["+63", "+65"] }, false],
  ] as [FeatureKey, unknown, Record<string, unknown>, boolean][])("%s approval for %j", (key, change, current, expected) => {
    expect(FEATURE_CATALOG[key].needsApproval(change, { environment: "live", current })).toBe(expected);
  });

  it("never asks approval to lower a limit, only to raise it above what is already allowed", () => {
    const approved = (environment: "test" | "live", dailyLimit: number) => ({ environment, current: { dailyLimit, defaultDailyLimit: 500 } });
    expect(FEATURE_CATALOG["sms.daily_limit"].needsApproval({ dailyLimit: 1500 }, approved("live", 2000))).toBe(false);
    expect(FEATURE_CATALOG["sms.daily_limit"].needsApproval({ dailyLimit: 2500 }, approved("live", 2000))).toBe(true);
    const sender = { fromAddress: "billing@example.com" };
    for (const environment of ["test", "live"] as const) {
      const current = { ...approved(environment, 2000).current, ...sender };
      expect(FEATURE_CATALOG["email.sender"].needsApproval({ ...sender, dailyLimit: 1500 }, { environment, current })).toBe(false);
      expect(FEATURE_CATALOG["email.sender"].needsApproval({ ...sender, dailyLimit: null }, { environment, current })).toBe(false);
      expect(FEATURE_CATALOG["email.sender"].needsApproval({ ...sender, dailyLimit: 2500 }, { environment, current })).toBe(true);
    }
    expect(FEATURE_CATALOG["email.sender"].needsApproval({ fromAddress: "other@example.com", dailyLimit: 1500 },
      { environment: "live", current: { ...approved("live", 2000).current, ...sender } })).toBe(true);
    expect(FEATURE_CATALOG["email.sender"].needsApproval({ fromAddress: "other@example.com", dailyLimit: null },
      { environment: "test", current: { defaultDailyLimit: 500, ...sender } })).toBe(false);
  });

  it("returns a feature key to the project and rejects malformed changes", () => {
    const member = { kind: "member", email: "admin@example.com", subject: "subject", platformAdmin: false } as const;
    expect(() => assertFeatureAllowed(member, "payments.live", {}, { environment: "live", current: {} }))
      .toThrow(expect.objectContaining({ code: "FEATURE_APPROVAL_REQUIRED", response: expect.objectContaining({ details: { feature: "payments.live" } }) }));
    expect(() => parseChange("sms.international", { prefixes: ["65"] })).toThrow("Invalid change");
    expect(FEATURE_CATALOG["payouts.payee_wallets"].environments).toEqual(["test"]);
  });
});
