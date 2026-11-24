import { describe, expect, it } from "vitest";

import { matchesQuery, parseConsolePath, switchEnvironmentPath, visibleOrganizationNav } from "../../../../src/lib/app-navigation";

describe("app navigation", () => {
  it("hides platform-only pages from organization members", () => {
    expect(visibleOrganizationNav(false).map((item) => item.href)).toEqual(["/projects", "/people", "/apis", "/approvals", "/audit", "/settings"]);
    expect(visibleOrganizationNav(true).map((item) => item.href)).toEqual([
      "/projects",
      "/people",
      "/apis",
      "/quotas",
      "/approvals",
      "/organizations",
      "/audit",
      "/requests",
      "/settings",
    ]);
  });

  it("shows organization quotas to organization owners and admins", () => {
    expect(visibleOrganizationNav(false, true).map((item) => item.href)).toEqual(["/projects", "/people", "/apis", "/quotas", "/approvals", "/audit", "/settings"]);
  });

  it("locates organization pages and project sections", () => {
    expect(parseConsolePath("/people")).toEqual({ kind: "organization", sectionId: "people" });
    expect(parseConsolePath("/projects")).toEqual({ kind: "organization", sectionId: "projects" });
    expect(parseConsolePath("/projects/prj_1/live")).toMatchObject({ kind: "project", projectId: "prj_1", environment: "live", sectionId: "overview" });
    expect(parseConsolePath("/apis")).toEqual({ kind: "organization", sectionId: "apis" });
    expect(parseConsolePath("/projects/prj_1/live/apis/api_3")).toMatchObject({ kind: "project", environment: "live", sectionId: "apis", rest: "/apis/api_3" });
    expect(parseConsolePath("/projects/prj_1/test/applications/app_2")).toMatchObject({
      kind: "project",
      environment: "test",
      sectionId: "applications",
      rest: "/applications/app_2",
    });
    expect(parseConsolePath("/projects/prj_1/live/quotas")).toMatchObject({ environment: "live", sectionId: "quotas" });
    expect(parseConsolePath("/projects/prj_1/test/requests")).toMatchObject({ environment: "test", sectionId: "requests" });
    expect(parseConsolePath("/projects/prj_1/test/payouts")).toMatchObject({ environment: "test", sectionId: "payouts" });
    expect(parseConsolePath("/audit")).toEqual({ kind: "organization", sectionId: "audit" });
  });

  it("locates project pages that cover both environments", () => {
    expect(parseConsolePath("/projects/prj_1/settings")).toEqual({ kind: "project", projectId: "prj_1", environment: undefined, sectionId: "settings", rest: "/settings" });
    expect(switchEnvironmentPath("/projects/prj_1/settings", "live")).toBeUndefined();
  });

  it("switches environment to the same section, dropping environment-specific objects", () => {
    expect(switchEnvironmentPath("/projects/prj_1/test/capabilities", "live")).toBe("/projects/prj_1/live/capabilities");
    expect(switchEnvironmentPath("/projects/prj_1/test/applications/app_2", "live")).toBe("/projects/prj_1/live/applications");
    expect(switchEnvironmentPath("/projects/prj_1/test/apis/api_3", "live")).toBe("/projects/prj_1/live/apis");
    expect(switchEnvironmentPath("/projects/prj_1/live", "test")).toBe("/projects/prj_1/test");
    expect(switchEnvironmentPath("/people", "live")).toBeUndefined();
  });

  it("matches every search word against labels and keywords", () => {
    expect(matchesQuery("api key", "Applications", "app keys credentials api key")).toBe(true);
    expect(matchesQuery("api billing", "Applications", "app keys credentials api key")).toBe(false);
    expect(matchesQuery("  ", "anything")).toBe(true);
  });
});
