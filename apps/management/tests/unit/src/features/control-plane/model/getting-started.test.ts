import { describe, expect, it } from "vitest";
import { gettingStartedSteps, sdkSnippet, snippetCall } from "@/features/control-plane/model/getting-started";

const NOW = Date.parse("2026-11-20T00:00:00Z");
const appPath = (id: string, tab: string) => `/applications/${id}?tab=${tab}`;
const future = new Date(NOW + 30 * 24 * 60 * 60 * 1000).toISOString();
const past = new Date(NOW - 1000).toISOString();

const empty = { enabledCapabilities: 0, applications: [], grants: [], credentials: [], requests: 0, now: NOW };

describe("getting started", () => {
  it("starts with every step open, each linking to where it is done", () => {
    const steps = gettingStartedSteps(empty, appPath);
    expect(steps.map((step) => [step.id, step.done, step.path])).toEqual([
      ["capability", false, "/capabilities"],
      ["application", false, "/applications"],
      ["grant", false, "/applications"],
      ["key", false, "/applications"],
      ["request", false, ""],
    ]);
  });

  it("points the grant and key steps at the application that has a grant", () => {
    const steps = gettingStartedSteps(
      {
        ...empty,
        enabledCapabilities: 1,
        applications: [
          { id: "app_a", status: "active" },
          { id: "app_b", status: "active" },
        ],
        grants: [{ applicationId: "app_b" }],
      },
      appPath,
    );
    expect(steps.find((step) => step.id === "grant")).toMatchObject({ done: true, path: "/applications/app_b?tab=access" });
    expect(steps.find((step) => step.id === "key")).toMatchObject({ done: false, path: "/applications/app_b?tab=keys" });
  });

  it("ignores inactive applications, expired keys and revoked keys", () => {
    const steps = gettingStartedSteps(
      {
        ...empty,
        applications: [{ id: "app_a", status: "disabled" }],
        credentials: [
          { applicationId: "app_a", status: "active", expiresAt: past, lastUsedAt: null },
          { applicationId: "app_a", status: "revoked", expiresAt: future, lastUsedAt: null },
        ],
      },
      appPath,
    );
    expect(steps.find((step) => step.id === "application")?.done).toBe(false);
    expect(steps.find((step) => step.id === "key")?.done).toBe(false);
  });

  it("counts a first request from usage or from a key's last use", () => {
    expect(gettingStartedSteps({ ...empty, requests: 3 }, appPath).at(-1)?.done).toBe(true);
    const used = gettingStartedSteps({ ...empty, credentials: [{ applicationId: "app_a", status: "active", expiresAt: future, lastUsedAt: past }] }, appPath);
    expect(used.at(-1)?.done).toBe(true);
  });
});

describe("SDK snippet", () => {
  it("calls the first granted action the SDK has a one-liner for", () => {
    expect(snippetCall(["payments:read", "sms:send"]).action).toBe("sms:send");
    expect(snippetCall(["geo:geocode"]).code).toContain("api.geo.geocode");
    expect(snippetCall(["payments:checkout:write"]).code).toContain("idempotencyKey");
  });

  it("falls back to whoami when no granted action has a call", () => {
    expect(snippetCall([])).toEqual({ action: "", code: expect.stringContaining("api.whoami()") });
    expect(snippetCall(["gauth:logout", "api:orders:read"]).action).toBe("");
  });

  it("uses the environment's key prefix and the published package", () => {
    const snippet = sdkSnippet("live", ["email:send"]);
    expect(snippet.install).toBe("npm install @alpha-explora/apicenter-sdk");
    expect(snippet.env).toBe("APICENTER_API_KEY=ak_live_…");
    expect(snippet.npmrc).toContain("@alpha-explora:registry=https://npm.pkg.github.com");
    expect(snippet.code).toContain("new ApiCenter()");
    expect(snippet.code).toContain("api.email.send(");
  });
});
