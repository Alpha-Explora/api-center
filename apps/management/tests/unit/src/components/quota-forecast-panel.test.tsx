import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QuotaForecastPanel } from "../../../../src/components/quota-forecast-panel";

describe("QuotaForecastPanel", () => {
  it("shows quota exhaustion forecast", () => {
    render(
      <QuotaForecastPanel
        daysUntilExhaustion={3}
        projectedMonthlyUsage={30000}
      />,
    );

    expect(screen.getByText("Quota forecast")).toBeTruthy();
    expect(screen.getByText("Quota may be exhausted in 3 days.")).toBeTruthy();
  });
});
