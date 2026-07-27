import { describe, expect, it } from "vitest";
import { allowQueryParams, querySuffix } from "../../../../../src/lib/server/query-params";

describe("allowQueryParams", () => {
  it("keeps only allowlisted params in original allowlist order", () => {
    const request = new Request(
      "http://localhost/api?from=2026-01-01&debug=true&to=2026-01-31",
    );

    expect(allowQueryParams(request, ["from", "to"]).toString()).toBe(
      "from=2026-01-01&to=2026-01-31",
    );
  });

  it("returns an empty query string when no params are allowed", () => {
    const request = new Request("http://localhost/api?debug=true");

    expect(allowQueryParams(request, ["from"]).toString()).toBe("");
  });
});

describe("querySuffix", () => {
  it("prefixes non-empty query params", () => {
    expect(querySuffix(new URLSearchParams("from=2026-01-01"))).toBe(
      "?from=2026-01-01",
    );
  });

  it("returns an empty suffix for empty params", () => {
    expect(querySuffix(new URLSearchParams())).toBe("");
  });
});
