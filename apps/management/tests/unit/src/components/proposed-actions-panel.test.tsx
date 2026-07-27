import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DashboardProposedActionsPanel,
  ProposedActionsPanel,
} from "../../../../src/components/proposed-actions-panel";
import type { ServiceRegistryEntry } from "@/lib/schemas";

const service: ServiceRegistryEntry = {
  serviceId: "flow-ci",
  name: "Flow CI",
  version: "1.0.0",
  baseUrl: "https://flow-ci.example.com",
  healthCheck: "/health",
  serviceType: "tribe",
  ownerTeam: "Flow",
  contact: "ops@example.com",
  tags: [],
  serviceTier: "standard",
  consumes: ["payment"],
  exposes: ["/health"],
  requiredScopes: ["shared:payment:invoke"],
  status: "active",
  registeredAt: "2026-05-17T00:00:00.000Z",
  updatedAt: "2026-05-17T01:00:00.000Z",
};

describe("ProposedActionsPanel", () => {
  it("renders proposed registry actions as review-only items", () => {
    render(<DashboardProposedActionsPanel services={[service]} />);

    expect(screen.getByText("Register payment manifest")).toBeTruthy();
    expect(screen.getAllByText("proposal").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Review" }).length).toBeGreaterThan(0);
  });

  it("renders an empty state", () => {
    render(
      <ProposedActionsPanel
        title="Service proposed actions"
        description="No writes run from here."
        actions={[]}
      />,
    );

    expect(
      screen.getByText("No proposed actions for the currently loaded state."),
    ).toBeTruthy();
  });
});
