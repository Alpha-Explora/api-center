import type { ManagementEnvironment, ManagementRole } from "./server/management-auth";

export type ActionRisk = "read" | "low-write" | "state-write" | "provider-write" | "destructive";

export type ActionPolicyInput = {
  role: ManagementRole;
  environment: ManagementEnvironment;
  actionRisk: ActionRisk;
};

export type ActionPolicyDecision =
  | {
      allowed: true;
      confirmationRequired: boolean;
      reasonRequired: boolean;
    }
  | {
      allowed: false;
      reason: string;
      confirmationRequired: false;
      reasonRequired: false;
    };

export function authorizeManagementAction(input: ActionPolicyInput): ActionPolicyDecision {
  if (input.actionRisk === "read") {
    return { allowed: true, confirmationRequired: false, reasonRequired: false };
  }

  if (input.role === "observer") {
    return {
      allowed: false,
      reason: `observer cannot perform ${input.actionRisk} actions`,
      confirmationRequired: false,
      reasonRequired: false,
    };
  }

  if (input.environment === "live" && input.role !== "admin") {
    return {
      allowed: false,
      reason: "live write actions require admin role",
      confirmationRequired: false,
      reasonRequired: false,
    };
  }

  if (input.environment === "live") {
    return { allowed: true, confirmationRequired: true, reasonRequired: true };
  }

  return {
    allowed: true,
    confirmationRequired: input.actionRisk === "destructive",
    reasonRequired: false,
  };
}
