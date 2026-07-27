import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getOperationalTrustData,
  setManagementSessionToken,
} from "../../../../src/lib/api-center-client";

describe("api-center-client operational trust", () => {
  afterEach(() => {
    setManagementSessionToken(undefined);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps available operational trust sections when one source fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/local/operations/dependencies")) {
        return Response.json(
          { error: "dependency map unavailable" },
          { status: 404 },
        );
      }

      if (url.endsWith("/api/local/operations/scorecards")) {
        return Response.json({
          success: true,
          data: [
            {
              ownerTribeId: "campus-one",
              status: "needs_review",
              findings: ["Quota policy is in observe mode."],
            },
          ],
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOperationalTrustData()).resolves.toEqual({
      driftItems: [],
      dependencyEdges: [],
      evidenceSections: [],
      scorecards: [
        {
          ownerTribeId: "campus-one",
          status: "needs_review",
          findings: ["Quota policy is in observe mode."],
        },
      ],
      unavailableSections: [
        {
          key: "dependencies",
          label: "Runtime dependency map",
          reason: "dependency map unavailable",
        },
      ],
    });
  });

  it("uses nested backend error messages for unavailable trust sections", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/local/operations/dependencies")) {
        return Response.json(
          {
            success: false,
            error: {
              code: "Not Found",
              message: "Cannot GET /api/v1/admin/operations/dependencies",
            },
          },
          { status: 404 },
        );
      }

      if (url.endsWith("/api/local/operations/scorecards")) {
        return Response.json({ success: true, data: [] });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOperationalTrustData()).resolves.toMatchObject({
      unavailableSections: [
        {
          key: "dependencies",
          reason: "Cannot GET /api/v1/admin/operations/dependencies",
        },
      ],
    });
  });

  it("derives fallback trust data from the registry when operation sources fail", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (
        url.endsWith("/api/local/operations/dependencies") ||
        url.endsWith("/api/local/operations/scorecards")
      ) {
        return Response.json({ error: "source unavailable" }, { status: 404 });
      }

      if (url.endsWith("/api/local/registry/services")) {
        return Response.json({
          success: true,
          data: [
            {
              serviceId: "campus-one",
              name: "Campus One",
              baseUrl: "https://campus.example.test",
              requiredScopes: ["campus:read"],
              exposes: ["/campus"],
              consumes: ["payment-service", "kafka"],
              ownerTribeId: "campus-one",
              serviceType: "tribe",
              version: "1.0.0",
              tags: [],
              registeredAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-14T00:00:00.000Z",
              status: "active",
            },
            {
              serviceId: "payment-service",
              name: "Payment Service",
              baseUrl: "https://payment.example.test",
              requiredScopes: ["payments:charge"],
              exposes: ["/payments"],
              consumes: [],
              ownerTribeId: "platform",
              serviceType: "shared",
              version: "1.0.0",
              tags: [],
              registeredAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-14T00:00:00.000Z",
              status: "active",
            },
          ],
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOperationalTrustData()).resolves.toMatchObject({
      dependencyEdges: [
        {
          from: "campus-one",
          to: "payment-service",
          type: "shared-service",
        },
        {
          from: "campus-one",
          to: "kafka",
          type: "kafka",
        },
        {
          from: "campus-one",
          to: "tribe.campus-one.events",
          type: "kafka-topic",
        },
      ],
      scorecards: [
        expect.objectContaining({
          ownerTribeId: "campus-one",
          status: "needs_attention",
          quotaUsagePercent: "unknown",
          errorRatePercent: "unknown",
        }),
        expect.objectContaining({
          ownerTribeId: "platform",
          status: "needs_attention",
        }),
      ],
    });
  });

  it("deduplicates registry-derived Kafka topic fallback edges by owner tribe", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (
        url.endsWith("/api/local/operations/dependencies") ||
        url.endsWith("/api/local/operations/scorecards")
      ) {
        return Response.json({ error: "source unavailable" }, { status: 404 });
      }

      if (url.endsWith("/api/local/registry/services")) {
        return Response.json({
          success: true,
          data: [
            {
              serviceId: "orders-api",
              name: "Orders API",
              baseUrl: "https://orders.example.test",
              requiredScopes: ["orders:read"],
              exposes: ["/orders"],
              consumes: ["kafka"],
              ownerTribeId: "orders",
              serviceType: "tribe",
              version: "1.0.0",
              tags: [],
              registeredAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-14T00:00:00.000Z",
              status: "active",
            },
            {
              serviceId: "orders-worker",
              name: "Orders Worker",
              baseUrl: "https://orders-worker.example.test",
              requiredScopes: ["orders:events"],
              exposes: ["/events"],
              consumes: ["kafka"],
              ownerTribeId: "orders",
              serviceType: "tribe",
              version: "1.0.0",
              tags: [],
              registeredAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-14T00:00:00.000Z",
              status: "active",
            },
          ],
        });
      }

      return Response.json({ error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const data = await getOperationalTrustData();
    const topicEdges = data.dependencyEdges.filter(
      (edge) => edge.type === "kafka-topic",
    );

    expect(topicEdges).toEqual([
      {
        from: "orders",
        to: "tribe.orders.events",
        type: "kafka-topic",
      },
    ]);
  });
});
