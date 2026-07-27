import { describe, expect, it } from "vitest";
import { buildNorthStarSummary } from "../../../../../src/lib/data-pipeline/north-star-summary";

describe("buildNorthStarSummary", () => {
  it("marks the north-star answer complete when all evidence categories are present", () => {
    const summary = buildNorthStarSummary({
      healthRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sourceServiceId: "logistics-orders",
          eventType: "order.created",
          eventDay: "2026-05-20",
          eventCount: 12,
          latestIngestedAt: "2026-05-20T10:00:00.000Z",
          latestGoldObservedAt: "2026-05-20T10:05:00.000Z",
        },
      ],
      qualityRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sourceServiceId: "logistics-orders",
          eventType: "order.created",
          eventDay: "2026-05-20",
          eventCount: 12,
          validEventCount: 12,
          invalidEventCount: 0,
          qualityErrorCount: 0,
        },
      ],
      sharedServiceUsageRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sharedServiceId: "payment",
          provider: "paymongo",
          providerStatus: "ok",
          eventDay: "2026-05-20",
          eventCount: 5,
          successCount: 5,
          failureCount: 0,
        },
      ],
      gatewayDecisionRows: [
        {
          environment: "prod",
          tribeId: "logistics",
          sourceServiceId: "logistics-orders",
          targetServiceId: "payment",
          scope: "shared:payment:write",
          decision: "allowed",
          eventDay: "2026-05-20",
          decisionCount: 5,
          allowedCount: 5,
          deniedCount: 0,
        },
      ],
      costRows: [
        {
          environment: "prod",
          workgroup: "api-center-platform-validation-prod",
          resultPurpose: "platform-validation",
          eventDay: "2026-05-20",
          queryCount: 2,
          bytesScanned: 1048576,
          estimatedCostUsd: 0.01,
        },
      ],
      decisionSignalRows: [],
      biEnabled: true,
    });

    expect(summary.status).toBe("complete");
    expect(summary.answer).toContain("Traceable");
    expect(summary.metrics.totalEvents).toBe(12);
    expect(summary.metrics.allowedGatewayDecisions).toBe(5);
    expect(summary.metrics.biConfigured).toBe(true);
    expect(summary.questions.every((question) => question.status === "complete")).toBe(
      true,
    );
  });

  it("marks warning when governed rows exist but review signals are open", () => {
    const summary = buildNorthStarSummary({
      healthRows: [
        {
          environment: "test",
          tribeId: "codex",
          eventType: "codex.pipeline.flush",
          eventDay: "2026-05-20",
          eventCount: 1,
        },
      ],
      qualityRows: [],
      sharedServiceUsageRows: [],
      gatewayDecisionRows: [],
      costRows: [],
      decisionSignalRows: [
        {
          signalId: "test:pipeline_stale:codex",
          environment: "test",
          tribeId: "codex",
          signalType: "pipeline_stale",
          severity: "high",
          metricName: "latest_ingested_at_age_hours",
          observedValue: 25,
          expectedValue: 24,
          recommendation: "check connector lag",
          evidenceWindowStart: "2026-05-20T00:00:00.000Z",
          evidenceWindowEnd: "2026-05-20T23:59:59.000Z",
          createdAt: "2026-05-20T23:00:00.000Z",
          status: "open",
        },
      ],
      biEnabled: false,
    });

    expect(summary.status).toBe("warning");
    expect(summary.metrics.openDecisionSignals).toBe(1);
    expect(summary.questions.find((question) => question.key === "visualization")?.status).toBe(
      "missing",
    );
  });

  it("marks not-ready when no curated rows are present", () => {
    const summary = buildNorthStarSummary({
      healthRows: [],
      qualityRows: [],
      sharedServiceUsageRows: [],
      gatewayDecisionRows: [],
      costRows: [],
      decisionSignalRows: [],
      biEnabled: false,
    });

    expect(summary.status).toBe("missing");
    expect(summary.answer).toContain("Not enough curated evidence");
  });
});
