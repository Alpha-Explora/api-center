import {
  TribeQuotaMode,
  TribeQuotaScope,
} from "../quotas/tribe-quota-policy.types";

export type TribePlanKey = "starter" | "standard" | "pro" | "enterprise";
export type TribePlanEnvironment = "test" | "prod";
export type TribePlanAssignmentStatus = "active" | "disabled";

export interface TribePlanDefinition {
  planKey: TribePlanKey;
  displayName: string;
  gatewayCallsPerDay: number | null;
  kafkaPublishesPerDay: number | null;
  retentionTier: string;
  sharedServiceAccess: string;
  supportTier: string;
}

export interface TribePlanAssignment {
  id?: string;
  ownerTribeId: string;
  planKey: TribePlanKey;
  environment: TribePlanEnvironment;
  status: TribePlanAssignmentStatus;
  effectiveAt: Date | string;
  reason: string;
  assignedBy?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface AssignTribePlanInput {
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
  planKey?: TribePlanKey;
  environment?: TribePlanEnvironment;
  status?: TribePlanAssignmentStatus;
}

export interface GeneratedQuotaPolicyProposal {
  ownerTribeId: string;
  scope: TribeQuotaScope;
  targetServiceId: string | null;
  windowSeconds: number;
  maxRequests: number;
  mode: TribeQuotaMode;
  reason: string;
}

export interface AssignTribePlanResult {
  assignment: TribePlanAssignment;
  quotaProposals: GeneratedQuotaPolicyProposal[];
}
