import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/quotas/usage/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);

describe("GET /api/local/quotas/usage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies usage requests to API Center with safe query params", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await GET(
      new Request(
        "http://localhost/api/local/quotas/usage?ownerTribeId=campus-one&window=7d",
      ),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/quotas/usage?ownerTribeId=campus-one&window=7d",
    );
  });

  it("rejects unsupported windows before proxying", async () => {
    const response = await GET(
      new Request("http://localhost/api/local/quotas/usage?window=13h"),
    );

    expect(response.status).toBe(400);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
