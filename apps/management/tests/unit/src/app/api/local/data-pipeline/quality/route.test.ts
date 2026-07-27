import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../../../../../../src/app/api/local/data-pipeline/quality/route";

describe("GET /api/local/data-pipeline/quality", () => {
  const originalProvider = process.env.PIPELINE_GOVERNANCE_PROVIDER;
  const originalHealthProvider = process.env.PIPELINE_HEALTH_PROVIDER;
  const originalBaseUrl = process.env.API_CENTER_BASE_URL;
  const originalSecret = process.env.API_CENTER_PLATFORM_ADMIN_SECRET;

  afterEach(() => {
    restoreEnv("PIPELINE_GOVERNANCE_PROVIDER", originalProvider);
    restoreEnv("PIPELINE_HEALTH_PROVIDER", originalHealthProvider);
    restoreEnv("API_CENTER_BASE_URL", originalBaseUrl);
    restoreEnv("API_CENTER_PLATFORM_ADMIN_SECRET", originalSecret);
    vi.unstubAllGlobals();
  });

  it("returns unavailable source metadata when API Center quality lookup fails", async () => {
    process.env.PIPELINE_GOVERNANCE_PROVIDER = "api-center";
    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("TLS handshake failed")),
    );

    const response = await GET(
      new Request("http://localhost/api/local/data-pipeline/quality"),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.meta.source).toBe("athena-proxy");
    expect(body.meta.sourceMetadata[0]).toMatchObject({
      sourceType: "unavailable",
      sourceName: "pipeline-governance-athena",
      durability: "none",
      degradedReason: "TLS handshake failed",
    });
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value) {
    process.env[name] = value;
  } else {
    delete process.env[name];
  }
}
