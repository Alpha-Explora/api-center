import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/quotas/usage/route";

const requestMocks = vi.hoisted(() => ({ apiCenterAdminRequest: vi.fn() }));
const accessMocks = vi.hoisted(() => ({
  authorizeTribe: vi
    .fn()
    .mockRejectedValue(new Error("Organization access denied")),
  requirePlatformAdministrator: vi.fn(),
}));
const sessionMocks = vi.hoisted(() => ({
  requireManagementSession: vi.fn().mockResolvedValue({
    userId: "member-a",
    email: "member@example.com",
    role: "admin",
    source: "google",
    platformAdmin: false,
    organizationIds: ["org-a"],
    organizationRoles: { "org-a": "observer" },
  }),
}));

vi.mock("@/lib/server/api-center-admin", () => requestMocks);
vi.mock("@/lib/server/organization-access", () => accessMocks);
vi.mock("@/lib/server/require-management-session", () => sessionMocks);

describe("GET /api/local/quotas/usage", () => {
  afterEach(() => vi.clearAllMocks());

  it("requires a valid tribe scope and denies an observer from another organization", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/local/quotas/usage?ownerTribeId=tribe-b",
      ),
    );

    expect(accessMocks.authorizeTribe).toHaveBeenCalledWith(
      expect.any(Request),
      "tribe-b",
      "observer",
    );
    expect(response.status).toBe(403);
    expect(requestMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("requires organization members to name the tribe whose usage they are reading", async () => {
    const response = await GET(
      new Request("http://localhost/api/local/quotas/usage"),
    );

    expect(response.status).toBe(400);
    expect(requestMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("preserves platform-wide usage access for platform administrators", async () => {
    sessionMocks.requireManagementSession.mockResolvedValueOnce({
      userId: "platform-admin",
      email: "platform@example.com",
      role: "admin",
      source: "google",
      platformAdmin: true,
      organizationIds: [],
      organizationRoles: {},
    });
    accessMocks.requirePlatformAdministrator.mockResolvedValueOnce({
      platformAdmin: true,
    });
    requestMocks.apiCenterAdminRequest.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
      }),
    );

    await GET(new Request("http://localhost/api/local/quotas/usage?window=7d"));

    expect(requestMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/quotas/usage?window=7d",
    );
  });
});
