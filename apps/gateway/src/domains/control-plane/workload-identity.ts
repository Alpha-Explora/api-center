// Workload identity: a Google-signed OIDC ID token (for example a Cloud Run service account's)
// authenticates as the application its exact (issuer, subject, audience) is bound to, so the
// workload needs no stored key. Only Google is a trusted issuer in this release.

import { Injectable, Optional } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";
import { UnauthorizedError } from "@shared/errors";

export const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_ISSUERS = new Set([GOOGLE_ISSUER, "accounts.google.com"]);

/** Audiences the gateway accepts for workload tokens, from CONTROL_PLANE_WORKLOAD_AUDIENCES. */
export function workloadAudiences(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CONTROL_PLANE_WORKLOAD_AUDIENCES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Routing hint only: whether a bearer looks like a Google-issued workload token. It reads the
 * unverified issuer to choose the path; WorkloadTokenVerifier does the actual verification.
 */
export function isWorkloadIdentityToken(bearer: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!bearer || workloadAudiences(env).length === 0) return false;
  const parts = bearer.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { iss?: unknown };
    return typeof payload.iss === "string" && GOOGLE_ISSUERS.has(payload.iss);
  } catch {
    return false;
  }
}

export interface VerifiedWorkload {
  issuer: string;
  subject: string;
  audience: string;
}

@Injectable()
export class WorkloadTokenVerifier {
  constructor(@Optional() private readonly client: OAuth2Client = new OAuth2Client()) {}

  async verify(token: string, env: NodeJS.ProcessEnv = process.env): Promise<VerifiedWorkload> {
    const audiences = workloadAudiences(env);
    if (audiences.length === 0) throw new UnauthorizedError("Workload identity is not enabled");
    let payload;
    try {
      payload = (await this.client.verifyIdToken({ idToken: token, audience: audiences })).getPayload();
    } catch {
      throw new UnauthorizedError("Invalid workload identity token");
    }
    const audience = Array.isArray(payload?.aud) ? payload?.aud[0] : payload?.aud;
    if (!payload?.sub || !payload.iss || !GOOGLE_ISSUERS.has(payload.iss) || !audience || !audiences.includes(audience)) {
      throw new UnauthorizedError("Invalid workload identity token");
    }
    return { issuer: GOOGLE_ISSUER, subject: payload.sub, audience };
  }
}
