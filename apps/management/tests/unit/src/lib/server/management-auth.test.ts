import { describe, expect, it, vi } from "vitest";
import {
  getManagementAuthConfig,
  resolveManagementSessionFromGoogleClaims,
  type MembershipLookup,
} from "../../../../../src/lib/server/management-auth";

describe("getManagementAuthConfig", () => {
  it("defaults to local-dev for local development", () => {
    const config = getManagementAuthConfig({
      MANAGEMENT_AUTH_MODE: "local-dev",
      MANAGEMENT_ENVIRONMENT: "test",
    });

    expect(config.mode).toBe("local-dev");
    expect(config.environment).toBe("test");
  });

  it("requires a Google client ID when google mode is enabled", () => {
    expect(() =>
      getManagementAuthConfig({
        MANAGEMENT_AUTH_MODE: "google",
        MANAGEMENT_ENVIRONMENT: "live",
      }),
    ).toThrow("GOOGLE_CLIENT_ID or NEXT_PUBLIC_GOOGLE_CLIENT_ID is required");
  });

  it("accepts Google mode with only a browser client ID", () => {
    const config = getManagementAuthConfig({
      MANAGEMENT_AUTH_MODE: "google",
      MANAGEMENT_ENVIRONMENT: "live",
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    });

    expect(config.googleClientId).toBe("client-id.apps.googleusercontent.com");
  });

  it("requires an explicit auth mode for deployed runtimes", () => {
    expect(() =>
      getManagementAuthConfig({
        MANAGEMENT_ENVIRONMENT: "test",
        MANAGEMENT_PUBLIC_BASE_URL: "https://management.example.com",
      }),
    ).toThrow("MANAGEMENT_AUTH_MODE is required outside local test development");
  });

  it("rejects local-dev auth for live environments", () => {
    expect(() =>
      getManagementAuthConfig({
        MANAGEMENT_AUTH_MODE: "local-dev",
        MANAGEMENT_ENVIRONMENT: "live",
      }),
    ).toThrow("local-dev management auth is not allowed");
  });
});

const ACME = "3d1f8c2a-aaaa-4bbb-8ccc-000000000001";
const BETA = "3d1f8c2a-aaaa-4bbb-8ccc-000000000002";
const claims = {
  sub: "google-sub-1",
  email: "  Dana@Acme.Example ",
  email_verified: true,
  name: "Dana",
};

function lookupReturning(lookup: Omit<MembershipLookup, "email">) {
  return vi.fn(async (email: string) => ({ email, ...lookup }));
}

describe("resolveManagementSessionFromGoogleClaims", () => {
  it("builds an operator session from a member's highest role and organization ids", async () => {
    const lookup = lookupReturning({
      platformAdmin: false,
      memberships: [
        { organizationId: ACME, organizationSlug: "acme", organizationName: "Acme", role: "observer" },
        { organizationId: BETA, organizationSlug: "beta", organizationName: "Beta", role: "operator" },
      ],
    });

    const session = await resolveManagementSessionFromGoogleClaims(claims, lookup);

    expect(lookup).toHaveBeenCalledWith("dana@acme.example");
    expect(session).toEqual({
      userId: "google-sub-1",
      email: "dana@acme.example",
      name: "Dana",
      role: "operator",
      source: "google",
      platformAdmin: false,
      organizationIds: [ACME, BETA],
    });
  });

  it("gives admin when any membership is admin", async () => {
    const session = await resolveManagementSessionFromGoogleClaims(
      claims,
      lookupReturning({
        platformAdmin: false,
        memberships: [
          { organizationId: ACME, organizationSlug: "acme", organizationName: "Acme", role: "operator" },
          { organizationId: BETA, organizationSlug: "beta", organizationName: "Beta", role: "admin" },
        ],
      }),
    );

    expect(session.role).toBe("admin");
    expect(session.platformAdmin).toBe(false);
  });

  it("denies an account with no membership and explains who to ask", async () => {
    await expect(
      resolveManagementSessionFromGoogleClaims(
        claims,
        lookupReturning({ platformAdmin: false, memberships: [] }),
      ),
    ).rejects.toThrow("Ask an organization admin to add your email");
  });

  it("gives a platform admin admin access with no membership required", async () => {
    const session = await resolveManagementSessionFromGoogleClaims(
      claims,
      lookupReturning({ platformAdmin: true, memberships: [] }),
    );

    expect(session).toMatchObject({
      role: "admin",
      platformAdmin: true,
      organizationIds: [],
      source: "google",
    });
  });

  it("fails closed with a clear error when the gateway lookup fails", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("API Center returned 503: unavailable");
    });

    await expect(resolveManagementSessionFromGoogleClaims(claims, lookup)).rejects.toThrow(
      "Could not confirm APICenter access for dana@acme.example: API Center returned 503: unavailable. Sign-in was not completed",
    );
  });

  it("rejects unverified Google emails before looking anything up", async () => {
    const lookup = vi.fn();

    await expect(
      resolveManagementSessionFromGoogleClaims(
        { sub: "user-3", email: "admin@example.com", email_verified: false },
        lookup,
      ),
    ).rejects.toThrow("Verified Google email is required");
    expect(lookup).not.toHaveBeenCalled();
  });
});
