import { describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/compliance/export/route";

const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => ({
  apiCenterAdminRequest: vi.fn(
    async (path: string) =>
      new Response(JSON.stringify({ success: true, path }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ),
}));
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("GET /api/local/compliance/export", () => {
  it("requires a management session before proxying", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await GET(
      new Request("http://localhost/api/local/compliance/export"),
    );

    expect(response.status).toBe(401);
  });

  it("proxies date range and format to API Center", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/local/compliance/export?from=2026-05-01&to=2026-05-25&format=md",
      ),
    );

    const body = await response.json();

    expect(body.path).toBe(
      "/api/v1/admin/compliance/export?from=2026-05-01&to=2026-05-25&format=md",
    );
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith({
      request: expect.any(Request),
      actionRisk: "read",
      actionId: "compliance.export.read",
    });
  });
});
