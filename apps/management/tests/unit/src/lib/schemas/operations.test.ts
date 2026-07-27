import { describe, expect, it } from "vitest";
import {
  auditEventsResponseSchema,
  gatewayTrafficResponseSchema,
  sharedServiceRuntimeUsageResponseSchema,
} from "../../../../../src/lib/schemas/operations";

describe("operations source metadata schemas", () => {
  it("preserves volatile source metadata for usage responses", () => {
    const parsed = sharedServiceRuntimeUsageResponseSchema.parse({
      success: true,
      data: [],
      meta: {
        window: "24h",
        timestamp: "2026-06-25T00:00:00.000Z",
        correlationId: "corr-usage",
        sourceMetadata: [
          {
            sourceType: "volatile",
            sourceName: "shared-service-usage-memory-window",
            durability: "redis-window",
            window: "24h",
            degradedReason:
              "Redis unavailable; using in-memory usage counters.",
          },
        ],
      },
    });

    expect(parsed.meta?.sourceMetadata?.[0]).toMatchObject({
      sourceType: "volatile",
      sourceName: "shared-service-usage-memory-window",
      durability: "redis-window",
    });
  });

  it("preserves volatile source metadata for gateway traffic", () => {
    const parsed = gatewayTrafficResponseSchema.parse({
      success: true,
      data: {
        window: "1h",
        totalProxyRequests: 0,
        tribeToTribeRequests: 0,
        tribeToSharedRequests: 0,
        status4xx: 0,
        status5xx: 0,
        kafkaPublishFailures: 0,
        readinessFailures: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
      },
      meta: {
        sourceMetadata: [
          {
            sourceType: "volatile",
            sourceName: "gateway-traffic-redis-window",
            durability: "redis-window",
            window: "1h",
          },
        ],
      },
    });

    expect(parsed.meta?.sourceMetadata?.[0]?.sourceName).toBe(
      "gateway-traffic-redis-window",
    );
  });

  it("preserves durable audit source metadata", () => {
    const parsed = auditEventsResponseSchema.parse({
      success: true,
      data: [],
      meta: {
        total: 0,
        sourceMetadata: [
          {
            sourceType: "durable",
            sourceName: "audit-events-postgres",
            durability: "postgres",
            evidenceTable: "apic_audit.audit_events",
          },
        ],
      },
    });

    expect(parsed.meta?.sourceMetadata?.[0]).toMatchObject({
      sourceType: "durable",
      evidenceTable: "apic_audit.audit_events",
    });
  });
});
