import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataPipelineGovernancePanel } from "../../../../src/components/data-pipeline-governance-panel";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api-center-client", () => ({
  createPipelineFeedbackAction: vi.fn(),
}));

afterEach(cleanup);

describe("DataPipelineGovernancePanel", () => {
  it("shows decision signal evidence, status, and false-positive action", () => {
    render(
      <DataPipelineGovernancePanel
        decisionSignalRows={[
          {
            signalId: "test:shared_service_error_spike:pakiapps:email:20260520",
            environment: "test",
            tribeId: "pakiapps",
            sourceServiceId: "email",
            signalType: "shared_service_error_spike",
            severity: "medium",
            metricName: "failure_count",
            observedValue: 9,
            expectedValue: 0,
            recommendation: "review provider health",
            evidenceQueryId: "cbde08d3-0488-4aeb-a50e-0e280bcb058e",
            evidenceWindowStart: "2026-05-20T00:00:00.000Z",
            evidenceWindowEnd: "2026-05-20T23:59:59.000Z",
            createdAt: "2026-05-21T00:00:00.000Z",
            status: "open",
          },
        ]}
      />,
    );

    expect(screen.getByText("Decision signals")).toBeTruthy();
    expect(screen.getByText("cbde08d3-0488-4aeb-a50e-0e280bcb058e")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByRole("button", { name: /False positive/i })).toBeTruthy();
  });
});
