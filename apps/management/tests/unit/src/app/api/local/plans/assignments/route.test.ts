import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../../../../../../../../src/app/api/local/plans/assignments/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("POST /api/local/plans/assignments", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management action before assigning a plan", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await POST(
      new Request("http://localhost/api/local/plans/assignments", {
        method: "POST",
        body: JSON.stringify({
          projectId: "campus-one-default",
          planKey: "standard",
          environment: "live",
          reason: "Go live",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("proxies plan assignments after management action approval", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
      }),
    );

    await POST(
      new Request("http://localhost/api/local/plans/assignments", {
        method: "POST",
        body: JSON.stringify({
          projectId: "campus-one-default",
          planKey: "standard",
          environment: "live",
          reason: "Go live",
        }),
      }),
    );

    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRisk: "state-write",
        actionId: "plans.assignments.create",
      }),
    );
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/plans/assignments",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"environment":"live"'),
      }),
    );
  });

  it("passes live assignment filters through unchanged", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
      }),
    );

    await GET(
      new Request(
        "http://localhost/api/local/plans/assignments?projectId=campus-one-default&environment=live&status=active",
      ),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/plans/assignments?projectId=campus-one-default&environment=live&status=active",
    );
  });

  it("rejects the retired prod environment filter", async () => {
    const response = await GET(
      new Request("http://localhost/api/local/plans/assignments?environment=prod"),
    );

    expect(response.status).toBe(400);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
