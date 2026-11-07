import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMembershipLookup,
  MEMBERSHIP_CACHE_TTL_MS,
  lookupOrganizationMemberships,
} from "../../../../../src/lib/server/organization-membership";
import type { MembershipLookup } from "../../../../../src/lib/server/management-auth";

const result = (email: string): MembershipLookup => ({ email, platformAdmin: false, memberships: [] });

describe("createMembershipLookup", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("uses the versioned membership route with an origin-only gateway URL", async () => {
    vi.stubEnv("API_CENTER_BASE_URL", "http://localhost:3000");
    vi.stubEnv("API_CENTER_PLATFORM_ADMIN_SECRET", "local-test-secret");
    const email = "route-check@example.test";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: result(email) }));
    vi.stubGlobal("fetch", fetchMock);
    await lookupOrganizationMemberships(email);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/v1/admin/memberships?email=route-check%40example.test",
      expect.any(Object),
    );
  });
  it("reuses one email's lookup for up to 60 seconds", async () => {
    let current = 1_000;
    const fetchMemberships = vi.fn(async (email: string) => result(email));
    const lookup = createMembershipLookup({ fetchMemberships, now: () => current });

    await lookup("Dana@Acme.Example");
    current += MEMBERSHIP_CACHE_TTL_MS - 1;
    await lookup("dana@acme.example");

    expect(fetchMemberships).toHaveBeenCalledTimes(1);
  });

  it("asks the gateway again once the 60 second window has passed", async () => {
    let current = 1_000;
    const fetchMemberships = vi.fn(async (email: string) => result(email));
    const lookup = createMembershipLookup({ fetchMemberships, now: () => current });

    await lookup("dana@acme.example");
    current += MEMBERSHIP_CACHE_TTL_MS;
    await lookup("dana@acme.example");

    expect(fetchMemberships).toHaveBeenCalledTimes(2);
  });

  it("does not keep a failed lookup, so the next sign-in retries", async () => {
    const fetchMemberships = vi
      .fn<(email: string) => Promise<MembershipLookup>>()
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockImplementationOnce(async (email) => result(email));
    const lookup = createMembershipLookup({ fetchMemberships, now: () => 1_000 });

    await expect(lookup("dana@acme.example")).rejects.toThrow("gateway down");
    await expect(lookup("dana@acme.example")).resolves.toEqual(result("dana@acme.example"));
    expect(fetchMemberships).toHaveBeenCalledTimes(2);
  });
});
