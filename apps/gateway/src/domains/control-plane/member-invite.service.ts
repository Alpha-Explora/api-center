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

import { Injectable } from "@nestjs/common";
import { PrismaService } from "@database/prisma.service";
import { AuditEventsService } from "@audit/audit-events.service";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { resolveSharedServiceRoute } from "@shared/proxy/shared-service-route";
import { consoleUrlFrom, inviteMessage, type InviteFailure, type InviteOutcome } from "./member-invite";
import type { FetchLike } from "./capability-configuration.service";

const INVITE_TIMEOUT_MS = 8_000;

@Injectable()
export class MemberInviteService {
  private fetchImpl: FetchLike = (url, init) => fetch(url, init);

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
      const failure = await this.deliver(input.email, message);
      outcome = failure ? { status: "not_sent", ...failure, consoleUrl, text } : { status: "sent", consoleUrl, text };
    } catch (error) {
      outcome = { status: "not_sent", reason: "EMAIL_UNAVAILABLE", detail: error instanceof Error ? error.message : "Invite failed", consoleUrl, text };
    }
    await this.record(input, outcome);
    return outcome;
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
        type: outcome.status === "sent" ? "control_plane.member.invite_sent" : "control_plane.member.invite_not_sent",
        actionFamily: "registration",
        actor: input.invitedBy,
        resourceType: "member",
        resourceId: `${input.organizationId}:${input.email}`,
        severity: outcome.status === "sent" ? "info" : "warning",
        message: outcome.status === "sent" ? "member invite sent" : `member invite not sent: ${outcome.reason}`,
        payload: outcome.status === "sent" ? { consoleUrl: outcome.consoleUrl } : { reason: outcome.reason, detail: outcome.detail },
      });
    } catch {
      // The audit trail is best effort here; the invite outcome is still returned to the console.
    }
  }
}
