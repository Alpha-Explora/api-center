import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BiAnalyticsPanel } from "../../../../src/components/bi-analytics-panel";

describe("BiAnalyticsPanel", () => {
  afterEach(() => cleanup());

  it("summarizes BI-ready business signals from curated pipeline rows", () => {
    render(
      <BiAnalyticsPanel
        healthRows={[
          {
            environment: "test",
            tribeId: "greenovate",
            sourceServiceId: "greenovate-api",
            eventType: "plant.created",
            eventDay: "2026-05-22",
            eventCount: 30,
          },
          {
            environment: "test",
            tribeId: "shoteam",
            sourceServiceId: "shoteam-api",
            eventType: "ticket.created",
            eventDay: "2026-05-22",
            eventCount: 12,
          },
        ]}
        qualityRows={[
          {
            environment: "test",
            tribeId: "greenovate",
            sourceServiceId: "greenovate-api",
            eventType: "plant.created",
            eventDay: "2026-05-22",
            eventCount: 30,
            validEventCount: 27,
            invalidEventCount: 3,
            qualityErrorCount: 1,
          },
          {
            environment: "test",
            tribeId: "shoteam",
            sourceServiceId: "shoteam-api",
            eventType: "ticket.created",
            eventDay: "2026-05-22",
            eventCount: 12,
            validEventCount: 12,
            invalidEventCount: 0,
            qualityErrorCount: 0,
          },
        ]}
        sharedServiceUsageRows={[
          {
            environment: "test",
            tribeId: "greenovate",
            sharedServiceId: "payment",
            provider: "PayMongo",
            providerStatus: "ok",
            eventDay: "2026-05-22",
            eventCount: 20,
            successCount: 18,
            failureCount: 2,
          },
          {
            environment: "test",
            tribeId: "shoteam",
            sharedServiceId: "gauth",
            provider: "Google OAuth",
            providerStatus: "ok",
            eventDay: "2026-05-22",
            eventCount: 10,
            successCount: 10,
            failureCount: 0,
          },
        ]}
        gatewayDecisionRows={[
          {
            environment: "test",
            tribeId: "greenovate",
            sourceServiceId: "greenovate-api",
            targetServiceId: "payment",
            decision: "allowed",
            eventDay: "2026-05-22",
            decisionCount: 25,
            allowedCount: 24,
            deniedCount: 1,
          },
          {
            environment: "test",
            tribeId: "shoteam",
            sourceServiceId: "shoteam-api",
            targetServiceId: "gauth",
            decision: "allowed",
            eventDay: "2026-05-22",
            decisionCount: 10,
            allowedCount: 10,
            deniedCount: 0,
          },
        ]}
        costRows={[
          {
            environment: "test",
            workgroup: "api-center-platform-validation-test",
            resultPurpose: "pipeline-quality",
            eventDay: "2026-05-22",
            queryCount: 4,
            bytesScanned: 1048576,
            estimatedCostUsd: 0.42,
          },
        ]}
        decisionSignalRows={[
          {
            signalId: "test:quality:greenovate",
            environment: "test",
            tribeId: "greenovate",
            signalType: "bronze_quality_regression",
            severity: "high",
            metricName: "quality_error_count",
            observedValue: 1,
            expectedValue: 0,
            recommendation: "Fix event schema mapping.",
            evidenceWindowStart: "2026-05-22T00:00:00.000Z",
            evidenceWindowEnd: "2026-05-22T23:59:59.000Z",
            createdAt: "2026-05-22T23:59:59.000Z",
            status: "open",
          },
        ]}
      />,
    );

    expect(screen.getByText("Analytics dashboard")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("92.9%")).toBeTruthy();
    expect(screen.getByText("97.1%")).toBeTruthy();
    expect(screen.getByText("93.3%")).toBeTruthy();
    expect(screen.getByText("$0.42")).toBeTruthy();
    expect(screen.getByText("Event volume by tribe")).toBeTruthy();
    expect(screen.getByText("Shared-service demand")).toBeTruthy();
    expect(screen.getByText("Pipeline readiness")).toBeTruthy();
    expect(screen.getByText("Supporting questions")).toBeTruthy();
    expect(screen.getByText("Raw observed")).toBeTruthy();
    expect(screen.getByText("Common Silver")).toBeTruthy();
    expect(screen.getByText("Gold visible")).toBeTruthy();
    expect(screen.getByText("Can BI explain adoption?")).toBeTruthy();
    expect(screen.getByText("Are failures low enough to publish?")).toBeTruthy();
    expect(
      screen.getByLabelText("greenovate event volume 30 of 42"),
    ).toBeTruthy();
    expect(screen.getAllByText("greenovate").length).toBeGreaterThan(0);
    expect(screen.getAllByText("payment").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 open blocker(s)").length).toBeGreaterThan(0);
  });
});
