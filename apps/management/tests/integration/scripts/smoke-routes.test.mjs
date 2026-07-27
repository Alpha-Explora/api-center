import { describe, expect, it } from "vitest";
import {
  defaultApiRouteChecks,
  defaultRouteChecks,
  defaultRoutes,
  resolveBaseUrl,
  smokeRoutes,
} from "../../../scripts/smoke-routes.mjs";

describe("resolveBaseUrl", () => {
  it("uses --base-url when passed after npm --", () => {
    expect(
      resolveBaseUrl(["node", "smoke-routes.mjs", "--base-url", "http://localhost:3010"], {}),
    ).toBe("http://localhost:3010");
  });

  it("falls back to MANAGEMENT_PUBLIC_BASE_URL", () => {
    expect(
      resolveBaseUrl(["node", "smoke-routes.mjs"], {
        MANAGEMENT_PUBLIC_BASE_URL: "http://localhost:3011",
      }),
    ).toBe("http://localhost:3011");
  });

  it("covers the lifecycle route", () => {
    expect(defaultRoutes).toContain("/lifecycle");
  });

  it("covers the redesigned platform workflow routes", () => {
    expect(defaultRoutes).toEqual(
      expect.arrayContaining([
        "/api-catalog",
        "/compliance",
        "/data-pipeline",
        "/developer-portal",
        "/docs/consumer-runbook",
        "/marketplace",
        "/operational-trust",
        "/plans",
        "/promotions",
        "/quotas",
        "/registration-requests",
        "/reliability",
      ]),
    );
  });

  it("defines page identity text for the redesigned platform workflow routes", () => {
    expect(defaultRouteChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "/developer-portal",
          expectedText: expect.arrayContaining([
            expect.stringContaining(
              "Preview the read-only tribe portal packet",
            ),
          ]),
        }),
        expect.objectContaining({
          route: "/docs/consumer-runbook",
          expectedText: expect.arrayContaining([
            expect.stringContaining("Consumer setup guidance"),
          ]),
        }),
        expect.objectContaining({
          route: "/operational-trust",
          expectedText: expect.arrayContaining([
            expect.stringContaining("Review drift, runtime dependencies"),
          ]),
        }),
        expect.objectContaining({
          route: "/promotions",
          expectedText: expect.arrayContaining([
            expect.stringContaining("Check live-readiness gates"),
          ]),
        }),
        expect.objectContaining({
          route: "/registration-requests",
          expectedText: expect.arrayContaining([
            expect.stringContaining("Review manifest submissions"),
          ]),
        }),
      ]),
    );
  });

  it("requires source metadata checks for source-backed Management API routes", () => {
    expect(defaultApiRouteChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          route: "/api/local/analytics/gateway-traffic?window=1h",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.0.durability",
          ]),
        }),
        expect.objectContaining({
          route: "/api/local/analytics/shared-service-usage?window=1h",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.0.durability",
          ]),
        }),
        expect.objectContaining({
          route: "/api/local/audit/events?limit=1",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.0.durability",
          ]),
        }),
        expect.objectContaining({
          route: "/api/local/compliance/export?from=2026-01-01&to=2026-01-31&format=json",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.1.sourceType",
          ]),
        }),
        expect.objectContaining({
          route: "/api/local/operations/evidence/smoke-service",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.1.sourceType",
          ]),
        }),
        expect.objectContaining({
          route: "/api/local/data-pipeline/health?environment=test",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.0.durability",
          ]),
        }),
        expect.objectContaining({
          route: "/api/local/data-pipeline/quality?environment=test",
          expectedJsonPaths: expect.arrayContaining([
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.0.durability",
          ]),
        }),
      ]),
    );
  });

  it("checks expected JSON paths even when the API route fails", async () => {
    const results = await smokeRoutes({
      baseUrl: "http://localhost:3010",
      routes: [
        {
          route: "/api/local/analytics/gateway-traffic?window=1h",
          allowedStatuses: [200, 500, 504],
          expectedJsonPaths: [
            "meta.sourceMetadata.0.sourceType",
            "meta.sourceMetadata.0.durability",
          ],
        },
      ],
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: "upstream unavailable",
            meta: {
              sourceMetadata: [
                {
                  sourceType: "unavailable",
                  durability: "none",
                },
              ],
            },
          }),
          {
            status: 504,
            headers: { "content-type": "application/json" },
          },
        ),
    });

    expect(results).toEqual([
      {
        route: "/api/local/analytics/gateway-traffic?window=1h",
        status: 504,
        ok: true,
      },
    ]);
  });

  it("marks an API route failed when degraded metadata is missing", async () => {
    const results = await smokeRoutes({
      baseUrl: "http://localhost:3010",
      routes: [
        {
          route: "/api/local/analytics/gateway-traffic?window=1h",
          allowedStatuses: [200, 500, 504],
          expectedJsonPaths: ["meta.sourceMetadata.0.sourceType"],
        },
      ],
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: false }), {
          status: 504,
          headers: { "content-type": "application/json" },
        }),
    });

    expect(results).toEqual([
      {
        route: "/api/local/analytics/gateway-traffic?window=1h",
        status: 504,
        ok: false,
        missingExpectedJsonPaths: ["meta.sourceMetadata.0.sourceType"],
      },
    ]);
  });

  it("marks a route failed when expected page identity text is missing", async () => {
    const results = await smokeRoutes({
      baseUrl: "http://localhost:3010",
      routes: [
        {
          route: "/promotions",
          expectedText: ["Environment promotions"],
        },
      ],
      fetchImpl: async () =>
        new Response("<main>Registration requests</main>", { status: 200 }),
    });

    expect(results).toEqual([
      {
        route: "/promotions",
        status: 200,
        ok: false,
        missingExpectedText: ["Environment promotions"],
      },
    ]);
  });
});
