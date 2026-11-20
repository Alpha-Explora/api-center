import { describe, expect, it } from "vitest";
import { auditChanges, dayLabel, groupAuditEntries, humanize } from "@/features/control-plane/model/audit-view";
import type { AuditEntry } from "@/features/control-plane/model/observability";

const NOW = new Date(2026, 10, 21, 15, 0).getTime();
let counter = 0;
function event(action: string, at: Date, overrides: Partial<AuditEntry> = {}): AuditEntry {
  counter += 1;
  return {
    id: `evt-${counter}`,
    occurredAt: at.toISOString(),
    organizationId: "org-1",
    projectId: "prj-smoke",
    environment: "live",
    actor: "platform",
    actorType: "platform",
    action,
    resourceType: "environment",
    resourceId: "env-live",
    outcome: "succeeded",
    message: null,
    correlationId: null,
    details: {},
    ...overrides,
  };
}

describe("groupAuditEntries", () => {
  it("collapses consecutive repeats of the same change within a day, and splits days", () => {
    const today = (hour: number, minute: number) => new Date(2026, 10, 21, hour, minute);
    const entries = [
      event("control_plane.environment.suspended", today(14, 5)),
      event("control_plane.environment.suspended", today(14, 4)),
      event("control_plane.environment.suspended", today(14, 3)),
      event("control_plane.member.set", today(12, 0), { actor: "amgo.it@alphaexplora.com", projectId: null }),
      event("control_plane.environment.suspended", today(11, 0)),
      event("control_plane.environment.suspended", new Date(2026, 10, 20, 9, 0)),
    ];

    const days = groupAuditEntries(entries, NOW);

    expect(days.map((day) => day.label)).toEqual(["Today", "Yesterday"]);
    expect(days[0].rows.map((row) => [row.entry.action, row.repeats.length])).toEqual([
      ["control_plane.environment.suspended", 2],
      ["control_plane.member.set", 0],
      // Not adjacent to the first run, so it stays its own row.
      ["control_plane.environment.suspended", 0],
    ]);
    expect(days[1].rows).toHaveLength(1);
  });

  it("does not merge the same action by different people or on different resources", () => {
    const at = new Date(2026, 10, 21, 10, 0);
    const days = groupAuditEntries([event("x.y", at, { actor: "a@x.test" }), event("x.y", at, { actor: "b@x.test" }), event("x.y", at, { actor: "b@x.test", resourceId: "other" })], NOW);
    expect(days[0].rows.map((row) => row.repeats.length)).toEqual([0, 0, 0]);
  });
});

describe("dayLabel", () => {
  it("names recent days and dates older ones", () => {
    expect(dayLabel(new Date(2026, 10, 21, 1, 0), NOW)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 20, 23, 0), NOW)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 18, 9, 0), NOW)).toBe("Wed 18 Nov");
    expect(dayLabel(new Date(2025, 10, 18, 9, 0), NOW)).toBe("Tue 18 Nov 2025");
  });
});

describe("auditChanges", () => {
  it("reads a field with its earlier value as before and after", () => {
    expect(auditChanges({ role: "viewer", previousRole: "developer", invited: false })).toEqual([
      { label: "Role", before: "developer", after: "viewer" },
      { label: "Invited", after: "false" },
    ]);
  });

  it("shows a new value without a before, and leaves objects and redacted values to the raw view", () => {
    expect(auditChanges({ role: "admin", previousRole: null, payload: { nested: true }, token: "[redacted]", memberEmail: "jun@serbizio.ph" })).toEqual([
      { label: "Role", before: "none", after: "admin" },
      { label: "Member email", after: "jun@serbizio.ph" },
    ]);
  });

  it("reads before and after objects field by field, marking only what changed", () => {
    expect(auditChanges({ before: { name: "Alpha", slug: "alpha" }, after: { name: "Alpha Explora", slug: "alpha" } })).toEqual([
      { label: "Name", before: "Alpha", after: "Alpha Explora" },
      { label: "Slug", after: "alpha" },
    ]);
  });

  it("humanizes keys", () => {
    expect(humanize("memberEmail")).toBe("Member email");
    expect(humanize("project_id")).toBe("Project id");
  });
});
