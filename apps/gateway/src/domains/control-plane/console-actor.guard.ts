// Identifies who is acting in the console.
//
// 1. The calling server must authenticate as the platform (ScopedAdminGuard: platform secret or a
//    platform:admin JWT). The management console is such a server.
// 2. When it forwards the signed-in member's Google ID token in X-APICenter-User-Token, the gateway
//    verifies it here and acts as that member, enforcing their roles. Without a user token the
//    caller acts as the platform itself (operator scripts and break-glass access).

import { CanActivate, ExecutionContext, Injectable, Optional } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";
import { ScopedAdminGuard } from "@auth/guards/scoped-admin.guard";
import { ConfigService } from "@config/config.service";
import { ServiceUnavailableError, UnauthorizedError } from "@shared/errors";
import type { AuthenticatedRequest } from "../../types";
import type { ConsoleActor } from "./console-access.policy";

export const CONSOLE_USER_TOKEN_HEADER = "x-apicenter-user-token";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

export interface VerifiedConsoleUser {
  email: string;
  subject: string;
}

export type ConsoleUserVerifier = (token: string) => Promise<VerifiedConsoleUser>;

export interface ConsoleRequest extends AuthenticatedRequest {
  consoleActor?: ConsoleActor;
}

/** Verifies a Google ID token for one of the console's OAuth client IDs. */
export function createGoogleConsoleUserVerifier(clientIds: string[], client = new OAuth2Client()): ConsoleUserVerifier {
  return async (token) => {
    if (clientIds.length === 0) {
      throw new ServiceUnavailableError("Console identity verification is not configured (MANAGEMENT_GOOGLE_CLIENT_IDS)");
    }
    let payload;
    try {
      payload = (await client.verifyIdToken({ idToken: token, audience: clientIds })).getPayload();
    } catch {
      throw new UnauthorizedError("The console user token is invalid or expired");
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true || !GOOGLE_ISSUERS.has(String(payload.iss))) {
      throw new UnauthorizedError("The console user token is not a verified Google identity");
    }
    return { email: payload.email.trim().toLowerCase(), subject: payload.sub };
  };
}

@Injectable()
export class ConsoleActorGuard implements CanActivate {
  private readonly verifyUser: ConsoleUserVerifier;

  constructor(
    private readonly platformGuard: ScopedAdminGuard,
    private readonly config: ConfigService,
    @Optional() verifier?: ConsoleUserVerifier,
  ) {
    const clientIds = (process.env.MANAGEMENT_GOOGLE_CLIENT_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    this.verifyUser = verifier ?? createGoogleConsoleUserVerifier(clientIds);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.platformGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<ConsoleRequest>();
    const userToken = request.headers[CONSOLE_USER_TOKEN_HEADER];

    if (typeof userToken === "string" && userToken) {
      const user = await this.verifyUser(userToken);
      request.consoleActor = {
        kind: "member",
        email: user.email,
        subject: user.subject,
        platformAdmin: this.config.platformAdminEmails.includes(user.email),
      };
    } else {
      request.consoleActor = { kind: "platform", id: request.user?.sub ?? "platform" };
    }
    return true;
  }
}

/** The audit label for an actor. Platform callers may name the person they act for. */
export function actorLabel(actor: ConsoleActor, onBehalfOf?: string): string {
  if (actor.kind === "member") return actor.email;
  return onBehalfOf ? `${actor.id}:${onBehalfOf}` : actor.id;
}
