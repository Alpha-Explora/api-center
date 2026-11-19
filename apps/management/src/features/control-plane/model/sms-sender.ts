import { z } from "zod";

/** GET, PUT and DELETE all return the environment's sender as it now stands. */
export const smsSenderSchema = z.object({
  configured: z.boolean(),
  senderId: z.string().nullable(),
  /** Whether the platform has its own Twilio sender for environments that pin none. */
  platformSenderConfigured: z.boolean(),
});
export type SmsSender = z.infer<typeof smsSenderSchema>;

export type SmsSenderForm = { senderId: string };
export type SmsSenderBody = { senderId: string };

const E164 = /^\+[1-9]\d{6,14}$/;
const ALPHANUMERIC_SENDER = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

/** Mirrors the SMS runtime: an E.164 number, or a Twilio alphanumeric sender ID. */
export const smsSenderFormSchema = z.object({
  senderId: z
    .string()
    .trim()
    .min(1, "Enter a phone number or sender name.")
    .refine(
      (value) => E164.test(value) || ALPHANUMERIC_SENDER.test(value),
      "Use a phone number like +639171234567, or 1–11 letters, digits or spaces with at least one letter.",
    ),
});

export function smsSenderBody(form: SmsSenderForm): SmsSenderBody {
  return { senderId: smsSenderFormSchema.parse(form).senderId };
}

/** How the environment's SMS currently gets its sender, in words. */
export function smsSenderSummary(current: SmsSender): { tone: "success" | "warning" | "neutral"; label: string } {
  if (current.senderId) return { tone: "success", label: `Pinned to ${current.senderId}` };
  if (current.platformSenderConfigured) return { tone: "neutral", label: "Platform sender" };
  return { tone: "warning", label: "No sender" };
}
