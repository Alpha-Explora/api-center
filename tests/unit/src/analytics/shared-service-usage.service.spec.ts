import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { SharedServiceUsageService } from "../../../../apps/gateway/src/analytics/shared-service-usage.service";

describe("SharedServiceUsageService", () => {
  let service: SharedServiceUsageService;

  beforeEach(() => {
    service = new SharedServiceUsageService(
      {
        redis: { cacheUrl: "redis://localhost:6381" },
      } as ConfigService,
      {
        info: jest.fn(),
        warn: jest.fn(),
      } as unknown as LoggerService,
    );
  });

  it("returns zero rows when no usage exists", async () => {
    await expect(
      service.listUsage("24h", new Date("2026-05-13T14:30:00.000Z")),
    ).resolves.toEqual([]);
  });

  it("aggregates successful and failed usage in the selected window", async () => {
    await service.record({
      tribeServiceId: "campusone",
      sharedServiceId: "paymongo",
      route: "/api/v1/shared/paymongo/payments",
      method: "POST",
      status: 200,
      ok: true,
      latencyMs: 100,
      timestamp: new Date("2026-05-13T14:03:00.000Z"),
    });
    await service.record({
      tribeServiceId: "campusone",
      sharedServiceId: "paymongo",
      route: "/api/v1/shared/paymongo/payments",
      method: "POST",
      status: 502,
      ok: false,
      latencyMs: 300,
      timestamp: new Date("2026-05-13T14:04:00.000Z"),
    });

    const result = await service.listUsage(
      "1h",
      new Date("2026-05-13T14:30:00.000Z"),
    );

    expect(result).toEqual([
      expect.objectContaining({
        tribeServiceId: "campusone",
        sharedServiceId: "paymongo",
        window: "1h",
        totalRequests: 2,
        successRequests: 1,
        failedRequests: 1,
        errorRate: 0.5,
        avgLatencyMs: 200,
        lastUsedAt: "2026-05-13T14:04:00.000Z",
      }),
    ]);
  });

  it("separates shared-service usage by environment", async () => {
    await service.record({
      tribeServiceId: "campusone",
      sharedServiceId: "paymongo",
      environment: "test",
      route: "/api/v1/shared/paymongo/payments",
      method: "POST",
      status: 200,
      ok: true,
      latencyMs: 100,
      timestamp: new Date("2026-05-13T14:03:00.000Z"),
    });
    await service.record({
      tribeServiceId: "campusone",
      sharedServiceId: "paymongo",
      environment: "live",
      route: "/api/v1/shared/paymongo/payments",
      method: "POST",
      status: 502,
      ok: false,
      latencyMs: 300,
      timestamp: new Date("2026-05-13T14:04:00.000Z"),
    });

    const result = await service.listUsage(
      "1h",
      new Date("2026-05-13T14:30:00.000Z"),
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ environment: "test", totalRequests: 1 }),
        expect.objectContaining({ environment: "live", totalRequests: 1 }),
      ]),
    );
  });
  it("labels in-memory usage as volatile source metadata", async () => {
    await service.record({
      tribeServiceId: "campusone",
      sharedServiceId: "paymongo",
      route: "/api/v1/shared/paymongo/payments",
      method: "POST",
      status: 200,
      ok: true,
      latencyMs: 100,
      timestamp: new Date("2026-05-13T14:03:00.000Z"),
    });

    const result = await service.listUsageWithSourceMetadata(
      "1h",
      new Date("2026-05-13T14:30:00.000Z"),
    );

    expect(result.data).toHaveLength(1);
    expect(result.sourceMetadata).toEqual(
      expect.objectContaining({
        sourceType: "volatile",
        sourceName: "shared-service-usage-memory-window",
        durability: "redis-window",
        window: "1h",
        degradedReason: expect.stringContaining("Redis unavailable"),
      }),
    );
  });
});
