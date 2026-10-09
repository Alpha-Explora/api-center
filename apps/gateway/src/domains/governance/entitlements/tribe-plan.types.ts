import {
  TribeQuotaMode,
  TribeQuotaScope,
} from "@quotas/tribe-quota-policy.types";

export type TribePlanKey = "starter" | "standard" | "pro" | "enterprise";
export type TribePlanEnvironment = "test" | "live";
export type TribePlanAssignmentStatus = "active" | "suspended" | "archived";

export interface EffectivePlanLimit {
  scope: TribeQuotaScope;
  targetServiceId?: string;
  maxRequests: number | null;
  windowSeconds: number | null;
  mode: TribeQuotaMode;
  source: "plan" | "override";
  policyId?: string;
  reason?: string;
}

export interface TribePlanDefinition {
  planKey: TribePlanKey;
  displayName: string;
  gatewayCallsPerDay: number | null;
  kafkaPublishesPerDay: number | null;
  retentionTier: string;
  sharedServiceAccess: string;
  supportTier: string;
}

/** A plan is assigned to one project in one environment. ownerTribeId is derived from the project. */
export interface TribePlanAssignment {
  id?: string;
  ownerTribeId: string;
  projectId: string;
  planKey: TribePlanKey;
  environment: TribePlanEnvironment;
  status: TribePlanAssignmentStatus;
  effectiveAt: Date | string;
  reason: string;
  assignedBy?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  effectiveLimits?: EffectivePlanLimit[];
}

export interface AssignTribePlanInput {
  projectId: string;
  /** Filled from the project's tribe; never taken from the request. */
  ownerTribeId: string;
  planKey: TribePlanKey;
  environment: TribePlanEnvironment;
  effectiveAt?: Date;
  reason: string;
  assignedBy?: string;
}

export interface UpdateTribePlanAssignmentInput {
  assignmentId: string;
  status: TribePlanAssignmentStatus;
  reason: string;
  updatedBy?: string;
}

export interface ListTribePlanAssignmentsInput {
  ownerTribeId?: string;
  ownerTribeIds?: string[];
  projectId?: string;
  planKey?: TribePlanKey;
  environment?: TribePlanEnvironment;
  status?: TribePlanAssignmentStatus;
}

export interface AssignTribePlanResult {
  assignment: TribePlanAssignment;
}
