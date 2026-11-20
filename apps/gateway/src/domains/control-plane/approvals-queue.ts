// Everything waiting for a decision, as one list. Pure: the service loads the rows and the caller
// decides which items the actor may see. Each item names the project where it is decided:
// a live activation is decided on its own project, an API access request on the API's project.

import type { EnvironmentKind } from "./control-plane.types";

interface ItemBase {
  id: string;
  organizationId: string;
  organizationName: string;
  /** The project whose administrators decide it. */
  projectId: string;
  projectName: string;
  /** What is requested, in a sentence. */
  summary: string;
  requestedBy: string;
  requestedAt: string;
  /** Set on decided items: how, by whom, when, and why for a rejection. */
  decision?: ApprovalDecision;
}

export interface ApprovalDecision {
  /** applied: an approved live activation that was then used to activate live. */
  status: "approved" | "rejected" | "applied" | "cancelled";
  by: string | null;
  at: string;
  reason?: string;
}

export type ApprovalItem =
  | (ItemBase & { kind: "live_activation"; reason: string })
  | (ItemBase & {
      kind: "api_access";
      apiId: string;
      apiName: string;
      action: string;
      environmentKind: EnvironmentKind;
      consumerProjectId: string;
      consumerProjectName: string;
      consumerApplicationId: string;
      consumerApplicationName: string;
    });

export interface ApprovalRows {
  organizations: { id: string; name: string }[];
  projects: { id: string; organizationId: string; name: string }[];
  /** environment.activate_live requests; targetId is the project ID. Decided ones carry their decision fields. */
  activations: {
    id?: string;
    targetId?: string | null;
    reason: string;
    requestedBy: string;
    createdAt?: Date | string;
    status?: string;
    approvedBy?: string | null;
    approvedAt?: Date | string | null;
    rejectedBy?: string | null;
    rejectedAt?: Date | string | null;
    rejectionReason?: string | null;
    cancelledBy?: string | null;
    cancelledAt?: Date | string | null;
    appliedAt?: Date | string | null;
    updatedAt?: Date | string;
  }[];
  /** Pending cp_api_access_requests. */
  accessRequests: {
    id: string;
    organizationId: string;
    apiId: string;
    action: string;
    consumerProjectId: string;
    consumerApplicationId: string;
    requestedBy: string;
    createdAt: Date;
    status?: string;
    decidedBy?: string | null;
    decidedAt?: Date | null;
    rejectionReason?: string | null;
  }[];
  apis: { id: string; organizationId: string; projectId: string; name: string; environmentKind: string }[];
  applications: { id: string; name: string }[];
}

/** Builds the queue, newest first. Rows whose project or API no longer exists are dropped. */
export function buildApprovalItems(rows: ApprovalRows): ApprovalItem[] {
  const organizations = new Map(rows.organizations.map((row) => [row.id, row.name]));
  const projects = new Map(rows.projects.map((row) => [row.id, row]));
  const apis = new Map(rows.apis.map((row) => [row.id, row]));
  const applications = new Map(rows.applications.map((row) => [row.id, row.name]));
  const items: ApprovalItem[] = [];

  for (const request of rows.activations) {
    const project = request.targetId ? projects.get(request.targetId) : undefined;
    if (!request.id || !project) continue;
    items.push({
      kind: "live_activation",
      id: request.id,
      organizationId: project.organizationId,
      organizationName: organizations.get(project.organizationId) ?? project.organizationId,
      projectId: project.id,
      projectName: project.name,
      summary: `Activate the live environment of ${project.name}`,
      reason: request.reason,
      requestedBy: request.requestedBy,
      requestedAt: iso(request.createdAt),
      ...activationDecision(request),
    });
  }

  for (const request of rows.accessRequests) {
    const api = apis.get(request.apiId);
    const owner = api ? projects.get(api.projectId) : undefined;
    if (!api || !owner || api.organizationId !== request.organizationId) continue;
    const consumerProjectName = projects.get(request.consumerProjectId)?.name ?? request.consumerProjectId;
    const consumerApplicationName = applications.get(request.consumerApplicationId) ?? request.consumerApplicationId;
    items.push({
      kind: "api_access",
      id: request.id,
      organizationId: request.organizationId,
      organizationName: organizations.get(request.organizationId) ?? request.organizationId,
      projectId: owner.id,
      projectName: owner.name,
      summary: `${consumerApplicationName} (${consumerProjectName}) wants ${request.action} on ${api.name}`,
      apiId: api.id,
      apiName: api.name,
      action: request.action,
      environmentKind: api.environmentKind === "live" ? "live" : "test",
      consumerProjectId: request.consumerProjectId,
      consumerProjectName,
      consumerApplicationId: request.consumerApplicationId,
      consumerApplicationName,
      requestedBy: request.requestedBy,
      requestedAt: iso(request.createdAt),
      ...(request.status === "approved" || request.status === "rejected"
        ? {
            decision: {
              status: request.status,
              by: request.decidedBy ?? null,
              at: iso(request.decidedAt ?? request.createdAt),
              ...(request.rejectionReason ? { reason: request.rejectionReason } : {}),
            },
          }
        : {}),
    });
  }

  // Waiting items by when they were asked for; decided ones by when they were decided.
  const when = (item: ApprovalItem) => item.decision?.at ?? item.requestedAt;
  return items.sort((left, right) => when(right).localeCompare(when(left)));
}

function activationDecision(request: ApprovalRows["activations"][number]): { decision?: ApprovalDecision } {
  switch (request.status) {
    case "approved":
      return { decision: { status: "approved", by: request.approvedBy ?? null, at: iso(request.approvedAt ?? request.updatedAt) } };
    case "applied":
      return { decision: { status: "applied", by: request.approvedBy ?? null, at: iso(request.appliedAt ?? request.updatedAt) } };
    case "rejected":
      return {
        decision: {
          status: "rejected",
          by: request.rejectedBy ?? null,
          at: iso(request.rejectedAt ?? request.updatedAt),
          ...(request.rejectionReason ? { reason: request.rejectionReason } : {}),
        },
      };
    case "cancelled":
      return { decision: { status: "cancelled", by: request.cancelledBy ?? null, at: iso(request.cancelledAt ?? request.updatedAt) } };
    default:
      return {};
  }
}

function iso(value: Date | string | undefined): string {
  if (!value) return new Date(0).toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}
