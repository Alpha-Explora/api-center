import { decideCapabilityAccess, type AccessSnapshot } from "../../../../apps/gateway/src/domains/control-plane/capability-access.policy";
import {
  isCatalogedAction,
  resolveCapabilityAction,
} from "../../../../apps/gateway/src/domains/control-plane/capability-catalog";
import {
  credentialMatches,
  generateApplicationCredential,
  newResourceId,
  parseApplicationCredential,
} from "../../../../apps/gateway/src/domains/control-plane/application-credential";

const now = new Date("2026-11-14T00:00:00Z");

function snapshot(overrides: Partial<AccessSnapshot> = {}): AccessSnapshot {
  return {
    now,
    presentedKind: "test",
    organizationStatus: "active",
    project: { status: "active" },
    environment: { kind: "test", status: "active" },
    application: { status: "active" },
    credential: { status: "active", expiresAt: new Date("2027-01-01T00:00:00Z"), environmentKind: "test" },
    capability: { id: "email", status: "enabled" },
    action: "email:send",
    grants: [{ targetKind: "capability", targetId: "email", action: "email:send", status: "active" }],
    ...overrides,
  };
}

describe("decideCapabilityAccess", () => {
  it("allows an explicitly granted action on an enabled capability", () => {
    expect(decideCapabilityAccess(snapshot())).toEqual({ allowed: true, action: "email:send" });
  });

  it("denies when the application holds no grant, even with the capability enabled", () => {
    expect(decideCapabilityAccess(snapshot({ grants: [] }))).toEqual({
      allowed: false,
      denial: { kind: "authorization", code: "ACTION_NOT_GRANTED" },
    });
  });

  it("does not let a grant for one action authorize another", () => {
    const decision = decideCapabilityAccess(snapshot({ action: "email:read" }));
    expect(decision).toMatchObject({ allowed: false, denial: { code: "ACTION_NOT_GRANTED" } });
  });

  it("ignores revoked grants", () => {
    const decision = decideCapabilityAccess(
      snapshot({ grants: [{ targetKind: "capability", targetId: "email", action: "email:send", status: "revoked" }] }),
    );
    expect(decision).toMatchObject({ allowed: false, denial: { code: "ACTION_NOT_GRANTED" } });
  });

  it("denies uncatalogued routes before looking at grants", () => {
    expect(decideCapabilityAccess(snapshot({ action: undefined }))).toMatchObject({
      allowed: false,
      denial: { code: "ACTION_NOT_CATALOGED" },
    });
  });

  it("denies when the capability is not enabled for the environment", () => {
    expect(decideCapabilityAccess(snapshot({ capability: undefined }))).toMatchObject({ denial: { code: "CAPABILITY_NOT_ENABLED" } });
    expect(decideCapabilityAccess(snapshot({ capability: { id: "email", status: "disabled" } }))).toMatchObject({
      denial: { code: "CAPABILITY_NOT_ENABLED" },
    });
  });

  it.each([
    ["CREDENTIAL_REVOKED", { credential: { status: "revoked", expiresAt: new Date("2027-01-01"), environmentKind: "test" as const } }],
    ["CREDENTIAL_EXPIRED", { credential: { status: "active", expiresAt: now, environmentKind: "test" as const } }],
    ["CREDENTIAL_ENVIRONMENT_MISMATCH", { presentedKind: "live" as const }],
    ["CREDENTIAL_ENVIRONMENT_MISMATCH", { environment: { kind: "live" as const, status: "active" } }],
  ])("rejects the credential as unauthenticated: %s", (code, overrides) => {
    expect(decideCapabilityAccess(snapshot(overrides))).toEqual({ allowed: false, denial: { kind: "authentication", code } });
  });

  it.each([
    ["ORGANIZATION_INACTIVE", { organizationStatus: "suspended" }],
    ["PROJECT_INACTIVE", { project: { status: "suspended" } }],
    ["ENVIRONMENT_INACTIVE", { environment: { kind: "test" as const, status: "suspended" } }],
    ["APPLICATION_INACTIVE", { application: { status: "suspended" } }],
  ])("denies requests from inactive owners: %s", (code, overrides) => {
    expect(decideCapabilityAccess(snapshot(overrides))).toEqual({ allowed: false, denial: { kind: "authorization", code } });
  });
});

describe("capability catalog", () => {
  it("maps only catalogued email routes", () => {
    expect(resolveCapabilityAction("email", "POST", "/send")).toBe("email:send");
    expect(resolveCapabilityAction("email", "get", "/status/msg_1")).toBe("email:read");
    expect(resolveCapabilityAction("email", "GET", "/send")).toBeUndefined();
    expect(resolveCapabilityAction("email", "POST", "/admin/projects/x/email-sender/test")).toBeUndefined();
    expect(resolveCapabilityAction("email", "GET", "/status/a/b")).toBeUndefined();
    expect(resolveCapabilityAction("sms", "POST", "/send")).toBe("sms:send");
    expect(resolveCapabilityAction("otp", "POST", "/verify")).toBe("otp:verify");
    expect(resolveCapabilityAction("geo", "POST", "/geofence/check")).toBe("geo:geofence");
    expect(resolveCapabilityAction("gauth", "POST", "/oauth/token/refresh")).toBe("gauth:token");
    expect(resolveCapabilityAction("gauth", "POST", "/admin/oauth-apps/prj_x/test")).toBeUndefined();
    expect(resolveCapabilityAction("payments", "POST", "/checkouts")).toBeUndefined();
  });

  it("knows which actions belong to which capability", () => {
    expect(isCatalogedAction("email", "email:send")).toBe(true);
    expect(isCatalogedAction("email", "sms:send")).toBe(false);
  });
});

describe("application credentials", () => {
  it("generates environment-prefixed keys whose verifier matches only the exact key", () => {
    const generated = generateApplicationCredential("test");
    expect(generated.plaintext).toMatch(/^ak_test_[a-z0-9]{16}_[A-Za-z0-9_-]{43}$/);
    expect(generated.plaintext.startsWith(`${generated.lookupPrefix}_`)).toBe(true);
    expect(parseApplicationCredential(generated.plaintext)).toEqual({ lookupPrefix: generated.lookupPrefix, environmentKind: "test" });
    expect(credentialMatches(generated.plaintext, generated.verifierSha256)).toBe(true);
    expect(credentialMatches(`${generated.plaintext.slice(0, -1)}x`, generated.verifierSha256)).toBe(false);
  });

  it("rejects malformed keys and legacy payment keys", () => {
    expect(parseApplicationCredential("ak_prod_abcdefghijklmnop_" + "a".repeat(43))).toBeUndefined();
    expect(parseApplicationCredential("apic_test_abc")).toBeUndefined();
    expect(parseApplicationCredential("ak_test_short_" + "a".repeat(43))).toBeUndefined();
  });

  it("creates opaque prefixed resource identifiers", () => {
    expect(newResourceId("prj")).toMatch(/^prj_[a-z0-9]{24}$/);
    expect(new Set(Array.from({ length: 50 }, () => newResourceId("app"))).size).toBe(50);
  });
});
