import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireManagementSessionMock, lookupMock } = vi.hoisted(() => ({
  requireManagementSessionMock: vi.fn(),
  lookupMock: vi.fn(),
}));

vi.mock("@/lib/server/organization-membership", () => ({ lookupOrganizationMemberships: lookupMock }));
vi.mock("@/lib/server/require-management-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/require-management-session")>();
  return { ...actual, requireManagementSession: requireManagementSessionMock };
});

import { DELETE, GET, POST } from "@/app/api/local/session/route";
import { authenticateConsoleRequest, isSameOriginRequest } from "@/lib/server/require-management-session";
import { issueSessionToken, sessionCookie, sessionKeyFrom } from "@/lib/server/console-session";

const { privateKey } = generateKeyPairSync("ed25519");
const SIGNING_KEY = JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "console-test" });
const ENV = {
  MANAGEMENT_AUTH_MODE: "google",
  MANAGEMENT_ENVIRONMENT: "test",
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  MANAGEMENT_PUBLIC_BASE_URL: "https://console.test",
  MANAGEMENT_SESSION_SIGNING_KEY: SIGNING_KEY,
};
const SESSION = {
  userId: "google-sub-1",
  email: "amgo.it@alphaexplora.com",
  name: "Amgo",
  role: "admin",
  source: "google",
  platformAdmin: false,
  organizationIds: ["org-1"],
  organizationRoles: { "org-1": "admin" },
  organizations: [{ id: "org-1", slug: "alpha", name: "Alpha Explora" }],
};
const MEMBERSHIPS = {
  email: SESSION.email,
  platformAdmin: false,
  memberships: [{ organizationId: "org-1", organizationSlug: "alpha", organizationName: "Alpha Explora", role: "admin" }],
};

describe("console session routes", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [name, value] of Object.entries(ENV)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    requireManagementSessionMock.mockResolvedValue(SESSION);
    lookupMock.mockResolvedValue(MEMBERSHIPS);
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.clearAllMocks();
  });

  it("signs in with a Google credential and sets an HttpOnly, Secure, SameSite cookie for 12 hours", async () => {
    const response = await POST(
      new Request("https://console.test/api/local/session", {
        method: "POST",
        headers: { origin: "https://console.test", "content-type": "application/json" },
        body: JSON.stringify({ credential: "google-id-token" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(requireManagementSessionMock).toHaveBeenCalledWith({ authorizationHeader: "Bearer google-id-token" });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-apicenter_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200; Secure$/);

    // The same browser is then signed in from the cookie alone, in any tab.
    const token = cookie.split(";")[0].split("=")[1];
    const check = await GET(new Request("https://console.test/api/local/session", { headers: { cookie: `__Host-apicenter_session=${token}` } }));
    expect(check.status).toBe(200);
    expect(lookupMock).toHaveBeenCalledWith(SESSION.email);
  });

  it("refuses a sign-in or sign-out that another site sends", async () => {
    const crossSite = { origin: "https://evil.example", "sec-fetch-site": "cross-site" };
    expect((await POST(new Request("https://console.test/api/local/session", { method: "POST", headers: crossSite, body: "{}" }))).status).toBe(403);
    expect((await DELETE(new Request("https://console.test/api/local/session", { method: "DELETE", headers: crossSite }))).status).toBe(403);
    expect(requireManagementSessionMock).not.toHaveBeenCalled();
  });

  it("signs out by clearing the cookie", async () => {
    const response = await DELETE(new Request("https://console.test/api/local/session", { method: "DELETE", headers: { origin: "https://console.test" } }));
    expect(response.headers.get("set-cookie")).toContain("__Host-apicenter_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("treats an expired or forged session as signed out", async () => {
    const key = sessionKeyFrom(SIGNING_KEY)!;
    const expired = issueSessionToken(key, { subject: "s", email: SESSION.email }, Date.now() - 13 * 60 * 60 * 1000);
    for (const token of [expired, "forged.token.value"]) {
      const response = await GET(new Request("https://console.test/api/local/session", { headers: { cookie: `__Host-apicenter_session=${token}` } }));
      expect(response.status).toBe(401);
    }
  });
});

describe("authenticateConsoleRequest", () => {
  it("forwards the console session to the gateway, not a Google token", async () => {
    const key = sessionKeyFrom(SIGNING_KEY)!;
    const token = issueSessionToken(key, { subject: "google-sub-1", email: SESSION.email });
    const identity = await authenticateConsoleRequest(new Request("https://console.test/x", { headers: { cookie: `other=1; ${sessionCookie(token, true).split(";")[0]}` } }), {
      env: ENV,
      sessionKey: key,
      membershipLookup: async () => MEMBERSHIPS as never,
    });
    expect(identity.gatewayHeaders).toEqual({ "x-apicenter-user-session": token });
    expect(identity.session).toMatchObject({ email: SESSION.email, userId: "google-sub-1" });
  });
});

describe("isSameOriginRequest", () => {
  it("allows reads, same-origin changes and scripts without browser origin headers", () => {
    expect(isSameOriginRequest(new Request("https://console.test/x"), ENV)).toBe(true);
    expect(isSameOriginRequest(new Request("https://console.test/x", { method: "POST", headers: { origin: "https://console.test", "sec-fetch-site": "same-origin" } }), ENV)).toBe(true);
    expect(isSameOriginRequest(new Request("https://console.test/x", { method: "POST" }), ENV)).toBe(true);
  });

  it("refuses changes from another site", () => {
    expect(isSameOriginRequest(new Request("https://console.test/x", { method: "PUT", headers: { origin: "https://evil.example" } }), ENV)).toBe(false);
    expect(isSameOriginRequest(new Request("https://console.test/x", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } }), ENV)).toBe(false);
  });
});
