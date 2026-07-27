import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../src/app/api/local/registry/registration-requests/route";

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

describe("POST /api/local/registry/registration-requests", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses live guardrails for live manifest requests and strips confirmation upstream", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/registry/registration-requests", {
        method: "POST",
        body: JSON.stringify({
          manifest: {
            serviceId: "church-donations",
            name: "Spark Site",
            baseUrl: "https://wlcm-website-backend.onrender.com",
            requiredScopes: ["spark:read"],
            exposes: ["/health"],
            ownerTribeId: "church-donations",
            environments: [
              {
                environment: "live",
                baseUrl: "https://wlcm-website-backend.onrender.com",
              },
            ],
          },
          confirmation: {
            typedPhrase: "APPLY LIVE CHANGE",
            reason: "Request Spark Site live route",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      environment: "live",
      actionRisk: "provider-write",
      actionId: "registry.registration-request.create",
    });
    const init = adminMocks.apiCenterAdminRequest.mock.calls[0]?.[1] as RequestInit & { body: string };
    expect(JSON.parse(init.body)).not.toHaveProperty("confirmation");
  });
});
