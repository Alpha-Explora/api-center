import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConsumerScorecardPanel } from "../../../../src/components/consumer-scorecard-panel";

describe("ConsumerScorecardPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows stale SDK and quota findings", () => {
    render(
      <ConsumerScorecardPanel
        scorecards={[
          {
            ownerTribeId: "campus-one",
            status: "needs_attention",
            findings: ["SDK version is behind the current supported version."],
          },
        ]}
      />,
    );

    expect(screen.getByText("Consumer scorecards")).toBeTruthy();
    expect(screen.getAllByText("campus-one").length).toBeGreaterThan(0);
  });

  it("shows unknown metric findings as attention items", () => {
    render(
      <ConsumerScorecardPanel
        scorecards={[
          {
            ownerTribeId: "campus-one",
            status: "needs_attention",
            sdkVersion: "unknown",
            quotaUsagePercent: "unknown",
            errorRatePercent: "unknown",
            findings: [
              "Quota usage metric is unavailable.",
              "Gateway error rate metric is unavailable.",
            ],
          },
        ]}
      />,
    );

    expect(
      screen.getAllByText(
        "Quota usage metric is unavailable., Gateway error rate metric is unavailable.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("prioritizes consumer compliance findings with one selected detail", () => {
    render(
      <ConsumerScorecardPanel
        scorecards={[
          {
            ownerTribeId: "campus-one",
            status: "healthy",
            sdkVersion: "2.4.0",
            latestSdkVersion: "2.4.0",
            quotaUsagePercent: 23,
            errorRatePercent: 0,
            findings: [],
          },
          {
            ownerTribeId: "field-services",
            status: "needs_attention",
            sdkVersion: "1.9.0",
            latestSdkVersion: "2.4.0",
            quotaUsagePercent: 91,
            errorRatePercent: 6,
            findings: [
              "SDK version is behind the current supported version.",
              "Quota usage is above the review threshold.",
            ],
          },
        ]}
      />,
    );

    const detail = screen.getByLabelText("Selected consumer scorecard detail");
    expect(detail.textContent).toContain("field-services");
    expect(detail.textContent).toContain("critical");
    expect(detail.textContent).toContain("Quota usage 91%");
    expect(
      screen
        .getByRole("link", { name: /review quota usage/i })
        .getAttribute("href"),
    ).toBe("/tribes/field-services?section=quotas");
    expect(
      screen
        .getByRole("link", { name: /open service detail/i })
        .getAttribute("href"),
    ).toBe("/tribes/field-services?section=governance");
    expect(
      screen
        .getByRole("link", { name: /open reliability/i })
        .getAttribute("href"),
    ).toBe("/tribes/field-services?section=health");
    expect(
      screen
        .getByRole("link", { name: /review developer handoff/i })
        .getAttribute("href"),
    ).toBe("/developer-portal?tribeId=field-services");

    const healthyButton = screen.getByRole("button", {
      name: "Inspect consumer compliance campus-one",
    });
    expect(healthyButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(healthyButton);

    expect(detail.textContent).toContain("campus-one");
    expect(detail.textContent).toContain("No findings");
    expect(healthyButton.getAttribute("aria-pressed")).toBe("true");
  });
});
