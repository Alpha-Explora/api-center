import { describe, expect, it, vi } from "vitest";
import { proxyControlPlane } from "@/lib/server/control-plane-proxy";

const ORG = "6f1c1d1e-0000-4000-8000-000000000401";

function setup(sessionOk = true) {
  const requireSession = vi.fn(async () => {
    if (!sessionOk) throw new Error("Management authentication required");
    return {} as never;
  });
  const forward = vi.fn<(path: string, init?: unknown) => Promise<Response>>(async () => Response.json({ success: true, data: [] }));
  return { requireSession, forward, deps: { requireSession, forward } as never };
}

describe("proxyControlPlane", () => {
  it("forwards to the gateway as the signed-in member", async () => {
    const { forward, deps } = setup();
    const request = new Request(`http://console.test/api/local/control-plane/organizations/${ORG}/projects?x=1`, {
      method: "POST",
      headers: { authorization: "Bearer google-id-token" },
      body: JSON.stringify({ slug: "shop", name: "Shop" }),
    });

    const response = await proxyControlPlane(request, ["organizations", ORG, "projects"], deps);

    expect(response.status).toBe(200);
    expect(forward).toHaveBeenCalledWith(`/api/v1/admin/control-plane/organizations/${ORG}/projects?x=1`, {
      method: "POST",
      body: JSON.stringify({ slug: "shop", name: "Shop" }),
      headers: { "x-apicenter-user-token": "google-id-token" },
      timeoutMs: 20_000,
    });
  });

  it("keeps member emails intact in member routes", async () => {
    const { forward, deps } = setup();
    const request = new Request("http://console.test/x", { method: "DELETE", headers: { authorization: "Bearer t" } });
    await proxyControlPlane(request, ["organizations", ORG, "members", "dev@example.com"], deps);
    expect(forward.mock.calls[0][0]).toBe(`/api/v1/admin/control-plane/organizations/${ORG}/members/dev%40example.com`);
  });

  it("rejects paths outside the control-plane API and traversal", async () => {
    const { forward, deps } = setup();
    const request = new Request("http://console.test/x", { headers: { authorization: "Bearer t" } });
    for (const segments of [["registry", "register"], ["organizations", "..", "admin"], ["organizations", "a/b"], []]) {
      expect((await proxyControlPlane(request, segments, deps)).status).toBe(404);
    }
    expect(forward).not.toHaveBeenCalled();
  });

  it("requires a management session", async () => {
    const { forward, deps } = setup(false);
    const response = await proxyControlPlane(new Request("http://console.test/x"), ["capabilities"], deps);
    expect(response.status).toBe(401);
    expect(forward).not.toHaveBeenCalled();
  });

  it("acts as the platform only when there is no user token (local development)", async () => {
    const { forward, deps } = setup();
    await proxyControlPlane(new Request("http://console.test/x"), ["capabilities"], deps);
    expect(forward.mock.calls[0][1]).toMatchObject({ method: "GET", headers: {} });
  });
});
