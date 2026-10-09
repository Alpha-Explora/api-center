import { afterEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "../../../../../../../../../../src/app/api/local/catalog/subscriptions/[id]/[action]/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("/api/local/catalog/subscriptions/[id]/[action]", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not proxy decisions without an authorized management action", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );
    const response = await PATCH(
      new Request(
        "http://localhost/api/local/catalog/subscriptions/sub-1/approve",
        {
          method: "PATCH",
          body: JSON.stringify({ apiServiceId: "owner-api" }),
        },
      ),
      { params: Promise.resolve({ id: "sub-1", action: "approve" }) },
    );
    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("requires and forwards the API owner identity with the action", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValueOnce({
      session: { email: "owner@example.com" },
    });
    adminMocks.apiCenterAdminRequest.mockResolvedValueOnce(new Response(null));
    await PATCH(
      new Request(
        "http://localhost/api/local/catalog/subscriptions/sub-1/approve",
        {
          method: "PATCH",
          body: JSON.stringify({
            apiServiceId: "owner-api",
            reason: "approved",
          }),
        },
      ),
      { params: Promise.resolve({ id: "sub-1", action: "approve" }) },
    );
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/api-subscriptions/sub-1/approve",
      expect.objectContaining({
        body: JSON.stringify({ apiServiceId: "owner-api", reason: "approved" }),
        headers: { "x-apicenter-actor": "owner@example.com" },
      }),
    );
  });
});
