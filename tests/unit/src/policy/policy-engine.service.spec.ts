import { PolicyEngineService } from "../../../../src/policy/policy-engine.service";

describe("PolicyEngineService", () => {
  let service: PolicyEngineService;

  beforeEach(() => {
    service = new PolicyEngineService();
  });

  it("blocks live shared-service access without an active plan", () => {
    const decisions = service.evaluate({
      targetEnvironment: "live",
      serviceType: "shared",
      hasActivePlan: false,
      hasActiveQuota: true,
    });

    expect(decisions).toContainEqual({
      ruleId: "policy.shared_service_requires_active_plan",
      decision: "block",
      reason: "Live shared-service access requires an active tribe plan.",
      nextAction: "Assign or approve a live-capable tribe plan first.",
    });
  });

  it("blocks live calls without an active quota", () => {
    const decisions = service.evaluate({
      targetEnvironment: "live",
      serviceType: "tribe",
      hasActivePlan: true,
      hasActiveQuota: false,
    });

    expect(decisions.map((decision) => decision.ruleId)).toContain(
      "policy.live_calls_require_active_quota",
    );
    expect(
      decisions.find((decision) => decision.decision === "block"),
    ).toBeTruthy();
  });

  it("blocks experimental services in live", () => {
    const decisions = service.evaluate({
      targetEnvironment: "live",
      serviceType: "tribe",
      serviceTier: "experimental",
      hasActivePlan: true,
      hasActiveQuota: true,
    });

    expect(decisions).toContainEqual(
      expect.objectContaining({
        ruleId: "policy.experimental_service_blocked_in_live",
        decision: "block",
      }),
    );
  });

  it("warns when deprecated service sunset has passed", () => {
    const decisions = service.evaluate({
      targetEnvironment: "test",
      lifecycleStatus: "deprecated",
      sunsetDate: "2026-01-01T00:00:00.000Z",
      hasActivePlan: true,
      hasActiveQuota: true,
    });

    expect(decisions).toContainEqual(
      expect.objectContaining({
        ruleId: "policy.deprecated_service_warn_after_sunset",
        decision: "warn",
      }),
    );
  });

  it("warns when cost-sensitive providers lack target quota", () => {
    const decisions = service.evaluate({
      targetEnvironment: "live",
      serviceType: "shared",
      providerCostSensitive: true,
      hasActivePlan: true,
      hasActiveQuota: true,
      hasTargetQuota: false,
    });

    expect(decisions).toContainEqual(
      expect.objectContaining({
        ruleId: "policy.provider_cost_sensitive_requires_target_quota",
        decision: "warn",
      }),
    );
  });

  it("returns an allow explanation when no rules warn or block", () => {
    expect(
      service.evaluate({
        targetEnvironment: "test",
        serviceType: "tribe",
        hasActivePlan: true,
        hasActiveQuota: true,
      }),
    ).toEqual([
      {
        ruleId: "policy.default_allow",
        decision: "allow",
        reason: "No policy rules blocked or warned for this request.",
        nextAction: "Proceed.",
      },
    ]);
  });
});
