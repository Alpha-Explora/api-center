// Sends a new organization member their invite through APICenter's own email runtime.
//
// Route: the gateway already holds EMAIL_ADMIN_TOKEN and reaches the email runtime's admin routes
// server to server for project sender configuration (capability-configuration.service.ts). The
// invite uses the same channel: POST /admin/platform-messages on the live email runtime, with the
// admin token and, on Cloud Run, an identity token. The runtime sends from its own platform sender
// (EMAIL_FROM_ADDRESS) under a fixed platform owner, so no application context is forged.
//
// Never throws: the membership change has already been committed. The outcome is returned to the
// console and recorded in the audit log.
//
// Abuse: invites go out from APICenter's own sender and share one daily allowance, so an admin who
// adds and removes the same person repeatedly must not be able to send unlimited mail. An invite to
// the same organization and email within INVITE_COOLDOWN_MS is skipped (RECENTLY_INVITED), checked
// against the audit log's invite_sent events and this instance's own recent sends.

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { resolveSharedServiceRoute } from "@shared/proxy/shared-service-route";
import { consoleUrlFrom, INVITE_COOLDOWN_MS, inviteMessage, type InviteFailure, type InviteOutcome } from "./member-invite";
import type { FetchLike } from "./capability-configuration.service";

const INVITE_TIMEOUT_MS = 8_000;
const INVITE_SENT = "control_plane.member.invite_sent";

@Injectable()
export class MemberInviteService {
  private fetchImpl: FetchLike = (url, init) => fetch(url, init);
  /** organizationId:email -> when this instance last sent that invite. */
  private readonly recentlySent = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventsService,
  ) {}

  /** Test seam for the HTTP call. */
  useFetch(fetchImpl: FetchLike) {
    this.fetchImpl = fetchImpl;
  }

  async invite(input: { organizationId: string; email: string; role: string; invitedBy: string }): Promise<InviteOutcome> {
    const consoleUrl = consoleUrlFrom(process.env.MANAGEMENT_CONSOLE_URL);
    let text = "";
    let outcome: InviteOutcome;
    try {
      const organization = await this.prisma.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
      const message = inviteMessage({ ...input, organizationName: organization?.name ?? "an organization", consoleUrl });
      text = message.text;
      const failure = (await this.sentRecently(input)) ? recentlyInvited : await this.deliver(input.email, message);
      outcome = failure ? { status: "not_sent", ...failure, consoleUrl, text } : { status: "sent", consoleUrl, text };
    } catch {
      // Raw error text can carry database or network detail; the console and audit log get a code.
      outcome = { status: "not_sent", reason: "INVITE_FAILED", detail: "The invite could not be prepared", consoleUrl, text };
    }
    if (outcome.status === "sent") this.recentlySent.set(inviteKey(input), Date.now());
    await this.record(input, outcome);
    return outcome;
  }

  private async sentRecently(input: { organizationId: string; email: string }): Promise<boolean> {
    const key = inviteKey(input);
    const since = Date.now() - INVITE_COOLDOWN_MS;
    for (const [entry, sentAt] of this.recentlySent) if (sentAt < since) this.recentlySent.delete(entry);
    if (this.recentlySent.has(key)) return true;
    return this.audit.hasEventSince({ action: INVITE_SENT, resourceType: "member", resourceId: key, since: new Date(since) });
  }

  /** Undefined when the runtime accepted the message for delivery; otherwise why it was not sent. */
  private async deliver(to: string, message: { subject: string; text: string; html: string }): Promise<{ reason: InviteFailure; detail: string } | undefined> {
    const token = process.env.EMAIL_ADMIN_TOKEN?.trim();
    let upstream: string;
    try {
      upstream = resolveSharedServiceRoute("email", "live");
    } catch {
      return { reason: "EMAIL_NOT_CONFIGURED", detail: "SHARED_SERVICE_ROUTE_EMAIL_LIVE is not set on the gateway" };
    }
    if (!token) return { reason: "EMAIL_NOT_CONFIGURED", detail: "EMAIL_ADMIN_TOKEN is not set on the gateway" };

    const headers: Record<string, string> = { "X-APICenter-Email-Admin-Token": token, "Content-Type": "application/json" };
    let response: globalThis.Response;
    try {
      const authorization = await getCloudRunAuthorizationHeader(upstream);
      if (authorization) headers.Authorization = authorization;
      response = await this.fetchImpl(`${upstream}/admin/platform-messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ to, ...message }),
        signal: AbortSignal.timeout(INVITE_TIMEOUT_MS),
      });
    } catch {
      return { reason: "EMAIL_UNAVAILABLE", detail: "The email runtime could not be reached" };
    }
    const body = (await response.json().catch(() => undefined)) as { data?: { provider?: string }; error?: unknown; message?: string } | undefined;
    if (!response.ok) {
      const code = typeof body?.error === "string" ? body.error : (body?.error as { code?: string } | undefined)?.code;
      return { reason: "EMAIL_REJECTED", detail: `The email runtime returned ${response.status}${code ? ` ${code}` : ""}` };
    }
    if (body?.data?.provider === "mock") {
      return { reason: "EMAIL_PROVIDER_NOT_CONFIGURED", detail: "The email runtime has no email provider configured" };
    }
    return undefined;
  }

  private async record(input: { organizationId: string; email: string; invitedBy: string }, outcome: InviteOutcome) {
    try {
      await this.audit.record({
        type: outcome.status === "sent" ? INVITE_SENT : "control_plane.member.invite_not_sent",
        actionFamily: "registration",
        actor: input.invitedBy,
        organizationId: input.organizationId,
        resourceType: "member",
        resourceId: inviteKey(input),
        severity: outcome.status === "sent" ? "info" : "warning",
        message: outcome.status === "sent" ? "member invite sent" : `member invite not sent: ${outcome.reason}`,
        payload: outcome.status === "sent" ? { consoleUrl: outcome.consoleUrl } : { reason: outcome.reason, detail: outcome.detail },
      });
    } catch {
      // The audit trail is best effort here; the invite outcome is still returned to the console.
    }
  }
}

const recentlyInvited: { reason: InviteFailure; detail: string } = {
  reason: "RECENTLY_INVITED",
  detail: "An invite to this email for this organization was sent in the last 24 hours",
};

/** Also the audit resource id of invite events, which the cooldown check reads back. */
function inviteKey(input: { organizationId: string; email: string }): string {
  return `${input.organizationId}:${input.email}`;
}
