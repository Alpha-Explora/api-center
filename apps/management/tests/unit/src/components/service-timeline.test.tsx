import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ServiceTimeline } from "../../../../src/components/service-timeline";
import {
  buildIncidentSnapshot,
  buildServiceTimelineEvents,
} from "@/lib/service-timeline";
import type {
  AuditEvent,
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
} from "@/lib/schemas";

describe("ServiceTimeline", () => {
  it("renders service events", () => {
    render(
      <ServiceTimeline
        events={[
          {
            id: "event-1",
            occurredAt: "2026-05-17T02:00:00.000Z",
            source: "alert",
            title: "Smoke failure",
            severity: "error",
          },
        ]}
      />,
    );

    expect(screen.getByText("Smoke failure")).toBeTruthy();
    expect(screen.getByText("alert")).toBeTruthy();
  });

  it("builds timeline events from registry, audit, and usage signals", () => {
    const service: ServiceRegistryEntry = {
      serviceId: "flow-ci",
      name: "Flow CI",
      version: "1.0.0",
      baseUrl: "https://flow-ci.example.com",
      healthCheck: "/health",
      serviceType: "tribe",
      ownerTeam: "Flow",
      contact: "ops@example.com",
      tags: [],
      serviceTier: "standard",
      consumes: ["payment"],
      exposes: ["/health"],
      requiredScopes: ["shared:payment:invoke"],
      status: "active",
      registeredAt: "2026-05-17T00:00:00.000Z",
      updatedAt: "2026-05-17T01:00:00.000Z",
    };
    const auditEvents: AuditEvent[] = [
      {
        id: "audit-1",
        type: "confluent.topic.provision",
        serviceId: "flow-ci",
        severity: "info",
        message: "Topic provisioned",
        payload: { operatorEmail: "admin@example.com", environment: "test" },
        timestamp: "2026-05-17T03:00:00.000Z",
      },
    ];
    const runtimeUsage: SharedServiceRuntimeUsage[] = [
      {
        tribeServiceId: "flow-ci",
        sharedServiceId: "payment",
        window: "24h",
        totalRequests: 2,
        successRequests: 1,
        failedRequests: 1,
        errorRate: 0.5,
        avgLatencyMs: 120,
        lastUsedAt: "2026-05-17T04:00:00.000Z",
      },
    ];

    const events = buildServiceTimelineEvents({
      service,
      auditEvents,
      runtimeUsage,
    });
    const snapshot = buildIncidentSnapshot(events);

    expect(events.map((event) => event.source)).toEqual([
      "usage",
      "audit",
      "readiness",
    ]);
    expect(events[0].title).toBe("flow-ci called payment");
    expect(snapshot.recentFailures).toBe(1);
    expect(snapshot.lastWrite).toBe("2026-05-17T03:00:00.000Z");
  });
});
