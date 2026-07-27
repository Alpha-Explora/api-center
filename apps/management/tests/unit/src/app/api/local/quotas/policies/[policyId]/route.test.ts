import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "../../../../../../../../../src/app/api/local/quotas/policies/[policyId]/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("DELETE /api/local/quotas/policies/[policyId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management action before disabling a quota policy", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await DELETE(
      new Request("http://localhost/api/local/quotas/policies/policy-1"),
      { params: Promise.resolve({ policyId: "policy-1" }) },
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
