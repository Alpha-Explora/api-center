import { describe, expect, it } from "vitest";

import {
  commandCenterNavGroups,
  getNavSearchResults,
  getVisibleNavGroups,
} from "../../../../src/lib/app-navigation";

describe("app navigation", () => {
  it("lists the console's pages", () => {
    expect(commandCenterNavGroups.map((group) => [group.label, group.items.map((item) => item.href)])).toEqual([
      ["Workspace", ["/control-plane/projects", "/control-plane/people"]],
      ["Operations", ["/requests", "/settings"]],
    ]);
  });

  it("hides settings from organization members", () => {
    const hrefs = getVisibleNavGroups(commandCenterNavGroups, false).flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).toContain("/requests");
  });

  it("finds pages by label, group and task words", () => {
    expect(getNavSearchResults(commandCenterNavGroups, "people").map((item) => item.href)).toEqual(["/control-plane/people"]);
    expect(getNavSearchResults(commandCenterNavGroups, "api key").map((item) => item.href)).toEqual(["/control-plane/projects"]);
    expect(getNavSearchResults(commandCenterNavGroups, "errors").map((item) => item.href)).toEqual(["/requests"]);
    expect(getNavSearchResults(commandCenterNavGroups, "configuration", false)).toEqual([]);
  });
});
