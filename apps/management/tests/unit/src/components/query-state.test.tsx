import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";

describe("query states", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a structured recovery path for failed workflow data", () => {
    render(
      <ActionFailedState
        title="Marketplace unavailable"
        description="API product data could not be loaded."
        recoverySteps={[
          {
            label: "Check management API base URL",
            description: "Confirm the local management API can be reached.",
          },
          {
            label: "Reload the workflow",
          },
        ]}
      />,
    );

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Recovery path")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Recovery path" }),
    ).toBeTruthy();
    expect(screen.getByText("Check management API base URL")).toBeTruthy();
    expect(
      screen.getByText("Confirm the local management API can be reached."),
    ).toBeTruthy();
    expect(screen.getByText("Reload the workflow")).toBeTruthy();
  });

  it("announces empty data as status instead of an error alert", () => {
    render(
      <EmptyDataState
        title="No services registered yet"
        description="Register a service to start using this workflow."
      />,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
