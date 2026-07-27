import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BiEmbedPanel } from "../../../../src/components/bi-embed-panel";

describe("BiEmbedPanel", () => {
  afterEach(() => cleanup());

  it("shows a provider-neutral empty state when the embed is not configured", () => {
    render(<BiEmbedPanel config={{ enabled: false, provider: "none" }} />);

    expect(screen.getByText("BI dashboard not configured")).toBeTruthy();
    expect(screen.queryByTitle("APICenter north-star BI dashboard")).toBeNull();
  });

  it("renders a Looker Studio iframe with provider label", () => {
    render(
      <BiEmbedPanel
        config={{
          enabled: true,
          provider: "looker-studio",
          embedUrl:
            "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
          dashboardId: "north-star",
        }}
      />,
    );

    const frame = screen.getByTitle("APICenter north-star BI dashboard");
    expect(frame.getAttribute("src")).toBe(
      "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
    );
    expect(screen.getByText("Looker Studio")).toBeTruthy();
    expect(screen.getByText("Dashboard id: north-star")).toBeTruthy();
  });

  it("renders a Looker iframe with provider label", () => {
    render(
      <BiEmbedPanel
        config={{
          enabled: true,
          provider: "looker",
          embedUrl: "https://analytics.example.com/embed/dashboards/42",
          dashboardId: "42",
          allowedHost: "analytics.example.com",
        }}
      />,
    );

    expect(screen.getByTitle("APICenter north-star BI dashboard")).toBeTruthy();
    expect(screen.getByText("Looker")).toBeTruthy();
  });
});
