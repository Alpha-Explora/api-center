import { afterEach, describe, expect, it, vi } from "vitest";

describe("api center admin proxy", () => {
  afterEach(() => {
    delete process.env.API_CENTER_BASE_URL;
    delete process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
    delete process.env.NEXT_PUBLIC_API_CENTER_PLATFORM_ADMIN_SECRET;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads API Center env at request time", async () => {
    delete process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiCenterAdminRequest("/api/v1/registry/services");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api-center.test/api/v1/registry/services",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-platform-secret": "server-secret",
        }),
      }),
    );
  });

  it("does not tell deployed operators to configure .env.local", async () => {
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    const response = await apiCenterAdminRequest("/api/v1/registry/services");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain("API_CENTER_PLATFORM_ADMIN_SECRET");
    expect(body.error).toContain("server environment variable");
    expect(body.error).not.toContain(".env.local");
  });

  it("returns source metadata when the platform secret is missing", async () => {
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    const response = await apiCenterAdminRequest(
      "/api/v1/analytics/shared-service-usage?window=1h",
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.meta.sourceMetadata[0]).toMatchObject({
      sourceType: "unavailable",
      sourceName: "shared-service-usage-api-center",
      durability: "none",
    });
  });

  it("returns source metadata when API Center cannot be reached", async () => {
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("TLS handshake failed")),
    );

    const response = await apiCenterAdminRequest(
      "/api/v1/analytics/gateway-traffic?window=1h",
    );
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error).toBe("TLS handshake failed");
    expect(body.meta.sourceMetadata[0]).toMatchObject({
      sourceType: "unavailable",
      sourceName: "gateway-traffic-api-center",
      durability: "none",
      degradedReason: "TLS handshake failed",
    });
  });

  it("preserves multiple source metadata entries for compliance export outages", async () => {
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("upstream unavailable")),
    );

    const response = await apiCenterAdminRequest(
      "/api/v1/compliance/export?from=2026-01-01&to=2026-01-31",
    );
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.meta.sourceMetadata).toEqual([
      expect.objectContaining({
        sourceType: "unavailable",
        sourceName: "audit-events-api-center",
      }),
      expect.objectContaining({
        sourceType: "unavailable",
        sourceName: "promotion-evidence-api-center",
      }),
    ]);
  });
  it("adds source metadata to non-OK upstream responses that omit it", async () => {
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, error: "upstream 500" }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const response = await apiCenterAdminRequest(
      "/api/v1/admin/operations/evidence/smoke-service",
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("upstream 500");
    expect(body.meta.sourceMetadata).toEqual([
      expect.objectContaining({
        sourceType: "unavailable",
        sourceName: "promotion-evidence-api-center",
      }),
      expect.objectContaining({
        sourceType: "unavailable",
        sourceName: "audit-evidence-api-center",
      }),
    ]);
  });
  it("uses a custom timeout without forwarding timeoutMs to fetch", async () => {
    vi.resetModules();
    const { apiCenterAdminRequest } = await import("../../../../../src/lib/server/api-center-admin");

    process.env.API_CENTER_BASE_URL = "https://api-center.test";
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET = "server-secret";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiCenterAdminRequest("/api/v1/data-pipeline/raw-to-silver-runs", {
      method: "POST",
      body: "{}",
      timeoutMs: 180_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init).not.toHaveProperty("timeoutMs");
  });
});
