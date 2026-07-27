import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../../../../../../../../src/app/api/local/developer-portal/requests/quota-increase/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({
    audit: {},
    session: {
      userId: "operator-1",
      email: "operator@example.com",
      role: "operator",
      source: "google",
    },
  }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("POST /api/local/developer-portal/requests/quota-increase", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a management action before creating an operator quota increase request", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await POST(
      new Request(
        "http://localhost/api/local/developer-portal/requests/quota-increase",
        {
          method: "POST",
          body: JSON.stringify({
            ownerTribeId: "campus-one",
            requestedMaxRequests: 50000,
            reason: "Enrollment launch",
          }),
        },
      ),
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("records the authenticated operator as requester", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await POST(
      new Request(
        "http://localhost/api/local/developer-portal/requests/quota-increase",
        {
          method: "POST",
          body: JSON.stringify({
            ownerTribeId: "campus-one",
            requestedMaxRequests: 50000,
            reason: "Enrollment launch",
          }),
        },
      ),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/approvals/requests",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"requestedBy":"operator@example.com"'),
      }),
    );
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/approvals/requests",
      expect.objectContaining({
        body: expect.not.stringContaining('"requestedBy":"campus-one"'),
      }),
    );
  });
});
