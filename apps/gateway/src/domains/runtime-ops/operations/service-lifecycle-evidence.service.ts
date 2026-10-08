import { Injectable } from "@nestjs/common";
import { ServiceRegistryEntry } from "../../../types";

export type LifecycleStatus = "blocked" | "attention" | "ready";
export type LifecycleStageStatus =
  | "complete"
  | "attention"
  | "blocked"
  | "not-required";

export type LifecycleStageId =
  | "registry"
  | "ownership"
  | "dependencies"
  | "runtime"
  | "quotas"
  | "pipeline"
  | "promotion"
  | "evidence";

export interface LifecycleStage {
  id: LifecycleStageId;
  label: string;
  status: LifecycleStageStatus;
  evidence: string;
  source: string;
  action: string;
  href: string;
}

export interface LifecycleEntry {
  service: ServiceRegistryEntry;
  ownerTribeId: string;
  status: LifecycleStatus;
  stages: LifecycleStage[];
  blockedCount: number;
  attentionCount: number;
  nextAction: {
    stageId: LifecycleStageId;
    label: string;
    href: string;
  };
}

export interface LifecycleEvidenceInput {
  services: ServiceRegistryEntry[];
  quotaPolicies: QuotaPolicyEvidence[];
  planAssignments: PlanAssignmentEvidence[];
  approvalRequests: ApprovalRequestEvidence[];
  pipelineRows: PipelineEvidenceRow[];
}

export interface QuotaPolicyEvidence {
  id?: unknown;
  ownerTribeId?: unknown;
  /** Null/absent = tribe-wide ceiling. */
  projectId?: unknown;
  status?: unknown;
}

export interface PlanAssignmentEvidence {
  id?: unknown;
  ownerTribeId?: unknown;
  projectId?: unknown;
  status?: unknown;
  environment?: unknown;
}

export interface ApprovalRequestEvidence {
  id?: unknown;
  status?: unknown;
  targetId?: unknown;
  actionType?: unknown;
}

export interface PipelineEvidenceRow {
  tribeId?: unknown;
  sourceServiceId?: unknown;
  latestS3ObjectAt?: unknown;
}

@Injectable()
export class ServiceLifecycleEvidenceService {
  build(input: LifecycleEvidenceInput) {
    const entries = input.services
      .map((service) => this.buildEntry(service, input))
      .sort(compareEntries);

    return {
      generatedAt: new Date().toISOString(),
      summary: {
        total: entries.length,
        blocked: entries.filter((entry) => entry.status === "blocked").length,
        attention: entries.filter((entry) => entry.status === "attention")
          .length,
        ready: entries.filter((entry) => entry.status === "ready").length,
      },
      entries,
    };
  }

  private buildEntry(
    service: ServiceRegistryEntry,
    input: LifecycleEvidenceInput,
  ): LifecycleEntry {
    const ownerTribeId = getOwnerTribeId(service);
    const stages: LifecycleStage[] = [
      registryStage(service),
      ownershipStage(service, ownerTribeId),
      dependenciesStage(service, input.services),
      runtimeStage(service),
      quotaStage(service, ownerTribeId, input.quotaPolicies),
      pipelineStage(service, ownerTribeId, input.pipelineRows),
      promotionStage(service, ownerTribeId, input),
      evidenceStage(service, ownerTribeId, input.pipelineRows),
    ];
    const blockedCount = stages.filter(
      (stage) => stage.status === "blocked",
    ).length;
    const attentionCount = stages.filter(
      (stage) => stage.status === "attention",
    ).length;
    const nextStage =
      stages.find((stage) => stage.status === "blocked") ??
      stages.find((stage) => stage.status === "attention");

    return {
      service,
      ownerTribeId,
      status:
        blockedCount > 0
          ? "blocked"
          : attentionCount > 0
            ? "attention"
            : "ready",
      stages,
      blockedCount,
      attentionCount,
      nextAction: nextStage
        ? {
            stageId: nextStage.id,
            label: nextStage.action,
            href: nextStage.href,
          }
        : {
            stageId: "registry",
            label: "Open the service detail record.",
            href: `/tribes/${service.serviceId}`,
          },
    };
  }
}

function registryStage(service: ServiceRegistryEntry): LifecycleStage {
  if (service.status === "retired") {
    return stage(
      "registry",
      "Registry",
      "blocked",
      "The service is retired.",
      "registry",
      "Restore or replace the registry entry before lifecycle work continues.",
      `/tribes/${service.serviceId}`,
    );
  }

  if (service.status === "active") {
    return stage(
      "registry",
      "Registry",
      "complete",
      "The service is active in the registry.",
      "registry",
      "Open the service detail record.",
      `/tribes/${service.serviceId}`,
    );
  }

  return stage(
    "registry",
    "Registry",
    "attention",
    `The service is ${service.status}.`,
    "registry",
    "Review the registry lifecycle state.",
    `/tribes/${service.serviceId}?section=actions`,
  );
}

function ownershipStage(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
): LifecycleStage {
  const missing = [
    service.ownerTeam?.trim() ? "" : "owner team",
    service.contact?.trim() ? "" : "contact",
    ownerTribeId ? "" : "owner tribe",
  ].filter(Boolean);

  if (missing.length) {
    return stage(
      "ownership",
      "Ownership",
      "blocked",
      `Missing ${missing.join(", ")}.`,
      "registry",
      "Update owner and contact fields in the manifest.",
      `/tribes/${service.serviceId}/edit`,
    );
  }

  return stage(
    "ownership",
    "Ownership",
    "complete",
    `${service.ownerTeam} owns ${ownerTribeId}.`,
    "registry",
    "Review governance evidence.",
    `/tribes/${service.serviceId}?section=governance`,
  );
}

function dependenciesStage(
  service: ServiceRegistryEntry,
  services: ServiceRegistryEntry[],
): LifecycleStage {
  const serviceIds = new Set(services.map((entry) => entry.serviceId));
  const missing = (service.consumes ?? []).filter(
    (dependency) => dependency !== "kafka" && !serviceIds.has(dependency),
  );

  if (missing.length) {
    return stage(
      "dependencies",
      "Dependencies",
      "blocked",
      `${missing.length} consumed service link is unresolved.`,
      "registry-dependencies",
      "Register the target service or remove the stale consume edge.",
      "/dependencies",
    );
  }

  return stage(
    "dependencies",
    "Dependencies",
    "complete",
    service.consumes?.length
      ? `${service.consumes.length} dependency link is registered or externally handled.`
      : "No consumed services are declared.",
    "registry-dependencies",
    "Inspect dependency impact.",
    `/tribes/${service.serviceId}?section=dependencies`,
  );
}

function runtimeStage(service: ServiceRegistryEntry): LifecycleStage {
  if (!service.healthCheck?.trim()) {
    return stage(
      "runtime",
      "Runtime",
      "attention",
      "No health path is registered.",
      "registry-health",
      "Add a health path and run a service health check.",
      `/tribes/${service.serviceId}?section=health`,
    );
  }

  if (service.healthy === false) {
    return stage(
      "runtime",
      "Runtime",
      "blocked",
      "The latest health check failed.",
      "registry-health",
      "Open health checks and rerun the failing endpoint.",
      `/tribes/${service.serviceId}?section=health`,
    );
  }

  return stage(
    "runtime",
    "Runtime",
    "complete",
    service.lastHealthCheckAt
      ? `Passed at ${service.lastHealthCheckAt}.`
      : "Service is currently marked healthy.",
    "registry-health",
    "Review runtime evidence.",
    `/tribes/${service.serviceId}?section=evidence`,
  );
}

function quotaStage(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
  quotaPolicies: QuotaPolicyEvidence[],
): LifecycleStage {
  if ((service.serviceType ?? "tribe") === "shared") {
    return stage(
      "quotas",
      "Quotas",
      "not-required",
      "Provider-side service quotas are reviewed through consumer policies.",
      "quota-policy",
      "Inspect consuming tribe quota pressure.",
      "/quotas",
    );
  }

  // The service's own project budget, or its tribe's ceiling. A sibling project's budget does not count.
  const activePolicy = quotaPolicies.find(
    (policy) =>
      policy.ownerTribeId === ownerTribeId &&
      policy.status === "active" &&
      (!readString(policy.projectId) || readString(policy.projectId) === service.projectId),
  );

  if (!activePolicy) {
    return stage(
      "quotas",
      "Quotas",
      "blocked",
      "No active observe or enforce quota policy exists.",
      "quota-policy",
      "Create an observe-mode quota policy.",
      `/quotas?ownerTribeId=${encodeURIComponent(ownerTribeId)}&mode=observe`,
    );
  }

  return stage(
    "quotas",
    "Quotas",
    "complete",
    `Active quota policy ${readString(activePolicy.id) ?? "exists"}.`,
    "quota-policy",
    "Review quota policy.",
    `/quotas?ownerTribeId=${encodeURIComponent(ownerTribeId)}`,
  );
}

function pipelineStage(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
  pipelineRows: PipelineEvidenceRow[],
): LifecycleStage {
  if (!requiresEventExport(service)) {
    return stage(
      "pipeline",
      "Pipeline",
      "not-required",
      "Event export is not required for this service.",
      "pipeline-health",
      "Open pipeline only when publishing is added.",
      `/tribes/${service.serviceId}?section=pipeline`,
    );
  }

  const rows = matchingPipelineRows(service, ownerTribeId, pipelineRows);
  if (!rows.length) {
    return stage(
      "pipeline",
      "Pipeline",
      "blocked",
      "No prod pipeline-health evidence exists for this service.",
      "pipeline-health",
      "Verify topic publishing and S3 sink inclusion.",
      `/tribes/${service.serviceId}?section=pipeline`,
    );
  }

  return stage(
    "pipeline",
    "Pipeline",
    "complete",
    `${rows.length} prod pipeline-health row is available.`,
    "pipeline-health",
    "Review pipeline evidence.",
    `/tribes/${service.serviceId}?section=pipeline`,
  );
}

function promotionStage(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
  input: LifecycleEvidenceInput,
): LifecycleStage {
  const approved = input.approvalRequests.find((request) => {
    return (
      readString(request.status) === "approved" &&
      (!readString(request.targetId) ||
        readString(request.targetId) === service.serviceId ||
        readString(request.targetId) === service.projectId ||
        readString(request.targetId) === ownerTribeId)
    );
  });
  const activePlan = input.planAssignments.find(
    (assignment) =>
      readString(assignment.projectId) === service.projectId &&
      readString(assignment.status) === "active",
  );

  if (!approved) {
    return stage(
      "promotion",
      "Promotion",
      "blocked",
      "No approved promotion or live-readiness request exists.",
      "approval-request",
      "Create and approve a live registration request.",
      "/registration-requests",
    );
  }

  if (!activePlan && (service.serviceType ?? "tribe") === "tribe") {
    return stage(
      "promotion",
      "Promotion",
      "attention",
      "Promotion approval exists, but no active plan assignment is recorded.",
      "plan-assignment",
      "Assign a live plan tier for the tribe.",
      "/plans",
    );
  }

  return stage(
    "promotion",
    "Promotion",
    "complete",
    `Approved request ${readString(approved.id) ?? "exists"}.`,
    "approval-request",
    "Review live promotion gates.",
    "/promotions",
  );
}

function evidenceStage(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
  pipelineRows: PipelineEvidenceRow[],
): LifecycleStage {
  const rows = matchingPipelineRows(service, ownerTribeId, pipelineRows);
  if (service.lastHealthCheckAt || rows.length) {
    return stage(
      "evidence",
      "Evidence",
      "complete",
      rows.length
        ? `${rows.length} pipeline evidence row is attached.`
        : `Latest health proof at ${service.lastHealthCheckAt}.`,
      rows.length ? "pipeline-health" : "registry-health",
      "Open the evidence timeline.",
      `/tribes/${service.serviceId}?section=evidence`,
    );
  }

  return stage(
    "evidence",
    "Evidence",
    "attention",
    `Registry updated at ${service.updatedAt}. Health or pipeline proof is not recorded.`,
    "registry",
    "Open the evidence timeline and add runtime proof.",
    `/tribes/${service.serviceId}?section=evidence`,
  );
}

function matchingPipelineRows(
  service: ServiceRegistryEntry,
  ownerTribeId: string,
  pipelineRows: PipelineEvidenceRow[],
) {
  return pipelineRows.filter(
    (row) =>
      readString(row.tribeId) === ownerTribeId ||
      readString(row.sourceServiceId) === service.serviceId,
  );
}

function getOwnerTribeId(service: ServiceRegistryEntry) {
  return service.ownerTribeId ?? "";
}

function requiresEventExport(service: ServiceRegistryEntry) {
  return (
    service.requiredScopes.includes("external:kafka:write") ||
    service.consumes.includes("kafka")
  );
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stage(
  id: LifecycleStageId,
  label: string,
  status: LifecycleStageStatus,
  evidence: string,
  source: string,
  action: string,
  href: string,
): LifecycleStage {
  return { id, label, status, evidence, source, action, href };
}

function compareEntries(left: LifecycleEntry, right: LifecycleEntry) {
  const statusRank: Record<LifecycleStatus, number> = {
    blocked: 0,
    attention: 1,
    ready: 2,
  };

  return (
    statusRank[left.status] - statusRank[right.status] ||
    right.blockedCount - left.blockedCount ||
    right.attentionCount - left.attentionCount ||
    left.service.name.localeCompare(right.service.name)
  );
}
