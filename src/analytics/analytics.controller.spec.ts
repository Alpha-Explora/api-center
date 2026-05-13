import { AnalyticsController } from "./analytics.controller";
import { SharedServiceUsageService } from "./shared-service-usage.service";
import { ValidationError } from "../shared/errors";

describe("AnalyticsController", () => {
  const usage = {
    listUsage: jest.fn(),
  } as unknown as SharedServiceUsageService;

  let controller: AnalyticsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AnalyticsController(usage);
  });

  it("returns shared-service usage rows for the requested window", async () => {
    (usage.listUsage as jest.Mock).mockResolvedValue([
      {
        tribeServiceId: "campusone",
        sharedServiceId: "paymongo",
        window: "24h",
        totalRequests: 1,
        successRequests: 1,
        failedRequests: 0,
        errorRate: 0,
        avgLatencyMs: 123,
      },
    ]);

    const result = await controller.getSharedServiceUsage("24h", {
      correlationId: "corr-1",
    } as any);

    expect(usage.listUsage).toHaveBeenCalledWith("24h");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual(
      expect.objectContaining({ window: "24h", correlationId: "corr-1" }),
    );
  });

  it("defaults to 24h when no window is provided", async () => {
    (usage.listUsage as jest.Mock).mockResolvedValue([]);

    await controller.getSharedServiceUsage(undefined, {} as any);

    expect(usage.listUsage).toHaveBeenCalledWith("24h");
  });

  it("rejects invalid windows", async () => {
    await expect(
      controller.getSharedServiceUsage("12h", {} as any),
    ).rejects.toThrow(ValidationError);
  });
});
