// The invite a new organization member receives. Pure, so the console's copyable fallback and the
// email carry the same words.

export const DEFAULT_CONSOLE_URL = "https://apicenter.itsandbox.site";

export type InviteOutcome =
  | { status: "sent"; consoleUrl: string; text: string }
  | { status: "not_sent"; reason: InviteFailure; detail: string; consoleUrl: string; text: string };

export type InviteFailure =
  /** EMAIL_ADMIN_TOKEN or the email runtime's live route is not set on the gateway. */
  | "EMAIL_NOT_CONFIGURED"
  /** The email runtime has no provider (Resend) configured, so nothing would be delivered. */
  | "EMAIL_PROVIDER_NOT_CONFIGURED"
  /** The email runtime could not be reached or timed out. */
  | "EMAIL_UNAVAILABLE"
  /** The email runtime refused the message (rate or daily limit, an older runtime without the route). */
  | "EMAIL_REJECTED"
  /** An invite to this email for this organization went out in the last 24 hours. */
  | "RECENTLY_INVITED"
  /** Something else went wrong while preparing the invite. */
  | "INVITE_FAILED";

/** How long after an invite to the same organization and email another one is skipped. */
export const INVITE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** MANAGEMENT_CONSOLE_URL when it is an absolute http(s) URL, else the hosted console. */
export function consoleUrlFrom(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_CONSOLE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_CONSOLE_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_CONSOLE_URL;
  }
}

const ARTICLE: Record<string, string> = { owner: "an owner", admin: "an admin", developer: "a developer", viewer: "a viewer" };

export function inviteMessage(input: { organizationName: string; email: string; role: string; consoleUrl: string; invitedBy?: string }) {
  const role = ARTICLE[input.role] ?? `a ${input.role}`;
  // Platform callers are labelled "platform" or "platform:<person>"; only a person's email names the inviter.
  const inviter = input.invitedBy && /^[^\s@:]+@[^\s@]+$/.test(input.invitedBy) ? input.invitedBy : undefined;
  const opening = `${inviter ? `${inviter} added you` : "You have been added"} to ${input.organizationName} on APICenter as ${role}.`;
  const subject = `You have been added to ${input.organizationName} on APICenter`;
  const text = [
    opening,
    "",
    `Sign in with the Google account for ${input.email}:`,
    input.consoleUrl,
    "",
    "Your access starts the first time you sign in.",
  ].join("\n");
  const html = [
    `<p>${escapeHtml(opening)}</p>`,
    `<p>Sign in with the Google account for <strong>${escapeHtml(input.email)}</strong>:</p>`,
    `<p><a href="${escapeHtml(input.consoleUrl)}">${escapeHtml(input.consoleUrl)}</a></p>`,
    "<p>Your access starts the first time you sign in.</p>",
  ].join("\n");
  return { subject: subject.slice(0, 200), text, html };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
