import { describe, expect, it, vi } from "vitest";
import { requireManagementSession } from "../../../../../src/lib/server/require-management-session";

const ACME = "3d1f8c2a-aaaa-4bbb-8ccc-000000000001";

describe("requireManagementSession", () => {
  it("returns a local admin session in local-dev mode", async () => {
    const session = await requireManagementSession({
      env: {
        MANAGEMENT_AUTH_MODE: "local-dev",
        MANAGEMENT_ENVIRONMENT: "test",
      },
    });

    expect(session.role).toBe("admin");
    expect(session.source).toBe("local-dev");
    expect(session.platformAdmin).toBe(true);
  });

  it("rejects missing Google bearer tokens in google mode", async () => {
    await expect(
      requireManagementSession({
        env: {
          MANAGEMENT_AUTH_MODE: "google",
          MANAGEMENT_ENVIRONMENT: "live",
          NEXT_PUBLIC_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
        },
        authorizationHeader: null,
      }),
    ).rejects.toThrow("Management authentication required");
  });

  it("does not create local-dev sessions for deployed runtimes", async () => {
    await expect(
      requireManagementSession({
        env: {
          MANAGEMENT_AUTH_MODE: "local-dev",
          MANAGEMENT_ENVIRONMENT: "test",
          MANAGEMENT_PUBLIC_BASE_URL: "https://management.example.com",
        },
      }),
    ).rejects.toThrow("local-dev management auth is not allowed");
  });

  it("validates a Google ID token and builds the session from the membership lookup", async () => {
    const membershipLookup = vi.fn(async (email: string) => ({
      email,
      platformAdmin: false,
      memberships: [
        { organizationId: ACME, organizationSlug: "acme", organizationName: "Acme", role: "admin" as const },
      ],
    }));

    const session = await requireManagementSession({
      env: {
        MANAGEMENT_AUTH_MODE: "google",
        MANAGEMENT_ENVIRONMENT: "live",
        NEXT_PUBLIC_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
      },
      authorizationHeader: "Bearer google-id-token",
      verifier: {
        verifyIdToken: async (idToken, audience) => {
          expect(idToken).toBe("google-id-token");
          expect(audience).toBe("client-id.apps.googleusercontent.com");

          return {
            sub: "user-1",
            email: "ops@example.com",
            email_verified: true,
          };
        },
      },
      membershipLookup,
    });

    expect(membershipLookup).toHaveBeenCalledWith("ops@example.com");
    expect(session).toMatchObject({
      userId: "user-1",
      email: "ops@example.com",
      role: "admin",
      source: "google",
      platformAdmin: false,
      organizationIds: [ACME],
    });
  });

  it("denies a verified Google account that has no organization membership", async () => {
    await expect(
      requireManagementSession({
        env: {
          MANAGEMENT_AUTH_MODE: "google",
          MANAGEMENT_ENVIRONMENT: "live",
          NEXT_PUBLIC_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
        },
        authorizationHeader: "Bearer google-id-token",
        verifier: {
          verifyIdToken: async () => ({ sub: "user-2", email: "stranger@example.com", email_verified: true }),
        },
        membershipLookup: async (email) => ({ email, platformAdmin: false, memberships: [] }),
      }),
    ).rejects.toThrow("Ask an organization admin to add your email");
  });
});
