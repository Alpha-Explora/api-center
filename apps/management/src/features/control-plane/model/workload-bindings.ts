import { z } from "zod";

/** A Google service account bound to an application; its ID tokens authenticate as that application. */
export const workloadBindingSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  issuer: z.string(),
  subject: z.string(),
  audience: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  revokedBy: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type WorkloadBinding = z.infer<typeof workloadBindingSchema>;

export type WorkloadBindingForm = { subject: string; audience: string; description: string };

/** A select of the gateway's audiences when it lists any, else free text (unknown or empty list). */
export function audienceInput(audiences: string[] | undefined): { kind: "select"; audiences: string[] } | { kind: "text" } {
  const unique = [...new Set((audiences ?? []).map((audience) => audience.trim()).filter(Boolean))];
  return unique.length ? { kind: "select", audiences: unique } : { kind: "text" };
}
export type WorkloadBindingBody = { subject: string; audience: string; description?: string };
export type WorkloadBindingErrors = Partial<Record<keyof WorkloadBindingForm, string>>;

/** The gateway's bind body from the form, or what is wrong with it. */
export function workloadBindingFormToBody(form: WorkloadBindingForm): { ok: true; body: WorkloadBindingBody } | { ok: false; errors: WorkloadBindingErrors } {
  const subject = form.subject.trim();
  const audience = form.audience.trim();
  const description = form.description.trim();
  const errors: WorkloadBindingErrors = {};
  if (!/^\d{6,32}$/.test(subject)) {
    errors.subject = subject.includes("@")
      ? "Use the service account's unique ID (digits), not its email."
      : "The unique ID is 6 to 32 digits.";
  }
  if (!audience) errors.audience = "Enter the audience the workload requests its ID token for.";
  else if (audience.length > 2048) errors.audience = "At most 2,048 characters.";
  if (description.length > 200) errors.description = "At most 200 characters.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { subject, audience, ...(description ? { description } : {}) } };
}
