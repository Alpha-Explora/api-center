// =============================================================================
// Quota evaluation ledger. The runtime context owns apic_runtime.quota_evaluations.
// Governance decides whether a call is within quota and records the decision here; it never touches the table.
// =============================================================================

/** One quota decision. scope, mode and outcome are plain strings so this contract does not import governance. */
export interface QuotaEvaluationEntry {
  ownerTribeId: string;
  projectId?: string | null;
  policyId?: string;
  scope: string;
  targetServiceId?: string | null;
  routeFamily: string;
  windowStart: Date;
  windowEnd: Date;
  requestCount: number;
  maxRequests: number;
  mode: string;
  outcome: string;
  correlationId?: string;
  environment?: string;
}

export interface QuotaEvaluationRecord {
  id: string;
  ownerTribeId: string;
  policyId?: string | null;
  scope: string;
  targetServiceId?: string | null;
  routeFamily: string;
  windowStart: Date | string;
  windowEnd: Date | string;
  requestCount: number;
  maxRequests: number;
  mode: string;
  outcome: string;
  correlationId?: string | null;
  createdAt: Date | string;
}

export interface QuotaEvaluationLedger {
  record(entry: QuotaEvaluationEntry): Promise<void>;
  /** Newest first. */
  listSince(query: { ownerTribeId?: string; since: Date; limit: number }): Promise<QuotaEvaluationRecord[]>;
}

export const QUOTA_EVALUATION_LEDGER = Symbol("QUOTA_EVALUATION_LEDGER");
