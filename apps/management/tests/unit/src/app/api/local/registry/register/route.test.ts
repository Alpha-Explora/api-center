import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../src/app/api/local/registry/register/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(
    async (path: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, path }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("POST /api/local/registry/register", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an auth response instead of an uncaught 500 when session issuer validation fails", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication issuer mismatch"),
    );

    const response = await POST(
      new Request("http://localhost/api/local/registry/register", {
        method: "POST",
        body: JSON.stringify({ serviceId: "payments" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Management authentication issuer mismatch",
    });
    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("proxies registry updates after write authorization", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/registry/register", {
        method: "POST",
        body: JSON.stringify({ serviceId: "payments" }),
      }),
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      path: "/api/v1/registry/register",
    });
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      environment: "test",
      actionRisk: "state-write",
      actionId: "registry.register",
    });
  });

  it("uses live action guardrails for live registry updates and strips confirmation upstream", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/registry/register", {
        method: "POST",
        body: JSON.stringify({
          serviceId: "church-donations",
          name: "Spark Site",
          baseUrl: "https://wlcm-website-backend.onrender.com",
          requiredScopes: ["spark:read"],
          exposes: ["/health"],
          consumes: ["payment"],
          ownerTribeId: "church-donations",
          serviceType: "tribe",
          environments: [
            {
              environment: "live",
              baseUrl: "https://wlcm-website-backend.onrender.com",
            },
          ],
          confirmation: {
            typedPhrase: "APPLY LIVE CHANGE",
            reason: "Approve Spark Site live route",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      environment: "live",
      actionRisk: "provider-write",
      actionId: "registry.register",
    });
    const init = adminMocks.apiCenterAdminRequest.mock.calls[0]?.[1] as RequestInit & { body: string };
    expect(JSON.parse(init.body)).not.toHaveProperty("confirmation");
  });
});