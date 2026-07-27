import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GovernanceDriftPanel } from "../../../../src/components/governance-drift-panel";

describe("GovernanceDriftPanel", () => {
  it("shows drift items for operators", () => {
    render(
      <GovernanceDriftPanel
        items={[
          {
            severity: "critical",
            resourceType: "quotaPolicy",
            resourceId: "quota-1",
            ownerTribeId: "campus-one",
            message: "Quota policy is configured in Management but not active.",
          },
        ]}
      />,
    );

    expect(screen.getByText("Governance drift")).toBeTruthy();
    expect(screen.getByText("campus-one")).toBeTruthy();
  });
});
