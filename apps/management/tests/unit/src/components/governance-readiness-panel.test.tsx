import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GovernanceReadinessPanel } from "../../../../src/components/governance-readiness-panel";

describe("GovernanceReadinessPanel", () => {
  it("shows quota, policy, approval, image, and SDK contract state", () => {
    render(
      <GovernanceReadinessPanel
        governance={{
          status: "up",
          quotaEnforcer: "up",
          policyEngine: "up",
          approvals: "up",
          imageTag: "api-center:test",
          sdkContractVersion: "2026-05-25",
        }}
      />,
    );

    expect(screen.getByText("Governance readiness")).toBeTruthy();
    expect(screen.getByText("api-center:test")).toBeTruthy();
    expect(screen.getByText("2026-05-25")).toBeTruthy();
  });
});
