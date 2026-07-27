import { afterEach, describe, expect, it, vi } from "vitest";
import { getNorthStarBiConfig } from "../../../../../src/lib/server/north-star-bi-config";

describe("getNorthStarBiConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled when BI_NORTH_STAR_ENABLED is not true", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "false");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker-studio");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: false,
      provider: "none",
      embedUrl: undefined,
      dashboardId: undefined,
      allowedHost: undefined,
    });
  });

  it("accepts a Looker Studio embed URL", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker-studio");
    vi.stubEnv("BI_NORTH_STAR_DASHBOARD_ID", "studio-report");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "looker-studio",
      embedUrl:
        "https://lookerstudio.google.com/embed/reporting/report-id/page/page-id",
      dashboardId: "studio-report",
      allowedHost: undefined,
    });
  });

  it("accepts a Looker instance when the allowed host matches", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker");
    vi.stubEnv("BI_NORTH_STAR_DASHBOARD_ID", "42");
    vi.stubEnv("BI_NORTH_STAR_ALLOWED_HOST", "analytics.example.com");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://analytics.example.com/embed/dashboards/42",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "looker",
      embedUrl: "https://analytics.example.com/embed/dashboards/42",
      dashboardId: "42",
      allowedHost: "analytics.example.com",
    });
  });

  it("rejects a Looker instance when the allowed host is missing", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "looker");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://analytics.example.com/embed/dashboards/42",
    );

    expect(getNorthStarBiConfig()).toMatchObject({
      enabled: false,
      provider: "looker",
      embedUrl: undefined,
    });
  });

  it("accepts a Power BI secure embed URL", () => {
    vi.stubEnv("BI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("BI_NORTH_STAR_PROVIDER", "powerbi");
    vi.stubEnv("BI_NORTH_STAR_DASHBOARD_ID", "powerbi-report");
    vi.stubEnv(
      "BI_NORTH_STAR_EMBED_URL",
      "https://app.powerbi.com/reportEmbed?reportId=abc",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "powerbi",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=abc",
      dashboardId: "powerbi-report",
      allowedHost: undefined,
    });
  });

  it("keeps backwards compatibility with POWERBI_NORTH_STAR variables", () => {
    vi.stubEnv("POWERBI_NORTH_STAR_ENABLED", "true");
    vi.stubEnv("POWERBI_NORTH_STAR_REPORT_ID", "legacy-report");
    vi.stubEnv(
      "POWERBI_NORTH_STAR_EMBED_URL",
      "https://app.powerbi.com/reportEmbed?reportId=abc",
    );

    expect(getNorthStarBiConfig()).toEqual({
      enabled: true,
      provider: "powerbi",
      embedUrl: "https://app.powerbi.com/reportEmbed?reportId=abc",
      dashboardId: "legacy-report",
      allowedHost: undefined,
    });
  });
});
