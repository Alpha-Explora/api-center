import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../../../src/app/api/local/tenancy/projects/[projectId]/overview/route";

const accessMocks = vi.hoisted(() => ({
  authorizeProject: vi.fn().mockResolvedValue(undefined),
  managementOrganizationFilter: vi.fn().mockResolvedValue("org-a,org-b"),
}));
const gatewayMocks = vi.hoisted(() => ({ apiCenterAdminRequest: vi.fn(() => Response.json({ success: true, data: {} })) }));

vi.mock("@/lib/server/organization-access", () => accessMocks);
vi.mock("@/lib/server/api-center-admin", () => gatewayMocks);

describe("GET project overview route", () => {
  afterEach(() => vi.clearAllMocks());

  it("checks project organization access and forwards the organization filter", async () => {
    const request = new Request("http://localhost/api/local/tenancy/projects/shop/overview");
    const response = await GET(request, { params: Promise.resolve({ projectId: "shop" }) });
    expect(response.status).toBe(200);
    expect(accessMocks.authorizeProject).toHaveBeenCalledWith(request, "shop", "observer");
    expect(gatewayMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/tenancy/projects/shop/overview?organizationId=org-a%2Corg-b",
    );
  });

  it("does not call the gateway when project authorization fails", async () => {
    accessMocks.authorizeProject.mockRejectedValueOnce(new Error("Organization access denied"));
    const response = await GET(
      new Request("http://localhost/api/local/tenancy/projects/shop/overview"),
      { params: Promise.resolve({ projectId: "shop" }) },
    );
    expect(response.status).toBe(403);
    expect(gatewayMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
