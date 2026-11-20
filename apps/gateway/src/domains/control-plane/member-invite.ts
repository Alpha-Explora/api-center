// The invite a new organization member receives. Pure, so the console's copyable fallback and the
// email carry the same words.

export const DEFAULT_CONSOLE_URL = "https://apicenter.itsandbox.site";

/** The name invites are sent under, in front of the email runtime's own address. */
export const INVITE_SENDER_NAME = "APICenter";

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

/**
 * Where the invite's button goes: the console's sign-in page, with the invited email as Google's
 * login hint, so the right account is offered first.
 */
export function inviteLink(consoleUrl: string, email: string): string {
  return `${consoleUrl}/signup?login_hint=${encodeURIComponent(email)}`;
}

const ARTICLE: Record<string, string> = { owner: "an owner", admin: "an admin", developer: "a developer", viewer: "a viewer" };

/** What each organization role lets the new member do, in their words. */
function roleSummary(role: string, organizationName: string): string {
  switch (role) {
    case "owner":
      return `As an owner you can manage everything in ${organizationName}, including its members and other owners.`;
    case "admin":
      return `As an admin you can manage ${organizationName}'s projects, members, teams and quotas.`;
    case "developer":
      return "As a developer you can create projects and work on the projects you're given access to.";
    case "viewer":
      return "As a viewer you can see the projects you're given access to.";
    default:
      return "";
  }
}

export interface InviteMessageInput {
  organizationName: string;
  email: string;
  role: string;
  consoleUrl: string;
  /** The audit label of whoever invited: a person's email, or "platform" / "platform:<person>". */
  invitedBy?: string;
  /** The inviter's name from their Google account, when a person invited. */
  invitedByName?: string;
  /** When the invite stops working. */
  expiresAt?: Date;
  /** Projects the member already has a role on, to say what they get. */
  projects?: { name: string; role: string }[];
}

export function inviteMessage(input: InviteMessageInput) {
  const role = ARTICLE[input.role] ?? `a ${input.role}`;
  // Platform callers are labelled "platform" or "platform:<person>"; only a person's email names the inviter.
  const inviterEmail = input.invitedBy && /^[^\s@:]+@[^\s@]+$/.test(input.invitedBy) ? input.invitedBy : undefined;
  const inviterName = inviterEmail ? personName(input.invitedByName) : undefined;
  const inviter = inviterEmail ? (inviterName ? `${inviterName} (${inviterEmail})` : inviterEmail) : undefined;
  const inviterShort = inviterName ?? inviterEmail;
  const link = inviteLink(input.consoleUrl, input.email);
  const expires = input.expiresAt ? formatDate(input.expiresAt) : undefined;

  const opening = `${inviter ? `${inviter} invited you` : "You've been invited"} to join ${input.organizationName} on APICenter as ${role}.`;
  const projects = projectSentence(input.projects ?? []);
  const summary = roleSummary(input.role, input.organizationName);
  const account = `Sign in with Google as ${input.email}. Another Google account won't work.`;
  const expiry = `${expires ? `This invite expires on ${expires}.` : "This invite expires after 7 days."} If it does, ask ${inviterShort ?? "an admin"} to send it again.`;
  const footer = `You're getting this because ${inviterShort ?? "an admin"} added your email to ${input.organizationName} on APICenter. If you weren't expecting it, you can ignore this email.`;
  const subject = inviterShort
    ? `${inviterShort} invited you to ${input.organizationName} on APICenter`
    : `You're invited to ${input.organizationName} on APICenter`;

  const text = [opening, ...(projects ? [projects] : []), ...(summary ? [summary] : []), "", `Accept the invite: ${link}`, account, "", expiry, "", "—", footer].join("\n");

  const e = escapeHtml;
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2328;">
<tr><td style="padding:28px 28px 4px;">
<p style="margin:0 0 20px;font-size:15px;font-weight:700;color:#0d1117;">APICenter</p>
<h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:#0d1117;">Join ${e(input.organizationName)}</h1>
<p style="margin:0 0 10px;font-size:14px;line-height:1.55;">${e(opening)}</p>
${projects ? `<p style="margin:0 0 10px;font-size:14px;line-height:1.55;">${e(projects)}</p>\n` : ""}${summary ? `<p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#424a53;">${e(summary)}</p>\n` : ""}<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;"><tr><td style="border-radius:8px;background:#111111;">
<a href="${e(link)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Accept invite</a>
</td></tr></table>
<p style="margin:0 0 14px;padding:10px 12px;background:#f6f8fa;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;line-height:1.5;color:#424a53;">Sign in with Google as <strong style="color:#0d1117;">${e(input.email)}</strong>. Another Google account won't work.</p>
<p style="margin:0 0 6px;font-size:13px;line-height:1.5;color:#57606a;">${e(expiry)}</p>
<p style="margin:0 0 20px;font-size:12px;line-height:1.5;color:#6e7781;">Button not working? Open <a href="${e(link)}" style="color:#0b57d0;">${e(input.consoleUrl)}</a> and sign in.</p>
</td></tr>
<tr><td style="padding:14px 28px 22px;border-top:1px solid #eef0f2;font-size:12px;line-height:1.5;color:#6e7781;">${e(footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return { subject: subject.slice(0, 200), text, html };
}

/** "You'll also have admin access to Serbizio and developer access to AlphaCI." */
function projectSentence(projects: { name: string; role: string }[]): string {
  if (projects.length === 0) return "";
  const parts = projects.map((project) => `${project.role} access to ${project.name}`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `You'll have ${list}.`;
}

/** A Google account name, reduced to one line of at most 80 characters; undefined when empty. */
export function personName(value: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex
  const cleaned = value?.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return cleaned || undefined;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
