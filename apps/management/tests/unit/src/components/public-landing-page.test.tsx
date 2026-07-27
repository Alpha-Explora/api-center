import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicLandingPage } from "@/components/public-landing-page";

describe("PublicLandingPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the copied Linkify public landing sections", () => {
    render(<PublicLandingPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /smart links with precision/i,
      }),
    ).toBeTruthy();
    expect(
      screen
        .getAllByRole("link", { name: /^get started$/i })[0]
        .getAttribute("href"),
    ).toBe("/signup");
    expect(screen.queryByRole("link", { name: /enter management/i })).toBeNull();
    expect(screen.getByText("Manage links smarter")).toBeTruthy();
    expect(screen.getByText("Trusted by the best in the industry")).toBeTruthy();
    expect(screen.getByText("Manage Links Like a Pro")).toBeTruthy();
    expect(
      screen.getByText("Effortless link management in 3 steps"),
    ).toBeTruthy();
    expect(screen.getByText("Choose a plan that works for you")).toBeTruthy();
    expect(screen.getByText("What our users are saying")).toBeTruthy();
    expect(screen.getByText("Step into the future of link management")).toBeTruthy();
  });
});
