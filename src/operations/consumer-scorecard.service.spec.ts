import { ConsumerScorecardService } from "./consumer-scorecard.service";

describe("ConsumerScorecardService", () => {
  it("flags stale SDK usage and quota pressure", () => {
    const service = new ConsumerScorecardService();

    const scorecard = service.score({
      ownerTribeId: "campus-one",
      sdkVersion: "0.1.0",
      latestSdkVersion: "0.3.0",
      quotaUsagePercent: 92,
      errorRatePercent: 1.5,
    });

    expect(scorecard.status).toBe("needs_attention");
    expect(scorecard.findings).toContain(
      "SDK version is behind the current supported version.",
    );
    expect(scorecard.findings).toContain("Quota usage is above 90 percent.");
  });
});
