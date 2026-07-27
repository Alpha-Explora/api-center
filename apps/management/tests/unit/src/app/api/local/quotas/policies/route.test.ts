import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../../../../../../../../src/app/api/local/quotas/policies/[policyId]/route";
import { GET, POST } from "../../../../../../../../src/app/api/local/quotas/policies/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("/api/local/quotas/policies", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies list requests with ownerTribeId to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await GET(
      new Request(
        "http://localhost/api/local/quotas/policies?ownerTribeId=campus-one",
      ),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/quotas/policies?ownerTribeId=campus-one",
    );
    expect(actionMocks.requireManagementRouteAction).not.toHaveBeenCalled();
  });

  it("validates and proxies create requests to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await POST(
      new Request("http://localhost/api/local/quotas/policies", {
        method: "POST",
        body: JSON.stringify({
          ownerTribeId: "campus-one",
          scope: "shared",
          targetServiceId: "payment-service",
          windowSeconds: 60,
          maxRequests: 100,
          reason: "initial observe rollout",
        }),
      }),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/quotas/policies",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ownerTribeId: "campus-one",
          scope: "shared",
          targetServiceId: "payment-service",
          windowSeconds: 60,
          maxRequests: 100,
          mode: "observe",
          reason: "initial observe rollout",
        }),
      }),
    );
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRisk: "state-write",
        actionId: "quotas.policies.create",
      }),
    );
  });

  it("rejects invalid quota policy input", async () => {
    const response = await POST(
      new Request("http://localhost/api/local/quotas/policies", {
        method: "POST",
        body: JSON.stringify({
          ownerTribeId: "campus-one",
          scope: "shared",
          windowSeconds: 0,
          maxRequests: 0,
          reason: "",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("requires a management action before creating a quota policy", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await POST(
      new Request("http://localhost/api/local/quotas/policies", {
        method: "POST",
        body: JSON.stringify({
          ownerTribeId: "campus-one",
          scope: "shared",
          windowSeconds: 60,
          maxRequests: 100,
          reason: "initial observe rollout",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("proxies disable requests to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await DELETE(
      new Request("http://localhost/api/local/quotas/policies/policy-1"),
      { params: Promise.resolve({ policyId: "policy-1" }) },
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/quotas/policies/policy-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRisk: "state-write",
        actionId: "quotas.policies.delete",
      }),
    );
  });
});
