// =============================================================================
// Registry change requests. The governance context owns apic_governance.registry_change_requests.
// The registry validates a manifest and applies it; it records the request lifecycle here and never
// touches the table.
// =============================================================================

export interface RegistryChangeRequestRecord {
  id: string;
  serviceId: string;
  ownerTribeId: string | null;
  projectId: string | null;
  status: string;
  manifest: unknown;
  validationReport: unknown;
  requestedBy: string | null;
  approvedBy: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  appliedServiceId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  decidedAt: Date | string | null;
  appliedAt: Date | string | null;
}

export interface NewRegistryChangeRequest {
  serviceId: string;
  ownerTribeId: string | null;
  projectId: string | null;
  manifest: unknown;
  validationReport: unknown;
  requestedBy?: string;
}

export interface RegistryChangeRequestStore {
  /** Stores a new request in the pending state. */
  create(input: NewRegistryChangeRequest): Promise<RegistryChangeRequestRecord>;
  /** Newest first. */
  list(status?: string): Promise<RegistryChangeRequestRecord[]>;
  find(id: string): Promise<RegistryChangeRequestRecord | null>;
  saveValidationReport(id: string, validationReport: unknown): Promise<void>;
  markApplied(
    id: string,
    applied: { approvedBy: string; appliedServiceId: string; validationReport: unknown },
  ): Promise<RegistryChangeRequestRecord>;
  /** Rejects the request only while it is pending. Returns false when it was not pending. */
  rejectIfPending(id: string, rejection: { rejectedBy: string; reason: string }): Promise<boolean>;
}

export const REGISTRY_CHANGE_REQUEST_STORE = Symbol("REGISTRY_CHANGE_REQUEST_STORE");
