import { EnvironmentPromotionService } from "./environment-promotion.service";

describe("EnvironmentPromotionService", () => {
  const service = new EnvironmentPromotionService();

  it("blocks live promotion until required evidence exists", () => {
    const decision = service.evaluate({
      healthCheckPassed: true,
      smokeTestPassed: false,
      ownerPresent: true,
      contactPresent: false,
      quotaPolicyExists: false,
      planTierAssigned: true,
      eventTopicRequired: true,
      eventTopicExists: false,
      s3ExportRequired: true,
      s3SinkIncluded: false,
      sdkHandoffPacketExists: true,
      liveApprovalApproved: false,
    });

    expect(decision.canPromote).toBe(false);
    expect(decision.blockedGateCount).toBe(6);
    expect(
      decision.gates
        .filter((gate) => gate.required && !gate.passed)
        .map((gate) => gate.id),
    ).toEqual([
      "smoke_test",
      "owner_contact",
      "quota_policy",
      "event_topic",
      "s3_sink",
      "live_approval",
    ]);
  });

  it("allows promotion when all required gates pass", () => {
    const decision = service.evaluate({
      healthCheckPassed: true,
      smokeTestPassed: true,
      ownerPresent: true,
      contactPresent: true,
      quotaPolicyExists: true,
      planTierAssigned: true,
      eventTopicRequired: false,
      eventTopicExists: false,
      s3ExportRequired: false,
      s3SinkIncluded: false,
      sdkHandoffPacketExists: true,
      liveApprovalApproved: true,
    });

    expect(decision.canPromote).toBe(true);
    expect(decision.blockedGateCount).toBe(0);
    expect(decision.gates.every((gate) => gate.passed)).toBe(true);
  });
});
