import { Injectable } from "@nestjs/common";

@Injectable()
export class ConsumerScorecardService {
  score(input: {
    ownerTribeId: string;
    sdkVersion: string;
    latestSdkVersion: string;
    quotaUsagePercent: number;
    errorRatePercent: number;
  }) {
    const findings: string[] = [];

    if (input.sdkVersion !== input.latestSdkVersion) {
      findings.push("SDK version is behind the current supported version.");
    }
    if (input.quotaUsagePercent >= 90) {
      findings.push("Quota usage is above 90 percent.");
    }
    if (input.errorRatePercent >= 2) {
      findings.push("Error rate is above the platform threshold.");
    }

    return {
      ownerTribeId: input.ownerTribeId,
      status: findings.length > 0 ? "needs_attention" : "healthy",
      findings,
    };
  }
}
