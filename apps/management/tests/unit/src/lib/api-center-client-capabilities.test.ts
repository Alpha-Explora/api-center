import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeCapabilities, setManagementSessionToken } from "../../../../src/lib/api-center-client";

describe("api-center-client runtime capabilities", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches and parses runtime capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        data: {
          coreGateway: {
            enabled: true,
            authProvider: "internal-jwt",
            registrySource: "memory",
            registryBootstrapEnabled: false,
          },
          dataPipeline: { enabled: false },
          kafkaPublishing: { enabled: false },
          tribeSecrets: { source: "env-hash" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getRuntimeCapabilities()).resolves.toMatchObject({
      dataPipeline: { enabled: false },
      kafkaPublishing: { enabled: false },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/local/capabilities",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
