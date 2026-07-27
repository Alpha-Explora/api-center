import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, maxDuration } from "../../../../../../../../src/app/api/local/data-pipeline/raw-to-silver-runs/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));
const actionMocks = vi.hoisted(() => ({
  requireManagementRouteAction: vi.fn().mockResolvedValue({ audit: {} }),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);
vi.mock("@/lib/server/require-management-action", () => actionMocks);

describe("POST /api/local/data-pipeline/raw-to-silver-runs", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows long-running Athena validation calls on the host runtime", () => {
    expect(maxDuration).toBe(180);
  });

  it("proxies raw to silver run requests to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            status: "preview",
            environment: "test",
            tribeId: "greenovate",
            physicalTopic: "test.tribe.greenovate.events",
            partition: { year: "2026", month: "05", day: "22" },
            startedAt: "2026-05-23T01:00:00.000Z",
            raw: {},
            bronze: {},
            commonSilver: {},
            materialization: {
              requested: true,
              targetDatabase: "materialized_platform",
              targetTable:
                "materialized_platform.common_silver_tribe_event_envelope_greenovate_test_20260522",
              externalLocation:
                "s3://api-center-curated-data/silver/common_silver/tribe_event_envelope/tribe_id=greenovate/environment=test/year=2026/month=05/day=22/",
            },
            previewQueries: {
              raw: "SELECT COUNT(*)",
              bronze: "SELECT COUNT(*)",
              commonSilver: "SELECT COUNT(*)",
              materialize: "CREATE TABLE",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/local/data-pipeline/raw-to-silver-runs", {
        method: "POST",
        body: JSON.stringify({
          environment: "test",
          tribeId: "greenovate",
          year: "2026",
          month: "05",
          day: "22",
          materialize: true,
          preview: true,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.physicalTopic).toBe("test.tribe.greenovate.events");
    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/data-pipeline/raw-to-silver-runs",
      expect.objectContaining({
        method: "POST",
        timeoutMs: 180_000,
        body: JSON.stringify({
          environment: "test",
          tribeId: "greenovate",
          year: "2026",
          month: "05",
          day: "22",
          materialize: true,
          preview: true,
        }),
      }),
    );
    expect(actionMocks.requireManagementRouteAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionRisk: "state-write",
        actionId: "data-pipeline.raw-to-silver-runs.create",
      }),
    );
  });

  it("requires a management action before starting a raw to silver run", async () => {
    actionMocks.requireManagementRouteAction.mockRejectedValueOnce(
      new Error("Management authentication required"),
    );

    const response = await POST(
      new Request("http://localhost/api/local/data-pipeline/raw-to-silver-runs", {
        method: "POST",
        body: JSON.stringify({
          environment: "test",
          tribeId: "greenovate",
          year: "2026",
          month: "05",
          day: "22",
          materialize: true,
          preview: true,
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(adminMocks.apiCenterAdminRequest).not.toHaveBeenCalled();
  });
});
