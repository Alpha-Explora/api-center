import { OAuth2Client } from "google-auth-library";
import {
  createLocalDevSession,
  getManagementAuthConfig,
  resolveManagementSessionFromGoogleClaims,
  type GoogleClaims,
  type MembershipLookupFn,
  type ManagementSession,
} from "./management-auth";
import { lookupOrganizationMemberships } from "./organization-membership";
import { isSecureConsole, sessionKeyFrom, sessionTokenFromCookies, verifySessionToken, type SessionKey } from "./console-session";

type RequireSessionInput = {
  env?: Record<string, string | undefined>;
  authorizationHeader?: string | null;
  verifier?: GoogleSessionVerifier;
  membershipLookup?: MembershipLookupFn;
};

export type GoogleSessionVerifier = {
  verifyIdToken: (idToken: string, audience: string) => Promise<GoogleClaims>;
};

export async function requireManagementSession(
  input: RequireSessionInput = {},
): Promise<ManagementSession> {
  const config = getManagementAuthConfig(input.env);

  if (config.mode === "local-dev") {
    return createLocalDevSession();
  }

  const token = getBearerToken(input.authorizationHeader);
  if (!token) {
    throw new Error("Management authentication required");
  }

  if (!config.googleClientId) {
    throw new Error("GOOGLE_CLIENT_ID or NEXT_PUBLIC_GOOGLE_CLIENT_ID is required");
  }

  const verifier = input.verifier ?? createGoogleVerifier();
  const claims = await verifier.verifyIdToken(token, config.googleClientId);

  return resolveManagementSessionFromGoogleClaims(
    claims,
    input.membershipLookup ?? lookupOrganizationMemberships,
  );
}

function getBearerToken(authorizationHeader: string | null | undefined) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || undefined;
}

function createGoogleVerifier(): GoogleSessionVerifier {
  const client = new OAuth2Client();

  return {
    verifyIdToken: async (idToken, audience) => {
      const ticket = await client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error("Google ID token payload is empty");
      }
      return payload;
    },
  };
}

/** Who a console request is from, and the header that tells the gateway. */
export type ConsoleIdentity = {
  session: ManagementSession;
  /** X-APICenter-User-Session (the console session) or X-APICenter-User-Token (a Google ID token). */
  gatewayHeaders: Record<string, string>;
  /** The Google ID token the request carried, when it used one rather than the session cookie. */
  googleToken?: string;
};

type AuthenticateDependencies = {
  env?: Record<string, string | undefined>;
  verifier?: GoogleSessionVerifier;
  membershipLookup?: MembershipLookupFn;
  sessionKey?: SessionKey;
};

/**
 * Authenticates a console request: the session cookie first, then a Google ID token in Authorization
 * (tabs that signed in before the session cookie existed). Throws like requireManagementSession.
 */
export async function authenticateConsoleRequest(request: Request, dependencies: AuthenticateDependencies = {}): Promise<ConsoleIdentity> {
  const env = dependencies.env ?? process.env;
  const config = getManagementAuthConfig(env);
  if (config.mode === "local-dev") return { session: createLocalDevSession(), gatewayHeaders: {} };

  const token = sessionTokenFromCookies(request.headers.get("cookie"), isSecureConsole(request.url, env));
  if (token) {
    const key = dependencies.sessionKey ?? sessionKeyFrom(env.MANAGEMENT_SESSION_SIGNING_KEY);
    if (!key) throw new Error("Management authentication required");
    // An invalid or expired session reads as signed out (401).
    const claims = verifySessionToken(key, token);
    const session = await resolveManagementSessionFromGoogleClaims(
      { sub: claims.subject, email: claims.email, email_verified: true, name: claims.name },
      dependencies.membershipLookup ?? lookupOrganizationMemberships,
    );
    return { session, gatewayHeaders: { "x-apicenter-user-session": token } };
  }

  const authorization = request.headers.get("authorization");
  const session = await requireManagementSession({
    env,
    authorizationHeader: authorization,
    verifier: dependencies.verifier,
    membershipLookup: dependencies.membershipLookup,
  });
  const googleToken = getBearerToken(authorization);
  return { session, gatewayHeaders: googleToken ? { "x-apicenter-user-token": googleToken } : {}, ...(googleToken ? { googleToken } : {}) };
}

/**
 * Whether a request that changes something comes from the console's own pages. The session cookie is
 * SameSite=Lax, so other sites cannot send it with a POST, PUT or DELETE; this refuses one that names
 * another origin anyway. Requests without browser origin headers (scripts) pass: they cannot carry the
 * person's cookie.
 */
export function isSameOriginRequest(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = new Set<string>([new URL(request.url).origin]);
  const configured = env.MANAGEMENT_PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      // A malformed setting adds nothing.
    }
  }
  return allowed.has(origin);
}
