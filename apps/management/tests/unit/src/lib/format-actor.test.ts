import { describe, expect, it } from "vitest";
import { formatActor } from "@/lib/format";
import { statusLabel } from "@/components/patterns/status-badge";

describe("formatActor", () => {
  it("names a person as recorded", () => {
    expect(formatActor("amgo.it@alphaexplora.com")).toEqual({ name: "amgo.it@alphaexplora.com" });
  });

  it("names whoever acted through the platform credential, and says so", () => {
    expect(formatActor("platform:abtorres.it@alphaexplora.com")).toEqual({ name: "abtorres.it@alphaexplora.com", via: "platform" });
    expect(formatActor("platform:claude-code (requested by the platform owner)")).toEqual({
      name: "claude-code (requested by the platform owner)",
      via: "platform",
    });
  });

  it("reads the bare platform credential and missing actors as words", () => {
    expect(formatActor("platform")).toEqual({ name: "APICenter platform" });
    expect(formatActor(null)).toEqual({ name: "System" });
  });
});

describe("statusLabel", () => {
  it("turns stored statuses into words", () => {
    expect(statusLabel("active")).toBe("Active");
    expect(statusLabel("invite_expired")).toBe("Invite expired");
    expect(statusLabel("")).toBe("");
  });
});
