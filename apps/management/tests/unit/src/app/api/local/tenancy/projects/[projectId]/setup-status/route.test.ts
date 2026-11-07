import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../../../src/app/api/local/tenancy/projects/[projectId]/setup-status/route";

const accessMocks = vi.hoisted(() => ({ authorizeProject: vi.fn().mockResolvedValue(undefined) }));
const gatewayMocks = vi.hoisted(() => ({ apiCenterAdminRequest: vi.fn(() => Response.json({ success: true, data: {} })) }));

vi.mock("@/lib/server/organization-access", () => accessMocks);
vi.mock("@/lib/server/api-center-admin", () => gatewayMocks);

describe("GET project setup status route", () => {
  afterEach(() => vi.clearAllMocks());

  it("authorizes the project and forwards the selected service and environment", async () => {
    const request = new Request("http://localhost/api/local/tenancy/projects/shop/setup-status?serviceId=orders%20api&environment=test");
    const response = await GET(request, { params: Promise.resolve({ projectId: "shop" }) });
    expect(response.status).toBe(200);
    expect(accessMocks.authorizeProject).toHaveBeenCalledWith(request, "shop", "observer");
    expect(gatewayMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/tenancy/projects/shop/setup-status?serviceId=orders%20api&environment=test",
    );
  });

  it("rejects invalid environment and missing service before calling the gateway", async () => {
    const missing = await GET(new Request("http://localhost/setup-status?environment=test"), { params: Promise.resolve({ projectId: "shop" }) });
    const invalid = await GET(new Request("http://localhost/setup-status?serviceId=orders&environment=stage"), { params: Promise.resolve({ projectId: "shop" }) });
    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(gatewayMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
