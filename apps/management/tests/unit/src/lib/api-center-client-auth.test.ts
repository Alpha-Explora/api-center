import { afterEach, describe, expect, it, vi } from "vitest";
import { getManagementSession, signInWithGoogle, signOut } from "../../../../src/lib/api-center-client";

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

function respondWith(body: unknown) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api-center-client management auth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("relies on the session cookie: no token in the page, same-origin credentials", async () => {
    const fetchMock = respondWith({ success: true, data: session });
    await expect(getManagementSession()).resolves.toEqual(session);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).not.toHaveProperty("authorization");
  });

  it("exchanges a Google credential for the session, and ends it on sign-out", async () => {
    const fetchMock = respondWith({ success: true, data: session });
    await expect(signInWithGoogle("google-id-token")).resolves.toEqual(session);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/local/session", expect.objectContaining({ method: "POST", body: JSON.stringify({ credential: "google-id-token" }) }));

    await signOut();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/local/session", expect.objectContaining({ method: "DELETE" }));
  });
});
