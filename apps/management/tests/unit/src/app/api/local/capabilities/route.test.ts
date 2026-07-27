import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../src/app/api/local/capabilities/route";

const adminMocks = vi.hoisted(() => ({
  apiCenterAdminRequest: vi.fn(),
}));

vi.mock("@/lib/server/api-center-admin", () => adminMocks);

describe("GET /api/local/capabilities", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("proxies runtime capability lookup to API Center", async () => {
    adminMocks.apiCenterAdminRequest.mockResolvedValue(
      Response.json({
        success: true,
        data: {
          coreGateway: {
            enabled: true,
            authProvider: "internal-jwt",
            registrySource: "redis",
            registryBootstrapEnabled: false,
          },
          dataPipeline: { enabled: false },
          kafkaPublishing: { enabled: false },
          tribeSecrets: { source: "env-hash" },
        },
      }),
    );

    await GET();

    expect(adminMocks.apiCenterAdminRequest).toHaveBeenCalledWith(
      "/api/v1/capabilities",
    );
  });
});
