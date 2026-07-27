import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionReadiness } from "@/components/action-readiness";

describe("ActionReadiness", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders action requirements with accessible status text", () => {
    render(
      <ActionReadiness
        title="Before applying"
        items={[
          {
            label: "Target selected",
            ready: true,
            readyText: "Ready",
            pendingText: "Required",
          },
          {
            label: "Confirmation phrase",
            ready: false,
            readyText: "Ready",
            pendingText: "Required",
            detail: "Type APPLY LIVE CHANGE exactly.",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("status", { name: "Before applying" }),
    ).toBeTruthy();
    expect(screen.getByText("Target selected")).toBeTruthy();
    expect(screen.getByText("Target selected: Ready")).toBeTruthy();
    expect(screen.getByText("Confirmation phrase: Required")).toBeTruthy();
    expect(screen.getByText("Type APPLY LIVE CHANGE exactly.")).toBeTruthy();
  });
});
