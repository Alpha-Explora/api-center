import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DataPipelineCostPanel } from "../../../../src/components/data-pipeline-cost-panel";

describe("DataPipelineCostPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains when Athena query-cost telemetry has not flushed yet", () => {
    render(<DataPipelineCostPanel rows={[]} />);

    expect(screen.getByText("No Athena cost rows yet")).toBeTruthy();
    expect(
      screen.getByText(/stays empty until those telemetry events are exported/),
    ).toBeTruthy();
  });
});
