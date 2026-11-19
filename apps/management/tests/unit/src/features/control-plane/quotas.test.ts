import { describe, expect, it } from "vitest";
import {
  EMPTY_QUOTA_FORM,
  formatQuotaLimit,
  formatWindow,
  policiesForEnvironment,
  quotaFormToBody,
  sharedQuotaFormToBody,
  type QuotaPolicy,
} from "@/features/control-plane/model/quotas";

describe("quota windows", () => {
  it("reads in the largest unit that divides the window exactly", () => {
    expect(formatWindow(1)).toBe("second");
    expect(formatWindow(60)).toBe("minute");
    expect(formatWindow(3_600)).toBe("hour");
    expect(formatWindow(86_400)).toBe("day");
    expect(formatWindow(300)).toBe("5 minutes");
    expect(formatWindow(90)).toBe("90 seconds");
    expect(formatWindow(7_200)).toBe("2 hours");
    expect(formatWindow(2_678_400)).toBe("31 days");
  });

  it("formats a limit with thousands separators and singular requests", () => {
    expect(formatQuotaLimit(1_000, 3_600)).toBe("1,000 requests / hour");
    expect(formatQuotaLimit(1, 1)).toBe("1 request / second");
    expect(formatQuotaLimit(2_000_000_000, 2_592_000)).toBe("2,000,000,000 requests / 30 days");
  });
});

describe("project quota form", () => {
  it("builds the gateway body from a preset window, omitting an empty capability", () => {
    expect(quotaFormToBody({ ...EMPTY_QUOTA_FORM, maxRequests: "1,000" }, "test")).toEqual({
      ok: true,
      body: { environmentKind: "test", windowSeconds: 3_600, maxRequests: 1_000, mode: "enforce" },
    });
  });

  it("uses the custom window and the chosen capability and mode", () => {
    const result = quotaFormToBody({ capability: "email", window: "custom", customSeconds: "900", maxRequests: "50", mode: "observe" }, "live");
    expect(result).toEqual({ ok: true, body: { environmentKind: "live", capability: "email", windowSeconds: 900, maxRequests: 50, mode: "observe" } });
  });

  it("rejects windows and limits outside the gateway's bounds", () => {
    const tooLong = quotaFormToBody({ ...EMPTY_QUOTA_FORM, window: "custom", customSeconds: "2678401", maxRequests: "10" }, "test");
    expect(tooLong.ok).toBe(false);
    expect(!tooLong.ok && tooLong.errors.windowSeconds).toBeTruthy();

    for (const maxRequests of ["", "0", "1.5", "-3", "2000000001", "ten"]) {
      const result = quotaFormToBody({ ...EMPTY_QUOTA_FORM, maxRequests }, "test");
      expect(result.ok, maxRequests).toBe(false);
      expect(!result.ok && result.errors.maxRequests).toBeTruthy();
    }
    expect(quotaFormToBody({ ...EMPTY_QUOTA_FORM, window: "custom", customSeconds: "0", maxRequests: "1" }, "test").ok).toBe(false);
    expect(quotaFormToBody({ ...EMPTY_QUOTA_FORM, window: "custom", customSeconds: "2678400", maxRequests: "1" }, "test").ok).toBe(true);
  });
});

describe("shared ceiling form", () => {
  it("adds the covered projects without duplicates", () => {
    const result = sharedQuotaFormToBody({ ...EMPTY_QUOTA_FORM, maxRequests: "10", projectIds: ["prj_a", "prj_b", "prj_a"] }, "test");
    expect(result).toEqual({ ok: true, body: { environmentKind: "test", windowSeconds: 3_600, maxRequests: 10, mode: "enforce", projectIds: ["prj_a", "prj_b"] } });
  });

  it("needs at least one project and reports every problem at once", () => {
    const result = sharedQuotaFormToBody({ ...EMPTY_QUOTA_FORM, maxRequests: "", projectIds: [] }, "live");
    expect(result.ok).toBe(false);
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(["maxRequests", "projectIds"]);
  });
});

describe("policies for an environment", () => {
  const policy = (id: string, scope: "project" | "shared", environmentKind: "test" | "live"): QuotaPolicy => ({
    id,
    scope,
    projectId: scope === "project" ? "prj_a" : null,
    environmentKind,
    capability: null,
    windowSeconds: 60,
    maxRequests: 10,
    mode: "enforce",
    status: "active",
  });

  it("splits the project's own policies from shared ceilings, for one environment kind", () => {
    const result = policiesForEnvironment([policy("qp_1", "project", "test"), policy("qp_2", "shared", "test"), policy("qp_3", "project", "live")], "test");
    expect(result.project.map((entry) => entry.id)).toEqual(["qp_1"]);
    expect(result.shared.map((entry) => entry.id)).toEqual(["qp_2"]);
  });
});
