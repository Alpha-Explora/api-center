import { afterEach, describe, expect, it, vi } from "vitest";
import { getReadiness, setManagementSessionToken } from "../../../../src/lib/api-center-client";

describe("api-center-client management auth", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    vi.restoreAllMocks();
  });

  it("attaches the Google session token to local API requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          checkedAt: "2026-05-18T00:00:00.000Z",
          ok: true,
          managementEnvironment: "test",
          apiCenterBaseUrl: "https://api-center.itsandbox.site",
          publicApiCenterBaseUrl: "https://api-center.itsandbox.site",
          kafkaTopicPrefix: "test",
          googleCloudProject: "api-center-496422",
          secretManagerAuth: {
            ok: true,
            detail: "configured",
          },
          missingEnv: [],
          checks: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    setManagementSessionToken("session-token");
    await getReadiness();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/readiness",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer session-token",
        }),
      }),
    );
  });
});
