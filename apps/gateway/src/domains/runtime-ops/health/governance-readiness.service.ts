import { Injectable } from "@nestjs/common";

export interface GovernanceReadinessInput {
  quotaEnforcer: boolean;
  policyEngine: boolean;
  approvals: boolean;
  sdkContractVersion: string;
  imageTag: string;
}

export interface GovernanceReadinessSnapshot {
  status: "up" | "down";
  quotaEnforcer: "up" | "down";
  policyEngine: "up" | "down";
  approvals: "up" | "down";
  sdkContractVersion: string;
  imageTag: string;
}

@Injectable()
export class GovernanceReadinessService {
  snapshot(input: GovernanceReadinessInput): GovernanceReadinessSnapshot {
    const quotaEnforcer = input.quotaEnforcer ? "up" : "down";
    const policyEngine = input.policyEngine ? "up" : "down";
    const approvals = input.approvals ? "up" : "down";

    return {
      status:
        quotaEnforcer === "up" && policyEngine === "up" && approvals === "up"
          ? "up"
          : "down",
      quotaEnforcer,
      policyEngine,
      approvals,
      sdkContractVersion: input.sdkContractVersion,
      imageTag: input.imageTag,
    };
  }
}
