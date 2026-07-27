import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../../src/app/api/local/registry/services/[serviceId]/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(
    async (path: string) =>
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

describe("GET /api/local/registry/services/[serviceId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies service detail reads without requiring a management session", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await GET(
      new Request("http://localhost/api/local/registry/services/payments"),
      { params: Promise.resolve({ serviceId: "payments" }) },
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      path: "/api/v1/registry/services/payments",
    });
    expect(actionMocks.requireManagementRouteAction).not.toHaveBeenCalled();
  });
});
