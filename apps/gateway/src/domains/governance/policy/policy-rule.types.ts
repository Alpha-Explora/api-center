export type PolicyDecision = "allow" | "warn" | "block";

export interface PolicyRuleExplanation {
  ruleId: string;
  decision: PolicyDecision;
  reason: string;
  nextAction: string;
}

export interface PolicyEvaluationInput {
  targetEnvironment: string;
  serviceType?: "shared" | "tribe";
  serviceTier?: string;
  lifecycleStatus?: string;
  sunsetDate?: string;
  providerCostSensitive?: boolean;
  hasActivePlan?: boolean;
  hasActiveQuota?: boolean;
  hasTargetQuota?: boolean;
}
