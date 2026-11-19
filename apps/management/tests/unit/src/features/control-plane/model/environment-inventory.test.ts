import { describe, expect, it } from "vitest";
import { expiryState, isUsableKey, keysNeedingReplacement } from "@/features/control-plane/model/environment-inventory";

const NOW = Date.parse("2026-11-20T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const key = (id: string, inDays: number, status = "active") => ({ id, status, expiresAt: new Date(NOW + inDays * DAY).toISOString() });

describe("key expiry", () => {
  it("flags active keys that expired or expire within 14 days", () => {
    expect(expiryState(key("a", -1), NOW)).toBe("expired");
    expect(expiryState(key("b", 0), NOW)).toBe("expired");
    expect(expiryState(key("c", 3), NOW)).toBe("expiring");
    expect(expiryState(key("d", 14), NOW)).toBe("expiring");
    expect(expiryState(key("e", 15), NOW)).toBe("current");
  });

  it("never flags a revoked key", () => {
    expect(expiryState(key("a", -1, "revoked"), NOW)).toBe("current");
    expect(expiryState(key("b", 2, "revoked"), NOW)).toBe("current");
  });

  it("lists keys needing replacement soonest first", () => {
    const keys = [key("later", 10), key("fine", 60), key("expired", -2), key("revoked", 1, "revoked"), key("soon", 2)];
    expect(keysNeedingReplacement(keys, NOW).map((entry) => entry.id)).toEqual(["expired", "soon", "later"]);
  });

  it("treats only active, unexpired keys as usable", () => {
    expect(isUsableKey(key("a", 1), NOW)).toBe(true);
    expect(isUsableKey(key("b", -1), NOW)).toBe(false);
    expect(isUsableKey(key("c", 1, "revoked"), NOW)).toBe(false);
  });
});
