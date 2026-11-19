import { afterEach, describe, expect, it, vi } from "vitest";
import { getManagementSession, setManagementSessionToken } from "../../../../src/lib/api-center-client";

describe("api-center-client management auth", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    vi.restoreAllMocks();
  });

  it("attaches the Google session token to local API requests", async () => {
    const session = {
      userId: "u_1",
      email: "person@example.test",
      role: "admin",
      source: "google",
      organizationIds: ["org_1"],
      organizationRoles: { org_1: "admin" },
      organizations: [{ id: "org_1", slug: "acme", name: "Acme" }],
      platformAdmin: false,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: session }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    setManagementSessionToken("session-token");
    await expect(getManagementSession()).resolves.toEqual(session);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/session",
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer session-token" }) }),
    );
  });
});
