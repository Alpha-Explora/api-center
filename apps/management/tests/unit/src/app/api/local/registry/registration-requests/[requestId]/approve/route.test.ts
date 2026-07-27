import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../../../src/app/api/local/registry/registration-requests/[requestId]/approve/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminJson: vi.fn(async () => ({
    success: true,
    data: [
      {
        id: "request-1",
        manifest: {
          serviceId: "church-donations",
          environments: [
            {
              environment: "live",
              baseUrl: "https://wlcm-website-backend.onrender.com",
            },
          ],
        },
      },
    ],
  })),
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

describe("POST /api/local/registry/registration-requests/[requestId]/approve", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the pending request and uses live guardrails before approval", async () => {
    const response = await POST(
      new Request(
        "http://localhost/api/local/registry/registration-requests/request-1/approve",
        {
          method: "POST",
          body: JSON.stringify({
            confirmation: {
              typedPhrase: "APPLY LIVE CHANGE",
              reason: "Approve Spark Site live route",
            },
          }),
        },
      ),
      { params: Promise.resolve({ requestId: "request-1" }) },
    );

    expect(response.status).toBe(200);
    expect(adminMocks.apiCenterAdminJson).toHaveBeenCalledWith(
      "/api/v1/registry/registration-requests?status=pending",
    );
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      environment: "live",
      actionRisk: "provider-write",
      actionId: "registry.registration-request.approve",
    });
    const init = adminMocks.apiCenterAdminRequest.mock.calls[0]?.[1] as RequestInit & { body: string };
    expect(init.body).toBe("{}");
  });
});
