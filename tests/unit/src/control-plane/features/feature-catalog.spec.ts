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

  it("returns a feature key to the project and rejects malformed changes", () => {
    const member = { kind: "member", email: "admin@example.com", subject: "subject", platformAdmin: false } as const;
    expect(() => assertFeatureAllowed(member, "payments.live", {}, { environment: "live", current: {} }))
      .toThrow(expect.objectContaining({ code: "FEATURE_APPROVAL_REQUIRED", response: expect.objectContaining({ details: { feature: "payments.live" } }) }));
    expect(() => parseChange("sms.international", { prefixes: ["65"] })).toThrow("Invalid change");
    expect(FEATURE_CATALOG["payouts.payee_wallets"].environments).toEqual(["test"]);
  });
});
