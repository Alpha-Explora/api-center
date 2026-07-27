import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TribeCostAndQuotaPanel } from "../../../../src/components/tribe-cost-and-quota-panel";

describe("TribeCostAndQuotaPanel", () => {
  it("shows high usage pressure and chargeback total", () => {
    render(<TribeCostAndQuotaPanel totalCost={6.85} quotaUsagePercent={92} />);

    expect(screen.getByText("Cost and quota pressure")).toBeTruthy();
    expect(screen.getByText("High usage")).toBeTruthy();
    expect(screen.getByText("$6.85")).toBeTruthy();
  });
});
