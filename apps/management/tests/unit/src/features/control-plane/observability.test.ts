import { describe, expect, it } from "vitest";
import { accessFrom } from "@/features/control-plane/model/access";
import type { Me } from "@/features/control-plane/model/control-plane";
import {
  auditActionLabel,
  auditSearch,
  baseMeter,
  bucketLabel,
  formatDuration,
  meterLevel,
  niceCeiling,
  quotaMetersSchema,
  requestLogSearch,
  statusCodeTone,
  usageSeriesSchema,
} from "@/features/control-plane/model/observability";

const NOW = Date.parse("2026-11-20T10:00:00Z");

describe("request log", () => {
  it("asks for one window anchored at now, with only the filters that are set", () => {
    const params = new URLSearchParams(requestLogSearch({ range: "1h" }, NOW));
    expect(Object.fromEntries(params)).toEqual({ from: "2026-11-20T09:00:00.000Z", to: "2026-11-20T10:00:00.000Z", limit: "50" });
    const filtered = new URLSearchParams(requestLogSearch({ range: "7d", applicationId: "app_x", status: "5xx" }, NOW, "cur"));
    expect(filtered.get("from")).toBe("2026-11-13T10:00:00.000Z");
    expect(filtered.get("applicationId")).toBe("app_x");
    expect(filtered.get("status")).toBe("5xx");
    expect(filtered.get("cursor")).toBe("cur");
  });

  it("colors statuses by class and formats durations", () => {
    expect([200, 302, 404, 429, 502].map(statusCodeTone)).toEqual(["success", "info", "warning", "warning", "danger"]);
    expect(formatDuration(84.4)).toBe("84 ms");
    expect(formatDuration(1_234)).toBe("1.2 s");
    expect(formatDuration(42_000)).toBe("42 s");
  });
});

describe("usage chart", () => {
  it("rounds the axis up to 1, 2 or 5 times a power of ten", () => {
    expect([0, 1, 3, 7, 12, 99, 101, 2_400].map(niceCeiling)).toEqual([1, 1, 5, 10, 20, 100, 200, 5_000]);
  });

  it("labels hourly and daily buckets in UTC", () => {
    expect(bucketLabel("2026-11-20T03:00:00.000Z", "hour")).toBe("03:00");
    expect(bucketLabel("2026-11-20T00:00:00.000Z", "day")).toBe("Nov 20");
  });

  it("parses the gateway's series", () => {
    expect(
      usageSeriesSchema.parse({
        range: "24h",
        bucket: "hour",
        from: "a",
        to: "b",
        totals: { requests: 1, failed: 0 },
        series: [{ start: "a", requests: 1, failed: 0 }],
        byApplication: [{ applicationId: "app_a", requests: 1, failed: 0, series: [1] }],
        byAction: [{ capability: "email", action: "email:send", requests: 1, failed: 0 }],
      }).totals.requests,
    ).toBe(1);
  });
});

describe("quota meters", () => {
  const meter = { used: 0, limit: 100, mode: "enforce" as const };

  it("warns from 80% and fails when an enforced budget is full", () => {
    expect(meterLevel({ ...meter, used: 50 })).toEqual({ percent: 50, tone: "success" });
    expect(meterLevel({ ...meter, used: 80 })).toEqual({ percent: 80, tone: "warning" });
    expect(meterLevel({ ...meter, used: 100 })).toEqual({ percent: 100, tone: "danger" });
    expect(meterLevel({ ...meter, used: 150, mode: "observe" })).toEqual({ percent: 100, tone: "warning" });
  });

  it("has no level when nothing is counted or the budget is unlimited", () => {
    expect(meterLevel({ ...meter, used: null })).toBeUndefined();
    expect(meterLevel({ ...meter, limit: null })).toBeUndefined();
  });

  it("finds the plan or test default meter", () => {
    const base = { policyId: null, capability: null, mode: "enforce", windowSeconds: 86_400, windowStart: "a", windowEnd: "b" };
    const meters = quotaMetersSchema.parse({
      generatedAt: "now",
      planKey: null,
      baseBudget: "test-default",
      meters: [
        { ...base, budgetKey: "policy:qp_1", source: "project-policy", policyId: "qp_1", limit: 5, used: 1 },
        { ...base, budgetKey: "test-default:env", source: "test-default", limit: 1000, used: 3 },
      ],
    });
    expect(baseMeter(meters)?.budgetKey).toBe("test-default:env");
  });
});

describe("audit log", () => {
  it("reads actions as sentences", () => {
    expect(auditActionLabel("control_plane.credential.revoked")).toBe("Key revoked");
    expect(auditActionLabel("control_plane.api_access.granted")).toBe("API access granted");
    expect(auditActionLabel("control_plane.live.activation_approved")).toBe("Live activation approved");
    expect(auditActionLabel("control_plane.project_role.set")).toBe("Project role set");
    expect(auditActionLabel("legacy.thing")).toBe("Legacy thing");
    expect(auditActionLabel("control_plane.capability_config.put")).toBe("Capability settings updated");
  });

  it("omits the time filter for all time and normalizes the actor", () => {
    expect(Object.fromEntries(new URLSearchParams(auditSearch({ range: "all", actor: " Dev@Example.test " }, NOW)))).toEqual({
      limit: "50",
      actor: "dev@example.test",
    });
    const params = new URLSearchParams(auditSearch({ range: "24h", projectId: "prj_a", action: "control_plane.credential" }, NOW, "c", 10));
    expect(params.get("from")).toBe("2026-11-19T10:00:00.000Z");
    expect(params.get("limit")).toBe("10");
    expect(params.get("action")).toBe("control_plane.credential");
  });

  it("lets owners, admins and project admins read it, and nobody else", () => {
    const me = (organizationRole: string, projectRoles: Record<string, string> = {}) =>
      ({ actor: { kind: "member", email: "x@example.test" }, platformAccess: false, organizationRole, projectRoles }) as unknown as Me;
    expect(accessFrom(me("admin")).canReadOrganizationAudit).toBe(true);
    expect(accessFrom(me("developer", { prj_a: "admin" }))).toMatchObject({ canReadAuditLog: true, canReadOrganizationAudit: false });
    expect(accessFrom(me("developer", { prj_a: "developer" })).canReadAuditLog).toBe(false);
    expect(accessFrom(undefined).canReadAuditLog).toBe(false);
  });
});
