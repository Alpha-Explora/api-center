import { describe, expect, it } from "vitest";
import { fieldErrors } from "@/features/control-plane/model/form-errors";
import {
  effectiveOtpSettings,
  otpMessagePreview,
  otpSettingsBody,
  otpSettingsFormFrom,
  otpSettingsFormSchema,
  otpTemplateProblem,
  type OtpSettings,
  type OtpSettingsForm,
} from "@/features/control-plane/model/otp-settings";
import { paymentsMerchantState } from "@/features/control-plane/model/payments-merchant";
import { smsSenderBody, smsSenderFormSchema, smsSenderSummary } from "@/features/control-plane/model/sms-sender";

describe("SMS sender", () => {
  const error = (senderId: string) => fieldErrors(smsSenderFormSchema.safeParse({ senderId }).error).senderId;

  it("accepts what the SMS runtime accepts", () => {
    expect(error("+639171234567")).toBeUndefined();
    expect(error("Serbizio")).toBeUndefined();
    expect(error("Shop 24")).toBeUndefined();
    expect(smsSenderBody({ senderId: "  Serbizio " })).toEqual({ senderId: "Serbizio" });
  });

  it("refuses numbers without +, all-digit names, long names and punctuation", () => {
    for (const value of ["", "639171234567", "123456", "TwelveLetter", "Shop-24", "+0123456789"]) expect(error(value)).toBeDefined();
  });

  it("summarises where the sender comes from", () => {
    expect(smsSenderSummary({ configured: true, senderId: "Serbizio", platformSenderConfigured: false })).toEqual({ tone: "success", label: "Pinned to Serbizio" });
    expect(smsSenderSummary({ configured: false, senderId: null, platformSenderConfigured: true }).label).toBe("Platform sender");
    expect(smsSenderSummary({ configured: false, senderId: null, platformSenderConfigured: false }).tone).toBe("warning");
  });
});

describe("OTP settings", () => {
  const defaults: OtpSettings["defaults"] = { codeLength: 6, expirySeconds: 300, maxAttempts: null, messageTemplate: "Your APICenter verification code is {{code}}" };
  const form = (patch: Partial<OtpSettingsForm> = {}): OtpSettingsForm => ({ codeLength: "", expirySeconds: "", maxAttempts: "", messageTemplate: "", ...patch });
  const errors = (patch: Partial<OtpSettingsForm>) => fieldErrors(otpSettingsFormSchema.safeParse(form(patch)).error);

  it("sends empty fields as null so the PUT clears them", () => {
    expect(otpSettingsBody(form())).toEqual({ codeLength: null, expirySeconds: null, maxAttempts: null, messageTemplate: null });
    expect(otpSettingsBody(form({ codeLength: " 8 ", maxAttempts: "3", messageTemplate: " Code {{code}} " }))).toEqual({
      codeLength: 8,
      expirySeconds: null,
      maxAttempts: 3,
      messageTemplate: "Code {{code}}",
    });
  });

  it("refuses values outside the runtime's bounds", () => {
    expect(errors({ codeLength: "3" })).toHaveProperty("codeLength");
    expect(errors({ codeLength: "11" })).toHaveProperty("codeLength");
    expect(errors({ expirySeconds: "59" })).toHaveProperty("expirySeconds");
    expect(errors({ expirySeconds: "3601" })).toHaveProperty("expirySeconds");
    expect(errors({ maxAttempts: "0" })).toHaveProperty("maxAttempts");
    expect(errors({ maxAttempts: "2.5" })).toHaveProperty("maxAttempts");
    expect(errors({ codeLength: "10", expirySeconds: "3600", maxAttempts: "10" })).toEqual({});
  });

  it("checks the template the way the runtime does", () => {
    expect(otpTemplateProblem("Your code is {{ code }}, valid {{minutes}} min")).toBeNull();
    expect(otpTemplateProblem("Your code")).toMatch(/\{\{code\}\}/);
    expect(otpTemplateProblem("{{code}} for {{name}}")).toMatch(/\{\{name\}\}/);
    expect(otpTemplateProblem(`{{code}}${"x".repeat(300)}`)).toMatch(/300/);
    expect(otpTemplateProblem("{{code}}\tok")).toMatch(/control/);
    expect(otpTemplateProblem("Your code {{code}}\nCall us")).toMatch(/one line/);
    expect(otpTemplateProblem("Code {{\ncode}}")).not.toBeNull();
    expect(otpTemplateProblem("Code {{code}} at https://evil.example")).toMatch(/links/);
    expect(otpTemplateProblem("Code {{code}}, see www.evil")).toMatch(/links/);
    expect(otpTemplateProblem("Code {{code}}, confirm at evil.co")).toMatch(/links/);
    expect(otpTemplateProblem("Code {{code}}. Call +63 917 123 4567")).toMatch(/phone/);
    expect(otpTemplateProblem("Your Acme code is {{code}}. It expires in {{minutes}} min, e.g. at 10:30.")).toBeNull();
    expect(errors({ messageTemplate: "no placeholder" })).toHaveProperty("messageTemplate");
  });

  it("round-trips the saved settings into the form", () => {
    const current: OtpSettings = { configured: true, codeLength: 8, expirySeconds: null, maxAttempts: 5, messageTemplate: "Code {{code}}", defaults };
    expect(otpSettingsFormFrom(current)).toEqual({ codeLength: "8", expirySeconds: "", maxAttempts: "5", messageTemplate: "Code {{code}}" });
  });

  it("previews with the effective length, expiry and template", () => {
    const effective = effectiveOtpSettings(form({ codeLength: "4", expirySeconds: "600", messageTemplate: "Code {{code}} ({{minutes}} min)" }), defaults);
    expect(otpMessagePreview(effective.template, effective.codeLength, effective.expirySeconds)).toBe("Code 1234 (10 min)");
    const fallback = effectiveOtpSettings(form({ codeLength: "99" }), defaults);
    expect(otpMessagePreview(fallback.template, fallback.codeLength, fallback.expirySeconds)).toBe("Your APICenter verification code is 123456");
    const partly = effectiveOtpSettings(form({ codeLength: "8", expirySeconds: "30" }), defaults);
    expect(partly).toMatchObject({ codeLength: 8, expirySeconds: 300 });
    expect(otpMessagePreview("{{code}} for {{name}}", 4, 300)).toBe("1234 for {{name}}");
  });
});

describe("payments merchant binding", () => {
  const binding = (bound: boolean) => ({ organizationId: "org", bound, reason: bound ? null : "unbound" });

  it("blocks enabling payments for an unbound organization", () => {
    expect(paymentsMerchantState(binding(false), false)).toMatchObject({ canEnable: false, badge: { label: "No merchant" }, warning: null });
  });

  it("warns when payments is already on without a binding", () => {
    expect(paymentsMerchantState(binding(false), true).warning).toMatch(/refused/);
  });

  it("shows a bound organization, and stays permissive while the status is unknown", () => {
    expect(paymentsMerchantState(binding(true), false)).toMatchObject({ canEnable: true, badge: { label: "Merchant bound" } });
    expect(paymentsMerchantState(undefined, false)).toEqual({ canEnable: true, badge: null, warning: null });
  });
});
