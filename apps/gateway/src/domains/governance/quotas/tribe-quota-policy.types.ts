export type TribeQuotaScope = "all" | "shared" | "tribe" | "kafka_publish";
export type TribeQuotaMode = "observe" | "enforce";
export type TribeQuotaStatus = "active" | "disabled";
export type TribeQuotaDecisionOutcome =
  | "allowed"
  | "observed_exceeded"
  | "blocked";

/**
 * A quota policy always names its tribe. With projectId it is that project's budget; without it, it is a
 * tribe-wide ceiling shared by every project in the tribe. A call must pass both levels.
 */
export interface TribeQuotaPolicy {
  id?: string;
  ownerTribeId: string;
  projectId?: string | null;
  scope: TribeQuotaScope;
  targetServiceId?: string | null;
  windowSeconds: number;
  maxRequests: number;
  burstRequests?: number | null;
  mode: TribeQuotaMode;
  status: TribeQuotaStatus;
  reason: string;
  updatedAt?: Date | string;
}

export interface ResolveTribeQuotaPolicyInput {
  ownerTribeId: string;
  projectId?: string;
  scope: TribeQuotaScope;
  targetServiceId?: string;
}

/** Best-matching policy at each level; either may be null. */
export interface ResolvedTribeQuotaPolicies {
  project: TribeQuotaPolicy | null;
  tribe: TribeQuotaPolicy | null;
}

export interface CreateTribeQuotaPolicyInput {
  ownerTribeId: string;
  /** Omit for a tribe-wide ceiling. */
  projectId?: string | null;
  scope: TribeQuotaScope;
  targetServiceId?: string | null;
  windowSeconds: number;
  maxRequests: number;
  burstRequests?: number | null;
  mode?: TribeQuotaMode;
  reason: string;
  createdBy?: string;
  updatedBy?: string;
  approvalRequestId?: string;
}

export interface UpdateTribeQuotaPolicyInput {
  scope?: TribeQuotaScope;
  targetServiceId?: string | null;
  windowSeconds?: number;
  maxRequests?: number;
  burstRequests?: number | null;
  mode?: TribeQuotaMode;
  status?: TribeQuotaStatus;
  reason?: string;
  updatedBy?: string;
  approvalRequestId?: string;
}
