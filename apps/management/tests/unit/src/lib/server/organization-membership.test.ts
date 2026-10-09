import { describe, expect, it, vi } from "vitest";
import {
  createMembershipLookup,
  MEMBERSHIP_CACHE_TTL_MS,
} from "../../../../../src/lib/server/organization-membership";
import type { MembershipLookup } from "../../../../../src/lib/server/management-auth";

const result = (email: string): MembershipLookup => ({ email, platformAdmin: false, memberships: [] });

describe("createMembershipLookup", () => {
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
