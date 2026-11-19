import { z } from "zod";

/** One organization as platform operators see it. */
export const organizationSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
  projectCount: z.number(),
  memberCount: z.number(),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const organizationSchema = organizationSummarySchema.omit({ projectCount: true, memberCount: true });

/** The invite the gateway sends a new member; `text` is the same message, for copying when email failed. */
export const inviteSchema = z.object({
  status: z.enum(["sent", "not_sent"]),
  reason: z.string().optional(),
  detail: z.string().optional(),
  consoleUrl: z.string(),
  text: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const createdOrganizationSchema = organizationSchema.extend({
  owner: z.object({ email: z.string(), role: z.string(), invite: inviteSchema }).nullable(),
});

/** PUT members/:email. `invite` is set only when the email was not a member before. */
export const memberChangeSchema = z.object({
  email: z.string(),
  role: z.string(),
  previousRole: z.string().nullable().optional(),
  invite: inviteSchema.nullable().optional(),
});
export type MemberChange = z.infer<typeof memberChangeSchema>;

const INVITE_FAILURES: Record<string, string> = {
  EMAIL_NOT_CONFIGURED: "Email is not configured on the gateway.",
  EMAIL_PROVIDER_NOT_CONFIGURED: "The email service has no provider configured.",
  EMAIL_UNAVAILABLE: "The email service could not be reached.",
  EMAIL_REJECTED: "The email service refused the message.",
};

/** Why an invite was not sent, in a sentence. */
export function inviteFailureText(invite: Invite): string {
  return (invite.reason && INVITE_FAILURES[invite.reason]) ?? "The invite email could not be sent.";
}
