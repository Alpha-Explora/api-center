export type TribeQuotaScope = "all" | "shared" | "tribe" | "kafka_publish";
export type TribeQuotaMode = "observe" | "enforce";
export type TribeQuotaStatus = "active" | "disabled";
export type TribeQuotaDecisionOutcome =
  | "allowed"
  | "observed_exceeded"
  | "blocked";

export interface TribeQuotaPolicy {
  id?: string;
  ownerTribeId: string;
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
  scope: TribeQuotaScope;
  targetServiceId?: string;
}

export interface CreateTribeQuotaPolicyInput {
  ownerTribeId: string;
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
