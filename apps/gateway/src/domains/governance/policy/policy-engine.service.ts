import { Injectable } from "@nestjs/common";
import {
  PolicyEvaluationInput,
  PolicyRuleExplanation,
} from "./policy-rule.types";

@Injectable()
export class PolicyEngineService {
  evaluate(input: PolicyEvaluationInput): PolicyRuleExplanation[] {
    const explanations: PolicyRuleExplanation[] = [];
    const isLive = input.targetEnvironment === "live";

    if (
      isLive &&
      input.serviceType === "shared" &&
      input.hasActivePlan === false
    ) {
      explanations.push({
        ruleId: "policy.shared_service_requires_active_plan",
        decision: "block",
        reason: "Live shared-service access requires an active tribe plan.",
        nextAction: "Assign or approve a live-capable tribe plan first.",
      });
    }

    if (isLive && input.hasActiveQuota === false) {
      explanations.push({
        ruleId: "policy.live_calls_require_active_quota",
        decision: "block",
        reason: "Live API calls require an active quota policy.",
        nextAction:
          "Create an observe-mode quota and approve live enforcement.",
      });
    }

    if (isLive && input.serviceTier === "experimental") {
      explanations.push({
        ruleId: "policy.experimental_service_blocked_in_live",
        decision: "block",
        reason: "Experimental services cannot receive live traffic.",
        nextAction: "Promote the service tier or route this call to test.",
      });
    }

    if (
      input.lifecycleStatus === "deprecated" &&
      input.sunsetDate &&
      new Date(input.sunsetDate).getTime() <= Date.now()
    ) {
      explanations.push({
        ruleId: "policy.deprecated_service_warn_after_sunset",
        decision: "warn",
        reason: "The target service is deprecated and past its sunset date.",
        nextAction: "Migrate callers to the replacement service.",
      });
    }

    if (input.providerCostSensitive && input.hasTargetQuota === false) {
      explanations.push({
        ruleId: "policy.provider_cost_sensitive_requires_target_quota",
        decision: "warn",
        reason:
          "Provider-cost-sensitive shared services should use target-specific quotas.",
        nextAction: "Create a target-specific quota before raising traffic.",
      });
    }

    if (!explanations.length) {
      explanations.push({
        ruleId: "policy.default_allow",
        decision: "allow",
        reason: "No policy rules blocked or warned for this request.",
        nextAction: "Proceed.",
      });
    }

    return explanations;
  }
}
