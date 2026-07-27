import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeprecationWorkflowPanel } from "../../../../src/components/deprecation-workflow-panel";

describe("DeprecationWorkflowPanel", () => {
  it("shows impacted deprecation actions", () => {
    render(
      <DeprecationWorkflowPanel
        deprecations={[
          {
            productId: "payment",
            status: "deprecated",
            impactedConsumers: ["campus-one"],
            nextAction: "Notify impacted consumers and track migration.",
          },
        ]}
      />,
    );

    expect(screen.getByText("Deprecation workflow")).toBeTruthy();
    expect(screen.getByText("payment")).toBeTruthy();
  });
});
