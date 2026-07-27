import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RuntimeDependencyMapPanel } from "../../../../src/components/runtime-dependency-map-panel";

describe("RuntimeDependencyMapPanel", () => {
  it("shows runtime dependency edges", () => {
    render(
      <RuntimeDependencyMapPanel
        edges={[
          {
            from: "campus-one",
            to: "payment-service",
            type: "shared-service",
          },
        ]}
      />,
    );

    expect(screen.getByText("Runtime dependency map")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "payment-service" })
        .getAttribute("href"),
    ).toBe("/tribes/payment-service?section=dependencies");
  });
});
