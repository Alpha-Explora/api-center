import { z } from "zod";
import { apiCenterAdminJson } from "./api-center-admin";
import type { MembershipLookup, MembershipLookupFn } from "./management-auth";

/** How long one email's memberships are reused before the gateway is asked again. */
export const MEMBERSHIP_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 500;

const LEGACY_CONSOLE_ROLE = {
  owner: "admin",
  admin: "admin",
  developer: "operator",
  operator: "operator",
  viewer: "observer",
  observer: "observer",
} as const;

const membershipLookupResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    email: z.string(),
    platformAdmin: z.boolean(),
    memberships: z.array(
      z.object({
        organizationId: z.string(),
        organizationSlug: z.string(),
        organizationName: z.string(),
        // Control-plane roles map onto the legacy console's role names.
        role: z
          .enum(["owner", "admin", "developer", "viewer", "operator", "observer"])
          .transform((role) => LEGACY_CONSOLE_ROLE[role]),
      }),
    ),
  }),
});

type CacheEntry = { expiresAt: number; value: Promise<MembershipLookup> };

/**
 * Wraps a lookup so each email is fetched at most once per TTL. Failed lookups are not kept, so the
 * next sign-in retries the gateway.
 */
export function createMembershipLookup(options: {
  fetchMemberships: MembershipLookupFn;
  now?: () => number;
  ttlMs?: number;
}): MembershipLookupFn {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? MEMBERSHIP_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  return (rawEmail) => {
    const email = rawEmail.trim().toLowerCase();
    const current = now();
    const cached = cache.get(email);
    if (cached && cached.expiresAt > current) {
      return cached.value;
    }

    if (cache.size >= MAX_CACHE_ENTRIES) {
      pruneCache(cache, current);
    }

    const value = options.fetchMemberships(email);
    const entry: CacheEntry = { expiresAt: current + ttlMs, value };
    cache.set(email, entry);
    value.catch(() => {
      if (cache.get(email) === entry) cache.delete(email);
    });
    return value;
  };
}

function pruneCache(cache: Map<string, CacheEntry>, current: number) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= current) cache.delete(key);
  }
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
}

async function fetchMembershipsFromGateway(email: string): Promise<MembershipLookup> {
  const body = await apiCenterAdminJson<unknown>(
    `/api/v1/admin/memberships?email=${encodeURIComponent(email)}`,
  );
  const parsed = membershipLookupResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("API Center returned an unexpected membership response");
  }
  return parsed.data.data;
}

/** Gateway-backed lookup for Google sign-in. Cached for at most 60 seconds per email. */
export const lookupOrganizationMemberships = createMembershipLookup({
  fetchMemberships: fetchMembershipsFromGateway,
});
