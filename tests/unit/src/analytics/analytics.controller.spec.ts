import { AnalyticsController } from "../../../../src/analytics/analytics.controller";
import { AuditEventsService } from "../../../../src/analytics/audit-events.service";
import { GatewayTrafficService } from "../../../../src/analytics/gateway-traffic.service";
import { SharedServiceUsageService } from "../../../../src/analytics/shared-service-usage.service";
import { RegistryService } from "../../../../src/registry/registry.service";
import { ValidationError } from "../../../../src/shared/errors";

describe("AnalyticsController", () => {
  const usage = {
    listUsage: jest.fn(),
    listUsageWithSourceMetadata: jest.fn(),
  } as unknown as SharedServiceUsageService;
  const gatewayTraffic = {
    getSummary: jest.fn(),
    getSummaryWithSourceMetadata: jest.fn(),
  } as unknown as GatewayTrafficService;
  const auditEvents = {
    list: jest.fn(),
    listWithSourceMetadata: jest.fn(),
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
    (usage.listUsageWithSourceMetadata as jest.Mock).mockResolvedValue({
      data: [
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
      ],
      sourceMetadata: {
        sourceType: "volatile",
        sourceName: "shared-service-usage-memory-window",
        durability: "redis-window",
        window: "24h",
      },
    });

    const result = await controller.getSharedServiceUsage("24h", {
      correlationId: "corr-1",
    } as any);

    expect(usage.listUsageWithSourceMetadata).toHaveBeenCalledWith("24h");
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.meta).toEqual(
      expect.objectContaining({
        window: "24h",
        correlationId: "corr-1",
        sourceMetadata: [
          expect.objectContaining({
            sourceType: "volatile",
            sourceName: "shared-service-usage-memory-window",
          }),
        ],
      }),
    );
  });

  it("defaults to 24h when no window is provided", async () => {
    (usage.listUsageWithSourceMetadata as jest.Mock).mockResolvedValue({
      data: [],
      sourceMetadata: {
        sourceType: "volatile",
        sourceName: "shared-service-usage-memory-window",
        durability: "redis-window",
        window: "24h",
      },
    });

    await controller.getSharedServiceUsage(undefined, {} as any);

    expect(usage.listUsageWithSourceMetadata).toHaveBeenCalledWith("24h");
  });

  it("rejects invalid windows", async () => {
    await expect(
      controller.getSharedServiceUsage("12h", {} as any),
    ).rejects.toThrow(ValidationError);
  });

  it("returns gateway traffic summary", async () => {
    (
      gatewayTraffic.getSummaryWithSourceMetadata as jest.Mock
    ).mockResolvedValue({
      data: {
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
      },
      sourceMetadata: {
        sourceType: "volatile",
        sourceName: "gateway-traffic-memory-window",
        durability: "redis-window",
        window: "24h",
      },
    });

    const result = await controller.getGatewayTraffic("24h", {} as any);

    expect(result.success).toBe(true);
    expect(gatewayTraffic.getSummaryWithSourceMetadata).toHaveBeenCalledWith(
      "24h",
    );
    expect(result.meta.sourceMetadata).toEqual([
      expect.objectContaining({ sourceName: "gateway-traffic-memory-window" }),
    ]);
  });

  it("returns audit events", async () => {
    (auditEvents.listWithSourceMetadata as jest.Mock).mockResolvedValue({
      data: [
        {
          id: "evt-1",
          type: "shared_service.call",
          severity: "info",
          message: "called",
          timestamp: "2026-05-14T00:00:00.000Z",
        },
      ],
      sourceMetadata: {
        sourceType: "durable",
        sourceName: "audit-events-postgres",
        durability: "postgres",
        evidenceTable: "apic_audit.audit_events",
      },
    });

    const result = await controller.getAuditEvents(
      "10",
      "payment",
      undefined,
      "quota",
      "platform@example.test",
      {} as any,
    );

    expect(result.success).toBe(true);
    expect(result.meta.sourceMetadata).toEqual([
      expect.objectContaining({
        sourceType: "durable",
        evidenceTable: "apic_audit.audit_events",
      }),
    ]);
    expect(auditEvents.listWithSourceMetadata).toHaveBeenCalledWith({
      limit: 10,
      serviceId: "payment",
      type: undefined,
      actionFamily: "quota",
      actor: "platform@example.test",
    });
  });
});
