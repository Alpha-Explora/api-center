import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PromotionEvidencePanel } from "../../../../src/components/promotion-evidence-panel";

describe("PromotionEvidencePanel", () => {
  it("renders evidence sections and an export link", () => {
    render(
      <PromotionEvidencePanel
        serviceId="campus-one"
        sections={[{ key: "health", status: "pass" }]}
      />,
    );

    expect(screen.getByText("Promotion evidence")).toBeTruthy();
    expect(screen.getByText("health")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Export Markdown" })
        .getAttribute("href"),
    ).toBe("/api/local/operations/evidence/campus-one?format=md");
  });
});
