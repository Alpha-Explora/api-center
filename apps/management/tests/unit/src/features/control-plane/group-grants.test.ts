import { describe, expect, it } from "vitest";
import { groupGrants } from "@/features/control-plane/views/applications/access-tab";
import type { Grant } from "@/features/control-plane/model/control-plane";

const grant = (action: string, capability?: string): Grant => ({ id: action, action, capability, status: "active", provenance: "console" });
const names: Record<string, string> = { payments: "Payments", email: "Email", sms: "SMS" };

describe("groupGrants", () => {
  it("groups actions under their capability, by capability name, actions in order", () => {
    const groups = groupGrants(
      [grant("payments:refunds:write", "payments"), grant("email:send", "email"), grant("payments:read", "payments"), grant("sms:send", "sms")],
      (id) => names[id] ?? id,
    );
    expect(groups.map((group) => [group.name, group.grants.map((entry) => entry.action)])).toEqual([
      ["Email", ["email:send"]],
      ["Payments", ["payments:read", "payments:refunds:write"]],
      ["SMS", ["sms:send"]],
    ]);
  });

  it("falls back to the action's prefix when a grant has no capability", () => {
    expect(groupGrants([grant("geo:geocode")], (id) => id)[0]).toMatchObject({ capability: "geo", name: "geo" });
  });
});
