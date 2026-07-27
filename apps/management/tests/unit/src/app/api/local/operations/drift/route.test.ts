import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../src/app/api/local/operations/drift/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("POST /api/local/operations/drift", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management action before comparing drift", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValue(
      new Error("Management authentication required"),
    );

    const response = await POST(
      new Request("http://localhost/api/local/operations/drift", {
        method: "POST",
        body: JSON.stringify({ quotaPolicies: [] }),
      }),
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
