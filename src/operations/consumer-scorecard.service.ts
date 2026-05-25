import { Injectable } from "@nestjs/common";

export type ConsumerScorecardMetric = number | "unknown";

@Injectable()
export class ConsumerScorecardService {
  score(input: {
    ownerTribeId: string;
    sdkVersion: string;
    latestSdkVersion: string;
    quotaUsagePercent: ConsumerScorecardMetric;
    errorRatePercent: ConsumerScorecardMetric;
  }) {
    const findings: string[] = [];

    if (input.sdkVersion === "unknown") {
      findings.push("SDK version is not reported.");
    } else if (input.sdkVersion !== input.latestSdkVersion) {
      findings.push("SDK version is behind the current supported version.");
    }
    if (input.quotaUsagePercent === "unknown") {
      findings.push("Quota usage metric is unavailable.");
    } else if (input.quotaUsagePercent >= 90) {
      findings.push("Quota usage is above 90 percent.");
    }
    if (input.errorRatePercent === "unknown") {
      findings.push("Gateway error rate metric is unavailable.");
    } else if (input.errorRatePercent >= 2) {
      findings.push("Error rate is above the platform threshold.");
    }

    return {
      ownerTribeId: input.ownerTribeId,
      sdkVersion: input.sdkVersion,
      latestSdkVersion: input.latestSdkVersion,
      quotaUsagePercent: input.quotaUsagePercent,
      errorRatePercent: input.errorRatePercent,
      status: findings.length > 0 ? "needs_attention" : "healthy",
      findings,
    };
  }
}
