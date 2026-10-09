import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/operations/lifecycle/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);

describe("GET /api/local/operations/lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies source-backed lifecycle evidence from API Center", async () => {
    const response = Response.json({ success: true, data: { entries: [] } });
    adminMocks.apiCenterAdminRequest.mockResolvedValue(response);

    await expect(GET(new Request("https://console.test/api/local/operations/lifecycle"))).resolves.toBe(response);
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/admin/operations/lifecycle",
    );
  });
});
