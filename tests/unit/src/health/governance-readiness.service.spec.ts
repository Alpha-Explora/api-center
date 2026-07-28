import { GovernanceReadinessService } from "../../../../apps/gateway/src/health/governance-readiness.service";

describe("GovernanceReadinessService", () => {
  it("reports governance as up when all required providers are enabled", () => {
    const service = new GovernanceReadinessService();

    expect(
      service.snapshot({
        quotaEnforcer: true,
        policyEngine: true,
        approvals: true,
        sdkContractVersion: "2026-05-25",
        imageTag: "api-center:test",
      }),
    ).toEqual({
      status: "up",
      quotaEnforcer: "up",
      policyEngine: "up",
      approvals: "up",
      sdkContractVersion: "2026-05-25",
      imageTag: "api-center:test",
    });
  });

  it("reports governance as down when any required provider is missing", () => {
    const service = new GovernanceReadinessService();

    expect(
      service.snapshot({
        quotaEnforcer: true,
        policyEngine: false,
        approvals: true,
        sdkContractVersion: "2026-05-25",
        imageTag: "api-center:test",
      }).status,
    ).toBe("down");
  });
});
