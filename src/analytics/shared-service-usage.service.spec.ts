import { ConfigService } from "../config/config.service";
import { LoggerService } from "../shared/logger.service";
import { SharedServiceUsageService } from "./shared-service-usage.service";

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
});
