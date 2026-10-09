import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET,
  POST,
} from "../../../../../../../../src/app/api/local/catalog/subscriptions/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({
  requireManagementSession: vi.fn(),
  requireManagementRouteAction: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-session", () => authMocks);
vi.mock("@/lib/server/require-management-action", () => authMocks);

describe("/api/local/catalog/subscriptions", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not proxy reads without a management session", async () => {
    authMocks.requireManagementSession.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );
    const response = await GET(
      new Request("http://localhost/api/local/catalog/subscriptions"),
    );
    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("does not proxy writes without an authorized management action", async () => {
    authMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );
    const response = await POST(
      new Request("http://localhost/api/local/catalog/subscriptions", {
        method: "POST",
        body: JSON.stringify({ consumerProjectId: "project-a" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("forwards the authenticated session email as the actor", async () => {
    authMocks.requireManagementRouteAction.mockResolvedValueOnce({
      session: { email: "owner@example.com" },
    });
    adminMocks.apiCenterAdminRequest.mockResolvedValueOnce(new Response(null));
    await POST(
      new Request("http://localhost/api/local/catalog/subscriptions", {
        method: "POST",
        body: JSON.stringify({ consumerProjectId: "project-a" }),
      }),
    );
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/api-subscriptions",
      expect.objectContaining({
        headers: { "x-apicenter-actor": "owner@example.com" },
      }),
    );
  });
});
