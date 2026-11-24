import { z } from "zod";

/** Bounds the OTP runtime enforces; see apps/otp/src/shared/project-settings.ts. */
export const OTP_BOUNDS = {
  codeLength: { min: 4, max: 10 },
  expirySeconds: { min: 60, max: 3600 },
  maxAttempts: { min: 1, max: 10, default: 5 },
  messageTemplateMaxLength: 300,
} as const;

/** GET, PUT and DELETE all return the environment's settings as they now stand; null means the default. */
export const otpSettingsSchema = z.object({
  configured: z.boolean(),
  codeLength: z.number().nullable(),
  expirySeconds: z.number().nullable(),
  maxAttempts: z.number().nullable(),
  messageTemplate: z.string().nullable(),
  dailyLimit: z.number().nullable().optional(),
  allowedPrefixes: z.array(z.string()).nullable().optional(),
  defaults: z.object({
    codeLength: z.number(),
    expirySeconds: z.number(),
    maxAttempts: z.number().nullable(),
    messageTemplate: z.string(),
    dailyLimit: z.number().optional(),
    allowedPrefixes: z.array(z.string()).optional(),
  }),
});
export type OtpSettings = z.infer<typeof otpSettingsSchema>;

export type OtpSettingsForm = { codeLength: string; expirySeconds: string; maxAttempts: string; messageTemplate: string };
export type OtpSettingsBody = { codeLength: number | null; expirySeconds: number | null; maxAttempts: number | null; messageTemplate: string | null };

const PLACEHOLDER = /\{\{[ ]*([A-Za-z]+)[ ]*\}\}/g;
const LINK = /\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i;
const PHONE = /\+?\d(?:[\s().-]?\d){6,}/;

/** Why the runtime would refuse this template, or null when it is acceptable. Mirrors apps/otp/src/shared/project-settings.ts. */
export function otpTemplateProblem(template: string): string | null {
  if (template.length > OTP_BOUNDS.messageTemplateMaxLength) return `Use at most ${OTP_BOUNDS.messageTemplateMaxLength} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(template)) return "Keep the message to one line, without tabs or other control characters.";
  const names = [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);
  const unknown = names.find((name) => name !== "code" && name !== "minutes" && name !== "project");
  if (unknown) return `Only {{code}}, {{minutes}} and {{project}} can be used; {{${unknown}}} is not known.`;
  if (!names.includes("code")) return "Include {{code}} where the code goes.";
  const text = template.replace(PLACEHOLDER, " ");
  if (LINK.test(text)) return "Remove links and web or email addresses; the message is sent from APICenter's own senders.";
  if (PHONE.test(text)) return "Remove phone numbers; the message is sent from APICenter's own senders.";
  return null;
}

const optionalWholeNumber = (min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => value === "" || /^\d+$/.test(value), "Enter a whole number, or leave it empty for the default.")
    .refine((value) => value === "" || (Number(value) >= min && Number(value) <= max), `Use a number from ${min} to ${max}.`);

export const otpSettingsFormSchema = z.object({
  codeLength: optionalWholeNumber(OTP_BOUNDS.codeLength.min, OTP_BOUNDS.codeLength.max),
  expirySeconds: optionalWholeNumber(OTP_BOUNDS.expirySeconds.min, OTP_BOUNDS.expirySeconds.max),
  maxAttempts: optionalWholeNumber(OTP_BOUNDS.maxAttempts.min, OTP_BOUNDS.maxAttempts.max),
  messageTemplate: z
    .string()
    .trim()
    .superRefine((value, context) => {
      const problem = value === "" ? null : otpTemplateProblem(value);
      if (problem) context.addIssue({ code: "custom", message: problem });
    }),
});

const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value.trim()));

/** The PUT body for a valid form. The PUT replaces every setting, so empty fields are sent as null. */
export function otpSettingsBody(form: OtpSettingsForm): OtpSettingsBody {
  const parsed = otpSettingsFormSchema.parse(form);
  return {
    codeLength: numberOrNull(parsed.codeLength),
    expirySeconds: numberOrNull(parsed.expirySeconds),
    maxAttempts: numberOrNull(parsed.maxAttempts),
    messageTemplate: parsed.messageTemplate === "" ? null : parsed.messageTemplate,
  };
}

export function otpSettingsFormFrom(current: OtpSettings | undefined): OtpSettingsForm {
  const text = (value: number | null | undefined) => (value == null ? "" : String(value));
  return {
    codeLength: text(current?.codeLength),
    expirySeconds: text(current?.expirySeconds),
    maxAttempts: text(current?.maxAttempts),
    messageTemplate: current?.messageTemplate ?? "",
  };
}

/** The message a recipient would get with this template, using a sample code of the effective length. */
export function otpMessagePreview(template: string, codeLength: number, expirySeconds: number, projectName = "APICenter"): string {
  const code = "123456789012".slice(0, codeLength);
  const minutes = String(Math.max(1, Math.round(expirySeconds / 60)));
  const values: Record<string, string> = { code, minutes, project: projectName };
  // Unknown placeholders stay as typed, so the preview shows what the validation complains about.
  return template.replace(PLACEHOLDER, (match, name: string) => values[name] ?? match);
}

/** The values the preview uses: each valid field as typed, otherwise the platform default. */
export function effectiveOtpSettings(form: OtpSettingsForm, defaults: OtpSettings["defaults"]) {
  const shape = otpSettingsFormSchema.shape;
  const value = (field: "codeLength" | "expirySeconds", fallback: number) => {
    const raw = form[field].trim();
    return raw !== "" && shape[field].safeParse(raw).success ? Number(raw) : fallback;
  };
  return {
    codeLength: value("codeLength", defaults.codeLength),
    expirySeconds: value("expirySeconds", defaults.expirySeconds),
    template: form.messageTemplate.trim() || defaults.messageTemplate,
  };
}
