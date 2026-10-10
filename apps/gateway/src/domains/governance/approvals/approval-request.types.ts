export type ApprovalActionType =
  | "quota.increase"
  | "quota.enforce"
  | "secret.rotate"
  | "topic.provision"
  | "s3_sink.include_topic"
  | "service.register_live"
  | "service.retire"
  | "plan.assign_live"
  | "payments.live_access";

export type ApprovalRiskLevel = "low" | "medium" | "high" | "critical";
export type ApprovalRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "applied";

export interface ApprovalRequest {
  id?: string;
  actionType: ApprovalActionType;
  targetId?: string | null;
  targetEnvironment: string;
  status: ApprovalRequestStatus;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  riskLevel: ApprovalRiskLevel;
  reason: string;
  requestedBy: string;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  rejectedBy?: string | null;
  rejectedAt?: Date | string | null;
  rejectionReason?: string | null;
  cancelledBy?: string | null;
  cancelledAt?: Date | string | null;
  appliedAt?: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface CreateApprovalRequestInput {
  actionType: ApprovalActionType;
  targetId?: string | null;
  targetEnvironment: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  riskLevel: ApprovalRiskLevel;
  reason: string;
  requestedBy: string;
}

export interface ApprovalCheckInput {
  approvalRequestId?: string;
  actionType: ApprovalActionType;
  targetEnvironment: string;
  targetId?: string;
  /** Reject approvals without this exact resource target when set. */
  requireTarget?: boolean;
}
