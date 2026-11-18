import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { GatewayTrafficService } from "../../../../apps/gateway/src/domains/runtime-ops/analytics/gateway-traffic.service";

describe("GatewayTrafficService", () => {
  let service: GatewayTrafficService;

  beforeEach(() => {
    service = new GatewayTrafficService(
      {
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      } as unknown as LoggerService,
    );
  });

  it("aggregates tribe and shared proxy traffic in the selected window", async () => {
    await service.recordProxyRequest({
      namespace: "tribe",
      sourceTribe: "campusone",
      targetService: "orders-api",
      method: "GET",
      statusCode: 200,
      environment: "test",
      latencyMs: 80,
      timestamp: new Date("2026-05-13T14:03:00.000Z"),
    });
    await service.recordProxyRequest({
      namespace: "shared",
      sourceTribe: "campusone",
      targetService: "payment",
      method: "POST",
      statusCode: 502,
      environment: "live",
      latencyMs: 220,
      timestamp: new Date("2026-05-13T14:04:00.000Z"),
    });

    const result = await service.getSummary(
      "1h",
      new Date("2026-05-13T14:30:00.000Z"),
    );

    expect(result).toEqual(
      expect.objectContaining({
        window: "1h",
        totalProxyRequests: 2,
        tribeToTribeRequests: 1,
        tribeToSharedRequests: 1,
        status5xx: 1,
        avgLatencyMs: 150,
        p95LatencyMs: 220,
        environments: { test: 1, live: 1 },
      }),
    );
  });

  it("labels in-memory gateway traffic as volatile source metadata", async () => {
    await service.recordProxyRequest({
      namespace: "shared",
      sourceTribe: "campusone",
      targetService: "payment",
      method: "POST",
      statusCode: 404,
      latencyMs: 120,
      timestamp: new Date("2026-05-13T14:03:00.000Z"),
    });

    const result = await service.getSummaryWithSourceMetadata(
      "1h",
      new Date("2026-05-13T14:30:00.000Z"),
    );

    expect(result.data.status4xx).toBe(1);
    expect(result.sourceMetadata).toEqual(
      expect.objectContaining({
        sourceType: "volatile",
        sourceName: "gateway-traffic-memory-window",
        durability: "memory-window",
        window: "1h",
      }),
    );
  });
});
