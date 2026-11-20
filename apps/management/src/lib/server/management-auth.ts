export type ManagementAuthMode = "local-dev" | "google";
export type ManagementEnvironment = "test" | "live";
export type ManagementRole = "admin" | "operator" | "observer";

export type ManagementSession = {
  userId: string;
  email: string;
  name?: string;
  role: ManagementRole;
  source: ManagementAuthMode;
  /** Organizations this account belongs to. Platform admins act in every organization. */
  organizationIds: string[];
  /** Role attached to each membership; global role is only the highest role for UI hints. */
  organizationRoles: Record<string, ManagementRole>;
  /**
   * Organizations the console offers: each membership, plus every active organization for platform operators.
   */
  organizations: { id: string; slug: string; name: string }[];
  /** True for PLATFORM_ADMIN_EMAILS operators, who act as admin in every organization. */
  platformAdmin: boolean;
};

export type OrganizationMembership = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: ManagementRole;
};

/** Result of the gateway lookup for one email: its memberships and whether it is a platform admin. */
export type MembershipLookup = {
  email: string;
  platformAdmin: boolean;
  memberships: OrganizationMembership[];
  /** Every active organization; the gateway sends it only for platform operators. */
  organizations?: Omit<OrganizationMembership, "role">[];
};

export type MembershipLookupFn = (email: string) => Promise<MembershipLookup>;

export const NO_ORGANIZATION_ACCESS_MESSAGE =
  "This Google account does not have APICenter access. Ask an organization admin to add your email, then sign in again.";

/** The membership lookup failed, so access is unknown rather than denied. Worth retrying. */
export class AccessCheckUnavailableError extends Error {
  readonly code = "ACCESS_CHECK_UNAVAILABLE";

  constructor(
    email: string,
    /** Why the lookup failed, for server logs; not shown to people. */
    readonly reason: string,
  ) {
    super(`Could not confirm APICenter access for ${email}. APICenter may be starting up or busy; try again in a few seconds.`);
    this.name = "AccessCheckUnavailableError";
  }
}

const ROLE_RANK: Record<ManagementRole, number> = {
  observer: 1,
  operator: 2,
  admin: 3,
};

export type ManagementAuthConfig = {
  mode: ManagementAuthMode;
  environment: ManagementEnvironment;
  publicBaseUrl: string;
  googleClientId?: string;
};

type EnvLike = Record<string, string | undefined>;

export type GoogleClaims = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export function getManagementAuthConfig(env: EnvLike = process.env): ManagementAuthConfig {
  const mode = resolveManagementAuthMode(env);
  const environment = (env.MANAGEMENT_ENVIRONMENT ?? "test") as ManagementEnvironment;

  if (mode !== "local-dev" && mode !== "google") {
    throw new Error(`Unsupported MANAGEMENT_AUTH_MODE: ${mode}`);
  }

  if (environment !== "test" && environment !== "live") {
    throw new Error(`Unsupported MANAGEMENT_ENVIRONMENT: ${environment}`);
  }

  if (mode === "local-dev" && isDeployedOrLive(env, environment)) {
    throw new Error("local-dev management auth is not allowed outside local test development");
  }

  if (mode === "google") {
    if (!env.GOOGLE_CLIENT_ID && !env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
      throw new Error("GOOGLE_CLIENT_ID or NEXT_PUBLIC_GOOGLE_CLIENT_ID is required");
    }
  }

  return {
    mode,
    environment,
    publicBaseUrl: env.MANAGEMENT_PUBLIC_BASE_URL ?? "http://localhost:3000",
    googleClientId: env.GOOGLE_CLIENT_ID ?? env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  };
}

function resolveManagementAuthMode(env: EnvLike): ManagementAuthMode {
  const rawMode = env.MANAGEMENT_AUTH_MODE?.trim();
  if (rawMode) {
    return rawMode as ManagementAuthMode;
  }

  const environment = env.MANAGEMENT_ENVIRONMENT ?? "test";
  if (isDeployedOrLive(env, environment as ManagementEnvironment)) {
    throw new Error("MANAGEMENT_AUTH_MODE is required outside local test development");
  }

  return "local-dev";
}

function isDeployedOrLive(env: EnvLike, environment: ManagementEnvironment) {
  // Cloud Run always sets K_SERVICE; local-dev sign-in must never run there.
  if (environment === "live" || Boolean(env.K_SERVICE?.trim())) {
    return true;
  }

  const publicBaseUrl = env.MANAGEMENT_PUBLIC_BASE_URL?.trim();
  if (!publicBaseUrl || publicBaseUrl.includes("<")) {
    return false;
  }

  try {
    const hostname = new URL(publicBaseUrl).hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

export function createLocalDevSession(): ManagementSession {
  return {
    userId: "local-dev",
    email: "local-dev@api-center.internal",
    name: "Local Developer",
    role: "admin",
    source: "local-dev",
    organizationIds: [],
    organizationRoles: {},
    organizations: [],
    platformAdmin: true,
  };
}

export async function resolveManagementSessionFromGoogleClaims(
  claims: GoogleClaims,
  lookupMemberships: MembershipLookupFn,
): Promise<ManagementSession> {
  if (!claims.email || claims.email_verified !== true) {
    throw new Error("Verified Google email is required");
  }

  const email = claims.email.trim().toLowerCase();
  let lookup: MembershipLookup;
  try {
    lookup = await lookupMemberships(email);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new AccessCheckUnavailableError(email, reason);
  }

  return sessionFromMembershipLookup(
    { userId: claims.sub ?? email, email, name: claims.name },
    lookup,
  );
}

/**
 * Platform admins act as admin everywhere. Everyone else gets the highest role across their
 * memberships. An account with no membership cannot sign in.
 */
export function sessionFromMembershipLookup(
  identity: { userId: string; email: string; name?: string },
  lookup: MembershipLookup,
): ManagementSession {
  const organizationIds = lookup.memberships.map((membership) => membership.organizationId);
  const organizationRoles = Object.fromEntries(
    lookup.memberships.map(({ organizationId, role }) => [organizationId, role]),
  );
  const organizations = lookup.memberships.map(({ organizationId, organizationSlug, organizationName }) => ({
    id: organizationId,
    slug: organizationSlug,
    name: organizationName,
  }));
  if (lookup.platformAdmin) {
    // Platform operators can act in any organization, so the console lists them all.
    for (const { organizationId, organizationSlug, organizationName } of lookup.organizations ?? []) {
      if (!organizations.some((entry) => entry.id === organizationId)) {
        organizations.push({ id: organizationId, slug: organizationSlug, name: organizationName });
      }
    }
  }

  if (lookup.platformAdmin) {
    return { ...identity, role: "admin", source: "google", platformAdmin: true, organizationIds, organizationRoles, organizations };
  }

  const role = highestRole(lookup.memberships.map((membership) => membership.role));
  if (!role) {
    throw new Error(NO_ORGANIZATION_ACCESS_MESSAGE);
  }

  return { ...identity, role, source: "google", platformAdmin: false, organizationIds, organizationRoles, organizations };
}

function highestRole(roles: ManagementRole[]): ManagementRole | undefined {
  return roles.reduce<ManagementRole | undefined>(
    (best, role) => (!best || ROLE_RANK[role] > ROLE_RANK[best] ? role : best),
    undefined,
  );
}
