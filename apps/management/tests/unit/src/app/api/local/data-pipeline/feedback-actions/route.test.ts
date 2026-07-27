import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../src/app/api/local/data-pipeline/feedback-actions/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("POST /api/local/data-pipeline/feedback-actions", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management action before creating feedback", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValue(
      new Error("Management authentication required"),
    );

    const response = await POST(
      new Request("http://localhost/api/local/data-pipeline/feedback-actions", {
        method: "POST",
        body: JSON.stringify({
          action: "evidence.reviewed",
          environment: "test",
          targetType: "topic",
          targetId: "test.tribe.campus-one.events",
          reason: "Reviewed",
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
