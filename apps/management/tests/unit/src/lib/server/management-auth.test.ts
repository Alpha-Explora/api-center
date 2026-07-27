import { describe, expect, it } from "vitest";
import {
  getManagementAuthConfig,
  resolveManagementSessionFromGoogleClaims,
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

describe("resolveManagementSessionFromGoogleClaims", () => {
  it("maps verified Google emails into admin management sessions", () => {
    const session = resolveManagementSessionFromGoogleClaims({
      sub: "user-1",
      email: "ops@example.com",
      email_verified: true,
      name: "Ops User",
    });

    expect(session).toEqual({
      userId: "user-1",
      email: "ops@example.com",
      name: "Ops User",
      role: "admin",
      source: "google",
    });
  });

  it("rejects unverified Google emails", () => {
    expect(() =>
      resolveManagementSessionFromGoogleClaims({
        sub: "user-3",
        email: "admin@example.com",
        email_verified: false,
      }),
    ).toThrow("Verified Google email is required");
  });
});
