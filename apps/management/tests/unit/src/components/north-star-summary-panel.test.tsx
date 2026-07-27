import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NorthStarSummary } from "@/lib/data-pipeline/north-star-summary";
import { NorthStarSummaryPanel } from "../../../../src/components/north-star-summary-panel";

const summary: NorthStarSummary = {
  status: "warning",
  answer:
    "Partially traceable: curated evidence exists, but one or more supporting questions need review.",
  metrics: {
    totalEvents: 12,
    uniqueTribes: 1,
    uniqueSourceServices: 1,
    allowedGatewayDecisions: 5,
    deniedGatewayDecisions: 1,
    qualityErrors: 0,
    sharedServiceFailures: 0,
    estimatedCostUsd: 0.01,
    openDecisionSignals: 1,
    biConfigured: false,
  },
  questions: [
    {
      key: "ownership",
      label: "Who produced what?",
      answer: "1 tribe is visible.",
      status: "complete",
      evidenceCount: 1,
    },
    {
      key: "visualization",
      label: "Is the BI view connected?",
      answer: "BI embed is not configured.",
      status: "missing",
      evidenceCount: 0,
    },
  ],
};

describe("NorthStarSummaryPanel", () => {
  afterEach(() => cleanup());

  it("renders the north-star answer and metric totals", () => {
    render(<NorthStarSummaryPanel summary={summary} />);

    expect(screen.getByText("North-star answer")).toBeTruthy();
    expect(screen.getByText(/Partially traceable/)).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Total events")).toBeTruthy();
    expect(screen.getByText("Open signals")).toBeTruthy();
  });

  it("renders supporting questions with status labels", () => {
    render(<NorthStarSummaryPanel summary={summary} />);

    expect(screen.getByText("Who produced what?")).toBeTruthy();
    expect(screen.getByText("Is the BI view connected?")).toBeTruthy();
    expect(screen.getByText("Missing")).toBeTruthy();
  });
});
