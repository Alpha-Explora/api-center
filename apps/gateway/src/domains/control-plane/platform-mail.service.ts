import { Injectable } from "@nestjs/common";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { resolveSharedServiceRoute } from "@shared/proxy/shared-service-route";
import type { FetchLike } from "./capability-configuration.service";
import { INVITE_SENDER_NAME, type InviteFailure } from "./member-invite";

@Injectable()
export class PlatformMailService {
  private fetchImpl: FetchLike = (url, init) => fetch(url, init);

  useFetch(fetchImpl: FetchLike) {
    this.fetchImpl = fetchImpl;
  }

  async send(input: { to: string[]; subject: string; text: string }): Promise<"sent" | "not_sent"> {
    if (!input.to.length) return "not_sent";
    const results = await Promise.all(input.to.map((to) => this.deliver(to, { subject: input.subject, text: input.text })));
    return results.every((result) => result === undefined) ? "sent" : "not_sent";
  }

  /** Undefined when the runtime accepted the message for delivery. */
  async deliver(to: string, message: { subject: string; text: string; html?: string }, replyTo?: string):
    Promise<{ reason: InviteFailure; detail: string } | undefined> {
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
        method: "POST", headers,
        body: JSON.stringify({ to, ...message, fromName: INVITE_SENDER_NAME, ...(replyTo ? { replyTo } : {}) }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return { reason: "EMAIL_UNAVAILABLE", detail: "The email runtime could not be reached" };
    }
    const body = (await response.json().catch(() => undefined)) as { data?: { provider?: string }; error?: unknown } | undefined;
    if (!response.ok) {
      const code = typeof body?.error === "string" ? body.error : (body?.error as { code?: string } | undefined)?.code;
      return { reason: "EMAIL_REJECTED", detail: `The email runtime returned ${response.status}${code ? ` ${code}` : ""}` };
    }
    if (body?.data?.provider === "mock") {
      return { reason: "EMAIL_PROVIDER_NOT_CONFIGURED", detail: "The email runtime has no email provider configured" };
    }
    return undefined;
  }
}
