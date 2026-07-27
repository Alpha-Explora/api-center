import { describe, expect, it } from "vitest";

import {
  commandCenterNavGroups,
  getNavSearchResults,
  getVisibleNavGroups,
  type AppNavGroup,
} from "../../../../src/lib/app-navigation";

const groups: AppNavGroup[] = [
  {
    label: "Operate",
    items: [
      {
        href: "/",
        label: "Dashboard",
        description: "Review command center health.",
      },
      {
        href: "/data-pipeline",
        label: "Data pipeline",
        description: "Review data pipeline health.",
      },
    ],
  },
  {
    label: "Registry",
    items: [
      {
        href: "/tribes",
        label: "Services",
        description: "Review registered services.",
      },
    ],
  },
];

describe("app navigation", () => {
  it("exposes the approved command-center information architecture", () => {
    expect(
      commandCenterNavGroups.map((group) => ({
        label: group.label,
        items: group.items.map((item) => item.label),
      })),
    ).toEqual([
      {
        label: "Command",
        items: ["Overview", "Lifecycle", "Issues", "Readiness"],
      },
      {
        label: "Services",
        items: [
          "Registry",
          "API catalog",
          "Requests",
          "Dependencies",
          "Marketplace",
          "Developer portal",
          "Shared services",
        ],
      },
      {
        label: "Operations",
        items: ["Quotas", "Reliability", "Pipeline", "Cost", "Plans"],
      },
      {
        label: "Governance",
        items: ["Compliance", "Audit", "Operational Trust", "Promotions"],
      },
      {
        label: "Tools",
        items: ["SDK runbook", "Manifest tools", "Smoke tests", "Settings"],
      },
    ]);
  });

  it("hides the data pipeline item when the feature is disabled", () => {
    const visible = getVisibleNavGroups(groups, false);

    expect(visible[0].items.map((item) => item.href)).toEqual(["/"]);
  });

  it("keeps the data pipeline item when the feature is enabled", () => {
    const visible = getVisibleNavGroups(groups, true);

    expect(visible[0].items.map((item) => item.href)).toEqual([
      "/",
      "/data-pipeline",
    ]);
  });

  it("finds workflows by label and group", () => {
    expect(
      getNavSearchResults(commandCenterNavGroups, "governance").map(
        (item) => item.href,
      ),
    ).toEqual(["/compliance", "/audit", "/operational-trust", "/promotions"]);
    expect(
      getNavSearchResults(commandCenterNavGroups, "quota").map(
        (item) => item.href,
      ),
    ).toEqual(["/quotas"]);
  });

  it("finds workflows by task aliases and explains the route purpose", () => {
    const rateLimitResults = getNavSearchResults(
      commandCenterNavGroups,
      "rate limit",
    );
    expect(rateLimitResults.map((item) => item.href)).toContain("/quotas");
    expect(rateLimitResults[0].description).toContain("quota");

    expect(
      getNavSearchResults(commandCenterNavGroups, "approval").map(
        (item) => item.href,
      ),
    ).toEqual(["/registration-requests", "/promotions"]);

    expect(
      getNavSearchResults(commandCenterNavGroups, "sdk setup").map(
        (item) => item.href,
      ),
    ).toContain("/docs/consumer-runbook");
  });

  it("keeps hidden feature routes out of workflow search", () => {
    expect(
      getNavSearchResults(commandCenterNavGroups, "pipeline", false).map(
        (item) => item.href,
      ),
    ).toEqual([]);
    expect(
      getNavSearchResults(commandCenterNavGroups, "pipeline", true).map(
        (item) => item.href,
      ),
    ).toEqual(["/data-pipeline"]);
  });
});
