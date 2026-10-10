import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/local/catalog/subscriptions/route";
import { PATCH } from "@/app/api/local/catalog/subscriptions/[id]/[action]/route";

const adminMocks = vi.hoisted(() => ({ apiCenterAdminRequest: vi.fn() }));
const actionMocks = vi.hoisted(() => ({ requireManagementRouteAction: vi.fn() }));
const organizationMocks = vi.hoisted(() => ({
  authorizeProject: vi.fn(),
  authorizeService: vi.fn(),
  managementOrganizationFilter: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);
vi.mock("@/lib/server/organization-access", () => organizationMocks);

const request = (path: string, init?: RequestInit) =>
  new Request(`http://localhost${path}`, {
    headers: { authorization: "Bearer session-token", "content-type": "application/json" },
    ...init,
  });

describe("organization-scoped API subscription routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("allows a consumer project in the caller's organization to request access", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValue({ session: { email: "member@example.com" } });
    adminMocks.apiCenterAdminRequest.mockResolvedValue(Response.json({ success: true }));

    const response = await POST(request("/api/local/catalog/subscriptions", {
      method: "POST",
      body: JSON.stringify({ consumerProjectId: "project-a", apiServiceId: "payments", environment: "test" }),
    }));

    expect(response.status).toBe(200);
    expect(organizationMocks.authorizeProject).toHaveBeenCalledWith(expect.any(Request), "project-a", "operator");
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/api-subscriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("denies a request for a project in another organization before forwarding", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValue({ session: { email: "member@example.com" } });
    organizationMocks.authorizeProject.mockRejectedValue(new Error("Organization access denied"));

    const response = await POST(request("/api/local/catalog/subscriptions", {
      method: "POST",
      body: JSON.stringify({ consumerProjectId: "project-b", apiServiceId: "payments", environment: "test" }),
    }));

    expect(response.status).toBe(403);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("allows a platform admin to decide an API owner's subscription request", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValue({ session: { email: "admin@example.com" } });
    adminMocks.apiCenterAdminRequest.mockResolvedValue(Response.json({ success: true }));

    const response = await PATCH(request("/api/local/catalog/subscriptions/request-1/approve", {
      method: "PATCH",
      body: JSON.stringify({ apiServiceId: "payments" }),
    }), { params: Promise.resolve({ id: "request-1", action: "approve" }) });

    expect(response.status).toBe(200);
    expect(organizationMocks.authorizeService).toHaveBeenCalledWith(expect.any(Request), "payments", "operator");
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/api-subscriptions/request-1/approve",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("denies an owner decision when the API belongs to another organization", async () => {
    actionMocks.requireManagementRouteAction.mockResolvedValue({ session: { email: "member@example.com" } });
    organizationMocks.authorizeService.mockRejectedValue(new Error("Organization access denied"));

    const response = await PATCH(request("/api/local/catalog/subscriptions/request-1/approve", {
      method: "PATCH",
      body: JSON.stringify({ apiServiceId: "other-org-api" }),
    }), { params: Promise.resolve({ id: "request-1", action: "approve" }) });

    expect(response.status).toBe(403);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });

  it("scopes a subscription collection read to the caller's organizations", async () => {
    organizationMocks.managementOrganizationFilter.mockResolvedValue("org-a,org-b");
    adminMocks.apiCenterAdminRequest.mockResolvedValue(Response.json({ success: true, data: [] }));

    const response = await GET(request("/api/local/catalog/subscriptions"));

    expect(response.status).toBe(200);
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/api-subscriptions?organizationId=org-a%2Corg-b",
    );
  });
});
