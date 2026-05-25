import { Injectable } from "@nestjs/common";

type QuotaPolicySummary = { id: string; ownerTribeId: string; mode: string };
type PlanAssignmentSummary = {
  id: string;
  ownerTribeId: string;
  planKey: string;
};

export interface DriftSnapshot {
  management: {
    quotaPolicies: QuotaPolicySummary[];
    planAssignments: PlanAssignmentSummary[];
  };
  runtime: {
    quotaPolicies: QuotaPolicySummary[];
    planAssignments: PlanAssignmentSummary[];
  };
}

export interface GovernanceDriftItem {
  severity: "warning" | "critical";
  resourceType: "quotaPolicy" | "planAssignment";
  resourceId: string;
  ownerTribeId: string;
  message: string;
}

@Injectable()
export class GovernanceDriftService {
  compare(snapshot: DriftSnapshot) {
    const items: GovernanceDriftItem[] = [];
    const runtimeQuotaIds = new Set(
      snapshot.runtime.quotaPolicies.map((policy) => policy.id),
    );
    const runtimePlanIds = new Set(
      snapshot.runtime.planAssignments.map((plan) => plan.id),
    );

    for (const policy of snapshot.management.quotaPolicies) {
      if (!runtimeQuotaIds.has(policy.id)) {
        items.push({
          severity: policy.mode === "enforce" ? "critical" : "warning",
          resourceType: "quotaPolicy",
          resourceId: policy.id,
          ownerTribeId: policy.ownerTribeId,
          message:
            "Quota policy is configured in Management but not active in API Center runtime.",
        });
      }
    }

    for (const plan of snapshot.management.planAssignments) {
      if (!runtimePlanIds.has(plan.id)) {
        items.push({
          severity: "warning",
          resourceType: "planAssignment",
          resourceId: plan.id,
          ownerTribeId: plan.ownerTribeId,
          message:
            "Plan assignment is configured in Management but not active in API Center runtime.",
        });
      }
    }

    return {
      status: items.length > 0 ? "drifted" : "in_sync",
      items,
    };
  }
}
