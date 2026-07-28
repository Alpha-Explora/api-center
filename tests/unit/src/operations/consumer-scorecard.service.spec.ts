import { ConsumerScorecardService } from "../../../../apps/gateway/src/operations/consumer-scorecard.service";

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

  it("uses supplied sdk, quota, and error metrics", () => {
    const service = new ConsumerScorecardService();

    const scorecard = service.score({
      ownerTribeId: "campus-one",
      sdkVersion: "1.0.0",
      latestSdkVersion: "1.2.1",
      quotaUsagePercent: 92,
      errorRatePercent: 2.5,
    });

    expect(scorecard.status).toBe("needs_attention");
    expect(scorecard.sdkVersion).toBe("1.0.0");
    expect(scorecard.quotaUsagePercent).toBe(92);
    expect(scorecard.errorRatePercent).toBe(2.5);
    expect(scorecard.findings).toContain(
      "SDK version is behind the current supported version.",
    );
    expect(scorecard.findings).toContain("Quota usage is above 90 percent.");
    expect(scorecard.findings).toContain(
      "Error rate is above the platform threshold.",
    );
  });

  it("marks unavailable metrics as findings instead of healthy zeroes", () => {
    const service = new ConsumerScorecardService();

    const scorecard = service.score({
      ownerTribeId: "campus-one",
      sdkVersion: "unknown",
      latestSdkVersion: "1.2.1",
      quotaUsagePercent: "unknown",
      errorRatePercent: "unknown",
    });

    expect(scorecard.status).toBe("needs_attention");
    expect(scorecard.findings).toEqual(
      expect.arrayContaining([
        "SDK version is not reported.",
        "Quota usage metric is unavailable.",
        "Gateway error rate metric is unavailable.",
      ]),
    );
  });
});
