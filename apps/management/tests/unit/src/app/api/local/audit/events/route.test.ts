import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/audit/events/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);

describe("GET /api/local/audit/events", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies audit filters to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await GET(
      new Request(
        "http://localhost/api/local/audit/events?actionFamily=quota&actor=platform%40example.test",
      ),
    );

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/analytics/audit/events?actionFamily=quota&actor=platform%40example.test",
    );
  });

  it("exports filtered events as CSV", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            {
              id: "event-1",
              timestamp: "2026-05-25T00:00:00.000Z",
              type: "quota.policy.updated",
              actionFamily: "quota",
              actor: "platform@example.test",
              severity: "info",
              message: "Quota policy updated",
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );

    const response = await GET(
      new Request("http://localhost/api/local/audit/events?format=csv"),
    );

    await expect(response.text()).resolves.toContain(
      '"2026-05-25T00:00:00.000Z","quota.policy.updated","quota","platform@example.test","info","Quota policy updated"',
    );
  });

  it("preserves upstream API Center failures for CSV requests", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "upstream" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await GET(
      new Request("http://localhost/api/local/audit/events?format=csv"),
    );

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.not.toContain(
      '"timestamp","type"',
    );
  });
});
