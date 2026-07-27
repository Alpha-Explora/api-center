import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/analytics/gateway-traffic/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);

describe("GET /api/local/analytics/gateway-traffic", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies the selected usage window to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [],
          meta: { sourceMetadata: [] },
        }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await GET(
      new Request(
        "http://localhost/api/local/analytics/gateway-traffic?window=1h",
      ),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/analytics/gateway-traffic?window=1h",
    );
  });
});
