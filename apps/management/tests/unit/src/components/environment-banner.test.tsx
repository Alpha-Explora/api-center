import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnvironmentBanner } from "../../../../src/components/environment-banner";

describe("EnvironmentBanner", () => {
  it("shows live warning text", () => {
    render(<EnvironmentBanner environment="live" authMode="google" />);
    expect(screen.getByText("Live environment")).toBeTruthy();
    expect(screen.getByText("Writes require confirmation and reason.")).toBeTruthy();
  });

  it("shows local development state", () => {
    render(<EnvironmentBanner environment="test" authMode="local-dev" />);
    expect(screen.getByText("Local development")).toBeTruthy();
  });
});
