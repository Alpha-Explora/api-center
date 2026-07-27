import { describe, expect, it } from "vitest";
import { mergeTimelineEvents } from "../../../../src/lib/service-timeline";

describe("mergeTimelineEvents", () => {
  it("sorts newest events first", () => {
    const events = mergeTimelineEvents([
      {
        id: "audit-1",
        occurredAt: "2026-05-17T01:00:00.000Z",
        source: "audit",
        title: "Manifest updated",
        severity: "info",
      },
      {
        id: "alert-1",
        occurredAt: "2026-05-17T02:00:00.000Z",
        source: "alert",
        title: "Smoke failure",
        severity: "error",
      },
    ]);

    expect(events[0].id).toBe("alert-1");
  });
});
