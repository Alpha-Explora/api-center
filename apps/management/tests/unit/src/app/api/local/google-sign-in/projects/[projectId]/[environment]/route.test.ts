import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/local/google-sign-in/projects/[projectId]/[environment]/route";

const accessMocks = vi.hoisted(() => ({ authorizeProject: vi.fn().mockResolvedValue(undefined) }));
const gatewayMocks = vi.hoisted(() => ({ apiCenterAdminRequest: vi.fn(() => Response.json({ redirectUris: [] })) }));

vi.mock("@/lib/server/organization-access", () => accessMocks);
vi.mock("@/lib/server/api-center-admin", () => gatewayMocks);

describe("project Google sign-in routes", () => {
  afterEach(() => vi.clearAllMocks());

  it("authorizes project reads and forwards to the gateway admin endpoint", async () => {
    const request = new Request("http://localhost/api/local/google-sign-in/projects/shop/test");
    const response = await GET(request, { params: Promise.resolve({ projectId: "shop", environment: "test" }) });
    expect(response.status).toBe(200);
    expect(accessMocks.authorizeProject).toHaveBeenCalledWith(request, "shop", "observer");
    expect(gatewayMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/projects/shop/google-sign-in/test",
      { method: "GET" },
    );
  });

  it("requires operator access before forwarding project setting changes", async () => {
    const request = new Request("http://localhost/api/local/google-sign-in/projects/shop/live", {
      method: "PUT",
      body: JSON.stringify({ redirectUris: ["https://shop.example.test/callback"] }),
    });
    await PUT(request, { params: Promise.resolve({ projectId: "shop", environment: "live" }) });
    expect(accessMocks.authorizeProject).toHaveBeenCalledWith(request, "shop", "operator");
    expect(gatewayMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/projects/shop/google-sign-in/live",
      { method: "PUT", body: JSON.stringify({ redirectUris: ["https://shop.example.test/callback"] }) },
    );
  });

  it("does not forward requests for a project the caller cannot access", async () => {
    accessMocks.authorizeProject.mockRejectedValueOnce(new Error("Organization access denied"));
    const response = await GET(
      new Request("http://localhost/api/local/google-sign-in/projects/shop/test"),
      { params: Promise.resolve({ projectId: "shop", environment: "test" }) },
    );
    expect(response.status).toBe(403);
    expect(gatewayMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
