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
  /** Pending environment.activate_live requests; targetId is the project ID. */
  activations: { id?: string; targetId?: string | null; reason: string; requestedBy: string; createdAt?: Date | string }[];
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
    });
  }

  return items.sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
}

function iso(value: Date | string | undefined): string {
  if (!value) return new Date(0).toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : value.toISOString();
}
