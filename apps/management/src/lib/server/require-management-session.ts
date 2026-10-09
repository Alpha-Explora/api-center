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
