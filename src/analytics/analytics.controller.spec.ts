import { AnalyticsController } from "./analytics.controller";
import { AuditEventsService } from "./audit-events.service";
import { GatewayTrafficService } from "./gateway-traffic.service";
import { SharedServiceUsageService } from "./shared-service-usage.service";
import { RegistryService } from "../registry/registry.service";
import { ValidationError } from "../shared/errors";

describe("AnalyticsController", () => {
  const usage = {
    listUsage: jest.fn(),
  } as unknown as SharedServiceUsageService;
  const gatewayTraffic = {
    getSummary: jest.fn(),
  } as unknown as GatewayTrafficService;
  const auditEvents = {
    list: jest.fn(),
  } as unknown as AuditEventsService;
  const registry = {
    getAll: jest.fn().mockReturnValue({}),
    get: jest.fn(),
    getConsumers: jest.fn().mockReturnValue([]),
  } as unknown as RegistryService;

  let controller: AnalyticsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AnalyticsController(
      usage,
      gatewayTraffic,
      auditEvents,
      registry,
    );
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

  it("returns gateway traffic summary", async () => {
    (gatewayTraffic.getSummary as jest.Mock).mockResolvedValue({
      window: "24h",
      totalProxyRequests: 1,
      tribeToTribeRequests: 0,
      tribeToSharedRequests: 1,
      status4xx: 0,
      status5xx: 0,
      kafkaPublishFailures: 0,
      readinessFailures: 0,
      avgLatencyMs: 50,
      p95LatencyMs: 50,
    });

    const result = await controller.getGatewayTraffic("24h", {} as any);

    expect(result.success).toBe(true);
    expect(gatewayTraffic.getSummary).toHaveBeenCalledWith("24h");
  });

  it("returns audit events", async () => {
    (auditEvents.list as jest.Mock).mockResolvedValue([
      {
        id: "evt-1",
        type: "shared_service.call",
        severity: "info",
        message: "called",
        timestamp: "2026-05-14T00:00:00.000Z",
      },
    ]);

    const result = await controller.getAuditEvents(
      "10",
      "payment",
      undefined,
      {} as any,
    );

    expect(result.success).toBe(true);
    expect(auditEvents.list).toHaveBeenCalledWith({
      limit: 10,
      serviceId: "payment",
      type: undefined,
    });
  });
});
